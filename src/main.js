import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { Impit } from 'impit';
import { chromium } from 'patchright';

const ZILLOW_BASE_URL = 'https://www.zillow.com';
const AGENT_SEARCH_PATH = '/professionals/real-estate-agent-reviews/';
const TRACKER_RE =
    /google-analytics|googletagmanager|doubleclick|bat\.bing|scorecardresearch|adscores|kargo|amazon-adsystem|facebook\.com\/tr/i;

const MAX_SESSION_ROTATIONS = 2;
// Profile pages are optional enrichment. Keep a challenged detail request from
// holding the whole result set open, especially with residential proxies.
const DETAIL_CONCURRENCY = 4;
const HYDRATION_WAIT_MS = 9000;
const HYDRATION_POLL_MS = 500;
const HTTP_FALLBACK_TIMEOUT_MS = 20000;
const PROFILE_HTTP_TIMEOUT_MS = 5000;

const sleep = (ms) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

await Actor.init();

class StealthBrowser {
    constructor(options = {}) {
        this.proxyUrl = options.proxyUrl;
        this.context = null;
        this.page = null;
        this.launchCounter = 0;
    }

    async launch() {
        const userDataDir = `./user_data_${this.launchCounter}`;
        this.launchCounter += 1;

        // Pattern C: real Chrome, non-headless, no viewport flag. Patchright manages
        // fingerprint consistency internally, so no custom userAgent/headers are set.
        this.context = await chromium.launchPersistentContext(userDataDir, {
            channel: 'chrome',
            headless: false,
            noViewport: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
            ],
            ...(this.proxyUrl ? { proxy: { server: this.proxyUrl } } : {}),
        });

        await this.context.route('**/*', (route) => {
            const request = route.request();
            const resourceType = request.resourceType();
            const requestUrl = request.url();
            if (['image', 'media'].includes(resourceType) || TRACKER_RE.test(requestUrl)) {
                return route.abort();
            }
            return route.continue();
        });

        const pages = this.context.pages();
        this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    }

    async goto(url, options = {}, targetPage = this.page) {
        const navigationTimeoutMs = options.navigationTimeoutMs ?? 60000;
        const hydrationWaitMs = options.hydrationWaitMs ?? HYDRATION_WAIT_MS;
        try {
            await targetPage.goto(url, {
                waitUntil: options.waitUntil ?? 'domcontentloaded',
                timeout: navigationTimeoutMs,
            });
        } catch {
            // navigation timeout or aborted reload; DOM extraction below still applies
        }

        const deadline = Date.now() + hydrationWaitMs;
        while (Date.now() < deadline) {
            let state;
            try {
                state = await targetPage.evaluate(() => {
                    const script = document.querySelector('script#__NEXT_DATA__');
                    const bodyText = document.body ? document.body.innerText : '';
                    return {
                        hasJson: Boolean(script?.textContent),
                        jsonText: script?.textContent || '',
                        title: document.title,
                        blocked:
                            /Access to this page has been denied|px-captcha|Pardon Our Interruption|captcha|just a moment|unusual traffic|verify you are human|Access Denied/i.test(
                                `${bodyText} ${document.title}`,
                            ),
                    };
                });
            } catch {
                await sleep(HYDRATION_POLL_MS);
                continue;
            }
            if (state.hasJson && !state.blocked) return state;
            if (state.blocked) return state;
            await sleep(HYDRATION_POLL_MS);
        }

        let finalState;
        try {
            finalState = await targetPage.evaluate(() => {
                const script = document.querySelector('script#__NEXT_DATA__');
                return {
                    hasJson: Boolean(script?.textContent),
                    jsonText: script?.textContent || '',
                    title: document.title,
                    blocked: false,
                };
            });
        } catch {
            finalState = { hasJson: false, jsonText: '', title: '', blocked: false };
        }
        return finalState;
    }

    async fetch(url, options = {}, targetPage = this.page) {
        const state = await this.goto(url, options, targetPage);
        if (state.blocked) {
            throw new Error(`Zillow blocked the browser request for ${url}`);
        }
        if (!state.hasJson) {
            throw new Error(`Browser found no Zillow JSON payload for ${url} (title: ${state.title || 'unknown'})`);
        }
        return state.jsonText;
    }

    async warmup() {
        try {
            await this.page.goto(ZILLOW_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 12000 });
        } catch {
            // A warmup timeout does not prevent the page session from being used.
        }
        await sleep(1500);
    }

    async close() {
        if (this.context) {
            await this.context.close().catch(() => {});
        }
        this.context = null;
        this.page = null;
    }
}

function normalizeLimit(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function cleanText(value) {
    return typeof value === 'string' ? value.trim() : value;
}

function normalizeNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string') return undefined;
    const normalized = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(normalized) ? normalized : undefined;
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return undefined;
    if (/^true$/i.test(value.trim())) return true;
    if (/^false$/i.test(value.trim())) return false;
    return undefined;
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) return undefined;
    const values = value
        .map((item) => (typeof item === 'string' ? cleanText(item) : item))
        .filter((item) => item !== null && item !== undefined && item !== '');
    return values.length ? [...new Set(values)] : undefined;
}

function cleanRecord(record) {
    return Object.fromEntries(
        Object.entries(record).filter(([, value]) => {
            if (value === null || value === undefined || value === '') return false;
            if (Array.isArray(value) && value.length === 0) return false;
            if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;
            return true;
        }),
    );
}

function getInputUrls(input) {
    const urls = [];
    const addUrl = (value) => {
        if (!value) return;
        if (typeof value === 'string') urls.push(value);
        else if (typeof value.url === 'string') urls.push(value.url);
    };

    addUrl(input.url);
    addUrl(input.startUrl);
    addUrl(input.start_url);
    if (Array.isArray(input.startUrls)) input.startUrls.forEach(addUrl);
    if (Array.isArray(input.start_urls)) input.start_urls.forEach(addUrl);

    return [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
}

function absoluteZillowUrl(value) {
    if (!value) return undefined;
    try {
        return new URL(value, ZILLOW_BASE_URL).href;
    } catch {
        return undefined;
    }
}

function locationToSlug(location) {
    return String(location || '')
        .trim()
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function buildSearchUrl({ baseUrl, location, keyword, page }) {
    const url = baseUrl
        ? new URL(baseUrl, ZILLOW_BASE_URL)
        : new URL(
              `${AGENT_SEARCH_PATH}${locationToSlug(location) ? `${locationToSlug(location)}/` : ''}`,
              ZILLOW_BASE_URL,
          );

    if (!url.pathname.startsWith(AGENT_SEARCH_PATH)) {
        throw new Error(`Unsupported Zillow agent search URL: ${url.href}`);
    }

    if (keyword) url.searchParams.set('name', keyword);
    if (page > 1) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');

    return url.href;
}

function parsePayload(payloadText, sourceUrl) {
    try {
        return JSON.parse(payloadText);
    } catch (error) {
        throw new Error(`Could not parse Zillow JSON payload for ${sourceUrl}: ${error.message}`);
    }
}

function extractNextDataFromHtml(html, sourceUrl) {
    const match = String(html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!match?.[1]) throw new Error(`HTTP response had no Zillow JSON payload for ${sourceUrl}`);
    return match[1];
}

const HTTP_HYDRATION_PROFILES = [
    {
        name: 'iOS Safari',
        headers: {
            'user-agent':
                'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
            'sec-fetch-site': 'none',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-user': '?1',
            'sec-fetch-dest': 'document',
        },
    },
    {
        name: 'Android app',
        headers: {
            'user-agent': 'okhttp/4.12.0',
            accept: 'application/json',
            'accept-language': 'en-US',
            'x-requested-with': 'com.example.android',
        },
    },
];

async function fetchHydrationOverHttp(url, options = {}) {
    const timeoutMs = options.timeoutMs ?? HTTP_FALLBACK_TIMEOUT_MS;
    const profiles = options.profiles ?? HTTP_HYDRATION_PROFILES;
    for (const profile of profiles) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                headers: profile.headers,
                redirect: 'follow',
                signal: controller.signal,
            });
            const html = await response.text();
            if (response.ok && html.includes('__NEXT_DATA__')) {
                log.info(`HTTP hydration fallback returned Zillow JSON with ${profile.name}.`);
                return extractNextDataFromHtml(html, url);
            }
            log.debug(`HTTP hydration fallback ${profile.name} returned ${response.status} without Zillow JSON.`);
        } catch (error) {
            log.debug(`HTTP hydration fallback ${profile.name} failed: ${error.message}`);
        } finally {
            clearTimeout(timeout);
        }
    }
    throw new Error(`HTTP hydration fallback failed for ${url}`);
}

async function fetchProfileHydrationWithImpit(client, url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROFILE_HTTP_TIMEOUT_MS);
    try {
        const response = await client.fetch(url, { redirect: 'follow', signal: controller.signal });
        if (!response.ok) throw new Error(`Impit returned HTTP ${response.status} for ${url}`);
        return extractNextDataFromHtml(await response.text(), url);
    } finally {
        clearTimeout(timeout);
    }
}

function createImpitClient(proxyUrl) {
    return new Impit({
        browser: 'chrome',
        ignoreTlsErrors: true,
        ...(proxyUrl ? { proxyUrl } : {}),
    });
}

async function createProfileClientPool(proxyConfiguration, size) {
    const clients = [];
    for (let index = 0; index < size; index++) {
        const proxyUrl = proxyConfiguration ? await getProxyUrl(proxyConfiguration) : undefined;
        clients.push(createImpitClient(proxyUrl));
    }
    return clients;
}

function getSearchResults(nextData) {
    return nextData?.props?.pageProps?.displayData?.agentDirectoryFinderDisplay?.searchResults;
}

function getProfileCards(searchResults) {
    const cards = searchResults?.results?.resultsCards;
    if (!Array.isArray(cards)) return [];
    // eslint-disable-next-line dot-notation
    return cards.filter((card) => card?.['__typename'] === 'AgentDirectoryFinderProfileResultsCard');
}

function profileDataToFields(profileData) {
    const fields = {};
    for (const item of Array.isArray(profileData) ? profileData : []) {
        const label = String(item?.label || '')
            .trim()
            .toLowerCase();
        let key;
        if (label.includes('price range')) key = 'team_price_range';
        else if (/(?:sales|sale).*last 12 months/.test(label)) key = 'team_sales_last_12_months';
        else if (/(?:sales|sale).*in /.test(label)) key = 'team_sales_in_location';
        if (key && item?.formattedData) fields[key] = cleanText(item.formattedData);
    }
    return fields;
}

function parseReviewCount(text) {
    if (!text) return undefined;
    const number = String(text).replace(/[^0-9]/g, '');
    return number ? Number(number) : undefined;
}

function mapSearchCard(card, context) {
    const review = card.reviewInformation || {};
    const reviewCount = parseReviewCount(review.reviewCountFormattedText);
    const profileFields = profileDataToFields(card.profileData);
    const tags = normalizeStringArray(Array.isArray(card.tags) ? card.tags.map((tag) => tag?.text) : []);

    return cleanRecord({
        encoded_zuid: card.encodedZuid,
        name: cleanText(card.cardTitle),
        business_name: cleanText(card.secondaryCardTitle),
        profile_url: absoluteZillowUrl(card.cardActionLink),
        image_url: absoluteZillowUrl(card.imageUrl),
        logo_url: absoluteZillowUrl(card.logoUrl),
        is_top_agent: normalizeBoolean(card.isTopAgent),
        review_average: normalizeNumber(review.reviewAverage),
        review_average_text: cleanText(review.reviewAverageText),
        review_count: reviewCount,
        review_count_text: cleanText(review.reviewCountFormattedText),
        no_reviews_text: reviewCount ? undefined : review.noReviewsText,
        tags,
        ...profileFields,
        search_location: cleanText(context.searchLocation),
        results_found: normalizeNumber(context.resultsFound),
        results_found_text: cleanText(context.resultsFoundText),
        source_url: context.sourceUrl,
        page: context.page,
        scraped_at: context.scrapedAt,
    });
}

function formatAddress(address) {
    if (!address) return undefined;
    return [address.address1, address.address2, address.city, address.state, address.postalCode]
        .filter(Boolean)
        .join(', ');
}

function mapLicenses(licenses) {
    return (Array.isArray(licenses) ? licenses : [])
        .map((license) =>
            cleanRecord({
                state: license.state,
                text: license.text,
                status: license.status,
                license_type: license.license_type,
                expiration: license.expiration,
            }),
        )
        .filter((license) => Object.keys(license).length > 0);
}

function mapServiceAreas(serviceAreas) {
    return (Array.isArray(serviceAreas) ? serviceAreas : [])
        .map((area) => cleanText(area?.regionName || area?.name || area?.text))
        .filter(Boolean);
}

function countItems(value, key) {
    if (Array.isArray(value)) return value.length;
    if (Array.isArray(value?.[key])) return value[key].length;
    return undefined;
}

function mapProfileDetails(nextData) {
    const pageProps = nextData?.props?.pageProps || {};
    const user = pageProps.displayUser || {};
    const info = pageProps.professionalInformation || {};
    const team = pageProps.teamDisplayInformation || {};
    const ratings = user.ratings || {};
    const phoneNumbers = user.phoneNumbers || {};

    return cleanRecord({
        profile_name: user.name || user.screenName,
        email: user.email,
        phone_cell: phoneNumbers.cell,
        phone_office: phoneNumbers.office,
        phone_brokerage: phoneNumbers.brokerage,
        business_address: formatAddress(user.businessAddress),
        business_city: user.businessAddress?.city,
        business_state: user.businessAddress?.state,
        business_postal_code: user.businessAddress?.postalCode,
        profile_types: normalizeStringArray(user.profileTypes),
        profile_photo_url: absoluteZillowUrl(user.profilePhotoSrc),
        profile_review_average: normalizeNumber(ratings.average),
        profile_review_count: normalizeNumber(ratings.count),
        about: info.aboutMe || info.description || pageProps.getToKnowMe?.description,
        specialties: normalizeStringArray(info.specialties),
        languages: normalizeStringArray(info.languages),
        websites: normalizeStringArray(info.websites),
        agent_licenses: mapLicenses(pageProps.agentLicenses),
        other_licenses: mapLicenses(pageProps.otherLicenses),
        service_areas: mapServiceAreas(pageProps.serviceAreas),
        for_sale_listing_count: countItems(pageProps.forSaleListings, 'listings'),
        for_rent_listing_count: countItems(pageProps.forRentListings, 'listings'),
        past_sales_count: countItems(pageProps.pastSales, 'sales'),
        review_count_detailed: countItems(pageProps.reviewsData, 'reviews'),
        team_name: team.teamName,
        team_members_count: countItems(team.teamMembers, 'members'),
    });
}

async function getActorInput() {
    const input = (await Actor.getInput()) || {};
    if (getInputUrls(input).length > 0 || input.keyword || input.location || input.search_location) return input;

    try {
        const localInput = JSON.parse(await readFile('INPUT.json', 'utf8'));
        log.info('Using INPUT.json because no runtime input was provided.');
        return { ...localInput, ...input };
    } catch (error) {
        log.warning(`INPUT.json fallback unavailable: ${error.message}`);
    }

    try {
        const inputSchema = JSON.parse(await readFile('.actor/input_schema.json', 'utf8'));
        const schemaInput = {};
        for (const [key, config] of Object.entries(inputSchema.properties || {})) {
            if (Object.hasOwn(config, 'prefill')) schemaInput[key] = config.prefill;
            else if (Object.hasOwn(config, 'default')) schemaInput[key] = config.default;
        }
        if (Object.keys(schemaInput).length > 0) {
            log.info('Using input schema prefills because no runtime input was provided.');
            return { ...schemaInput, ...input };
        }
    } catch (error) {
        log.warning(`Input schema fallback unavailable: ${error.message}`);
    }

    return input;
}

async function createProxyConfiguration(proxyConfiguration) {
    const hasCustomProxyUrls = Array.isArray(proxyConfiguration?.proxyUrls) && proxyConfiguration.proxyUrls.length > 0;
    if (!proxyConfiguration?.useApifyProxy && !hasCustomProxyUrls) return null;
    if (proxyConfiguration?.useApifyProxy && !Actor.isAtHome() && !hasCustomProxyUrls) {
        log.info('Local run: skipping Apify Proxy because no cloud proxy credentials are available.');
        return null;
    }
    return Actor.createProxyConfiguration(proxyConfiguration);
}

async function getProxyUrl(proxyConfiguration) {
    if (!proxyConfiguration) return undefined;
    try {
        // Apify proxy session IDs only allow [A-Za-z0-9._~] - hyphens make newUrl() throw.
        return await proxyConfiguration.newUrl(`zillow_agent_session_${Math.floor(Math.random() * 1e9)}`);
    } catch (error) {
        log.warning(`Could not create proxy URL: ${error.message}`);
        return undefined;
    }
}

async function launchBrowser(proxyUrl) {
    const browser = new StealthBrowser({ proxyUrl });
    await browser.launch();
    return browser;
}

async function warmupBrowser(browser) {
    try {
        await browser.warmup();
        log.info('Browser warmup on Zillow homepage completed.');
    } catch (error) {
        log.warning(`Browser warmup did not complete: ${error.message}`);
    }
}

async function fetchWithRetry(browser, url, proxyConfiguration, rotations, label, fetchOptions, targetPage) {
    let activeBrowser = browser;
    let directAttempted = !proxyConfiguration;

    for (let attempt = 1; attempt <= rotations; attempt++) {
        try {
            const jsonText = await activeBrowser.fetch(url, fetchOptions, targetPage);
            return { browser: activeBrowser, jsonText };
        } catch (error) {
            log.warning(`${label} attempt ${attempt}/${rotations} failed for ${url}: ${error.message}`);
            if (attempt >= rotations) throw error;
            await activeBrowser.close().catch(() => {});
            let proxyUrl;
            if (proxyConfiguration && !directAttempted) {
                directAttempted = true;
                log.warning(`${label} switching to a direct browser session after the proxy session was challenged.`);
            } else {
                proxyUrl = await getProxyUrl(proxyConfiguration);
            }
            activeBrowser = await launchBrowser(proxyUrl);
            await warmupBrowser(activeBrowser);
            await sleep(2000 * attempt);
        }
    }

    throw new Error(`Could not fetch ${url} after ${rotations} rotations.`);
}

async function fetchProfileDetails(browser, profileUrl, profileClients, primaryClientIndex) {
    if (!profileUrl) return { browser, details: {}, failed: false };

    const clientCount = profileClients.length;
    const clientIndexes = Array.from({ length: clientCount }, (_, offset) =>
        (primaryClientIndex + offset) % clientCount,
    );
    for (const clientIndex of clientIndexes) {
        try {
            const jsonText = await fetchProfileHydrationWithImpit(profileClients[clientIndex], profileUrl);
            return {
                browser,
                failed: false,
                details: mapProfileDetails(parsePayload(jsonText, profileUrl)),
            };
        } catch {
            // Try the next already-created session without creating a client per request.
        }
    }

    return { browser, details: {}, failed: true };
}

async function enrichProfilesInParallel(browser, pendingProfiles, profileClients, concurrency) {
    const workerCount = Math.min(concurrency, pendingProfiles.length);
    const results = new Array(pendingProfiles.length);
    let nextIndex = 0;

    const worker = async (workerIndex) => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= pendingProfiles.length) return;

            const pending = pendingProfiles[index];
            const detailResult = await fetchProfileDetails(
                browser,
                pending.profileUrl,
                profileClients,
                workerIndex,
            );
            results[index] = { ...pending, ...detailResult };
        }
    };

    await Promise.all(Array.from({ length: workerCount }, (_, workerIndex) => worker(workerIndex)));

    return { results };
}

async function main() {
    const input = await getActorInput();
    const keyword = cleanText(input.keyword || input.name);
    const location = cleanText(input.location || input.search_location);
    const resultsWanted = normalizeLimit(input.results_wanted ?? input.resultsWanted, 20);
    const maxPages = normalizeLimit(input.max_pages ?? input.maxPages, 3);
    const collectDetails = input.collect_details ?? input.collectDetails ?? false;
    const inputUrls = getInputUrls(input);
    const baseUrls = inputUrls.length > 0 ? inputUrls : [null];

    if (!inputUrls.length && !location && !keyword) {
        throw new Error('Provide a Zillow professionals URL, a location, or an agent name/keyword.');
    }

    const proxyConfiguration = await createProxyConfiguration(input.proxyConfiguration);
    const proxyUrl = await getProxyUrl(proxyConfiguration);
    const profileClient = createImpitClient();

    if (proxyConfiguration && !proxyUrl) {
        log.error(
            'Proxy was configured but no proxy URL could be created. Refusing to run without the requested proxy.',
        );
        throw new Error('Proxy configuration failed: could not create a proxy URL.');
    }

    let browser = await launchBrowser(proxyUrl);
    await warmupBrowser(browser);

    const seen = new Set();
    let saved = 0;
    let pagesFetched = 0;
    let stopReason = 'result limit reached';
    let consecutiveEmptyPages = 0;
    let profileDetailsFetched = 0;
    let profileDetailsUnavailable = 0;

    log.info(
        `Starting Zillow agent scrape | searches=${baseUrls.length} | target=${resultsWanted} | max_pages=${maxPages} | details=${Boolean(collectDetails)}${proxyUrl ? ' | proxy=enabled' : ''}`,
    );

    for (const baseUrl of baseUrls) {
        for (let page = 1; page <= maxPages && saved < resultsWanted; page++) {
            const sourceUrl = buildSearchUrl({ baseUrl, location, keyword, page });
            let nextData;
            try {
                const result = await fetchWithRetry(
                    browser,
                    sourceUrl,
                    proxyConfiguration,
                    MAX_SESSION_ROTATIONS,
                    'Search fetch',
                );
                browser = result.browser;
                nextData = parsePayload(result.jsonText, sourceUrl);
            } catch (error) {
                try {
                    const fallbackPayload = await fetchHydrationOverHttp(sourceUrl);
                    nextData = parsePayload(fallbackPayload, sourceUrl);
                    log.info(`Using HTTP hydration fallback for page ${page}.`);
                } catch (fallbackError) {
                    try {
                        const impitPayload = await fetchProfileHydrationWithImpit(profileClient, sourceUrl);
                        nextData = parsePayload(impitPayload, sourceUrl);
                        log.info(`Using Impit hydration fallback for page ${page}.`);
                    } catch (impitError) {
                        const combinedError = `${error.message}; ${fallbackError.message}; ${impitError.message}`;
                        if (saved > 0) {
                            stopReason = `stopped at page ${page}: ${combinedError}`;
                            log.warning(stopReason);
                            break;
                        }
                        throw new Error(combinedError);
                    }
                }
            }

            const searchResults = getSearchResults(nextData);
            const cards = getProfileCards(searchResults);
            pagesFetched += 1;

            if (!cards.length) {
                consecutiveEmptyPages += 1;
                stopReason = `no agent cards on page ${page}`;
                log.info(`No agent cards returned for ${sourceUrl}`);
                if (consecutiveEmptyPages >= 2) break;
                continue;
            }
            consecutiveEmptyPages = 0;

            const context = {
                searchLocation:
                    nextData?.props?.pageProps?.userInput?.locationText || searchResults?.titleLocation || location,
                resultsFound: searchResults?.resultsFound,
                resultsFoundText: searchResults?.resultsFoundFormattedLabel,
                sourceUrl,
                page,
                scrapedAt: new Date().toISOString(),
            };
            const batch = [];

            const pendingProfiles = [];
            for (const card of cards) {
                const profileUrl = absoluteZillowUrl(card.cardActionLink);
                const key = card.encodedZuid || profileUrl || `${card.cardTitle}:${card.secondaryCardTitle}`;
                if (!key || seen.has(key)) continue;
                seen.add(key);

                const baseRecord = mapSearchCard(card, context);
                pendingProfiles.push({ baseRecord, profileUrl });

                if (saved + pendingProfiles.length >= resultsWanted) break;
            }

            if (collectDetails && pendingProfiles.length) {
                const profileClients = await createProfileClientPool(
                    proxyConfiguration,
                    Math.min(DETAIL_CONCURRENCY, pendingProfiles.length),
                );
                profileClients.push(profileClient);
                const detailBatch = await enrichProfilesInParallel(
                    browser,
                    pendingProfiles,
                    profileClients,
                    DETAIL_CONCURRENCY,
                );
                for (const item of detailBatch.results) {
                    if (item.failed) profileDetailsUnavailable += 1;
                    else profileDetailsFetched += 1;
                    batch.push(cleanRecord({ ...item.baseRecord, ...item.details }));
                }
            } else {
                batch.push(...pendingProfiles.map(({ baseRecord }) => baseRecord));
            }

            if (batch.length) {
                await Actor.pushData(batch);
                saved += batch.length;
                log.info(`Saved ${batch.length} agents from page ${page}. Total: ${saved}/${resultsWanted}`);
            } else {
                log.info(`Page ${page} contained only duplicate agents.`);
            }

            const totalFound = Number(searchResults?.resultsFound);
            if (cards.length < 15 || (Number.isFinite(totalFound) && saved >= totalFound)) {
                stopReason = `all available results reached at page ${page}`;
                break;
            }

            if (page < maxPages && saved < resultsWanted) {
                await sleep(300 + Math.round(Math.random() * 500));
            }
        }

        if (stopReason !== 'result limit reached') break;
    }

    if (saved < resultsWanted && stopReason === 'result limit reached') {
        stopReason = 'all searches completed';
    }

    const detailSummary = collectDetails
        ? ` | details_fetched=${profileDetailsFetched} | details_unavailable=${profileDetailsUnavailable}`
        : '';
    log.info(`Done | saved=${saved} | pages=${pagesFetched}${detailSummary} | stop_reason=${stopReason}`);

    if (browser) await browser.close().catch(() => {});
}

let exitCode = 0;
try {
    await main();
} catch (error) {
    exitCode = 1;
    log.error(error.message);
} finally {
    await Actor.exit({ exitCode });
}
