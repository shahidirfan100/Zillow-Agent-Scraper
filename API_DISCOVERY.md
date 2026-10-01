## API discovery for Zillow Agent Scraper

### Selected source

- Endpoint: `https://www.zillow.com/professionals/real-estate-agent-reviews/<location>/`
- Method: `GET`
- Query parameters: `name=<keyword>` and `page=<number>`
- Authentication: No account authentication; Zillow may require a browser session to pass its anti-bot challenge
- Response: server-rendered HTML containing `script#__NEXT_DATA__` JSON
- JSON marker: `props.pageProps.displayData.agentDirectoryFinderDisplay.searchResults`
- Pagination: `page`, with 15 cards per page in the observed response
- Selected fields: `encodedZuid`, `cardTitle`, `secondaryCardTitle`, `cardActionLink`, `imageUrl`, `logoUrl`, `isTopAgent`, `reviewInformation`, `profileData`, `tags`, `resultsFound`, and `resultsFoundFormattedLabel`
- Profile enrichment fields: `displayUser`, `professionalInformation`, `agentLicenses`, `otherLicenses`, `serviceAreas`, `forSaleListings`, `forRentListings`, `pastSales`, `reviewsData`, and team information
- Browser/runtime decision: use Patchright Chrome to establish and reuse the session, then parse the structured JSON payload. No visible DOM selectors are used for extraction.

The selected source exposes substantially more structured data than the previous HTML-card parsing path. It scores 70 under the updater rubric: more than 15 unique fields (+25), no account authentication (+20), pagination (+15), and a match to the existing actor fields (+10). It does not receive the direct-JSON bonus because the payload is embedded in the page response.

### Discovery evidence

URLScan search was run first for `domain:zillow.com` and `domain:zillow.com AND page.url:professionals`. Public professional-page scan results were found, but the result endpoint required a URLScan login in this environment, so its request bodies could not be inspected. The page was then checked for hydration payloads and JSON-LD, followed by exact mobile/app header probes.

| Candidate | Header/session | Status and marker | Fields | Pagination | Decision |
| --- | --- | --- | ---: | --- | --- |
| Professionals page `__NEXT_DATA__` | Patchright Chrome session | Local run returned 200 with JSON marker | 20+ card fields | `page` | Selected |
| Professionals page `__NEXT_DATA__` | iOS Safari headers | Probe returned 200, 356 KB, JSON marker | 20+ card fields | `page` | Valid discovery result; not the runtime path |
| Professionals page `__NEXT_DATA__` | Android/okhttp headers | Probe returned 200, 375 KB, JSON marker | 20+ card fields | `page` | Valid discovery result; not the runtime path |
| Professionals page `__NEXT_DATA__` | Desktop Chrome HTTP request | Probe returned 403 | 0 | N/A | Rejected |
| `/graphql` AgentDirectoryFinderSearch | Direct HTTP or replayed cookies | 403 PerimeterX response | Rich but unavailable | GraphQL page input | Rejected |
| `/_next/data/<buildId>/professionals/...json` | Direct HTTP | 404 | 0 | URL path | Rejected |
| `/professionals/api/region/` | Direct HTTP | Region helper only; no agent cards | Location metadata | N/A | Not needed |

The mobile probes proved that the hydration source can be exposed by alternate request profiles, but the existing investigation also showed that repeated direct requests can be blocked or poison the source IP. Patchright Chrome is therefore retained as the reliable runtime delivery method, with one warmed session reused across search and profile pages.

### Data-quality decisions

- Deduplicate by Zillow `encodedZuid`, then profile URL, then a name/brokerage fallback.
- Drop null, undefined, empty-string, empty-array, and empty-object values before pushing records.
- Normalize review ratings and counts to numbers and top-agent flags to booleans.
- Normalize Zillow label variants such as `sale_last_12_months` and location-specific sale labels to the existing canonical fields `team_sales_last_12_months` and `team_sales_in_location`.
- Keep optional profile fields absent when Zillow does not publish them; do not manufacture null placeholders.

### Rejected implementation alternatives

- GraphQL was rejected because direct replay and cookie replay both returned PerimeterX blocks.
- The normal Next.js data route was rejected because the observed route returned 404.
- DOM extraction was rejected because the richer structured payload is available in the page bootstrap and does not depend on selectors.
- Direct HTTP-only extraction was not selected for production because the browser session is needed for consistent challenge handling across Zillow pages.

### Follow-up research after the cloud run

Two current third-party Apify listings describe additional names, but neither publishes a replayable Zillow request:

- `powerai/zillow-agents-search-scraper` calls its source `searchAgentsV2` and returns the same card shape, but does not document a Zillow host, request body, or authorization-free endpoint.
- `sian.agency/zillow-agent-scraper` describes `/agent/search` pagination and `/agent/details` enrichment, but those paths are product descriptions rather than verified Zillow endpoints.

The first cloud run reached Zillow but stayed on the verification page for every proxy session and returned no `__NEXT_DATA__`. The implementation now limits browser hydration polling to 12 seconds, shortens warmup, switches from the injected residential proxy to a direct browser session after the first challenge, and validates iOS Safari and Android hydration requests as a final HTTP fallback. This prevents a blocked cloud session from consuming the full run window while retaining the richer structured source when any delivery path succeeds.

### Impit browser-profile validation (live probe)

Every profile exposed by the installed `impit` (0.14.x) was requested against
`https://www.zillow.com/professionals/real-estate-agent-reviews/new-york-ny/` and checked for
`script#__NEXT_DATA__` plus 15 `AgentDirectoryFinderProfileResultsCard` entries and
`resultsFound=70553`. Requests were issued one at a time from a single residential-quality IP.

| Impit profile | Status | Payload | Cards | Decision |
| --- | ---: | --- | ---: | --- |
| `chrome` (default) | 403 | none | 0 | Blocked |
| `chrome100`-`chrome136` | 403 | none | 0 | Blocked |
| `chrome142` | 200 | `__NEXT_DATA__` | 15 | Selected |
| `chrome151` | 200 | `__NEXT_DATA__` | 15 | Selected |
| `firefox` / `firefox128` / `firefox133` / `firefox135` | 403 | none | 0 | Blocked |
| `firefox144` | 200 | `__NEXT_DATA__` | 15 | Selected |
| `okhttp` / `okhttp3` / `okhttp4` / `okhttp5` | 200 | `__NEXT_DATA__` | 15 | Selected |
| `ios18` | 200 | `__NEXT_DATA__` | 15 | Selected |

Two consecutive full passes returned the payload for every selected profile. A third pass
returned `403` for all profiles, which shows the block is applied to the source IP after a
burst of direct requests rather than to a specific fingerprint. The runtime therefore rotates
`chrome151`, `chrome142`, `firefox144`, `okhttp5`, `okhttp4`, `okhttp3`, `okhttp`, and `ios18`,
and issues each attempt through a fresh proxy identity. When all profile slots have been used
once, the pool rebuilds every slot with a new proxy session. `impit` is pinned to `^0.14.5`
because `chrome151` is only present in that release and later.

### Delivery priority update

The live evidence changes the delivery order. A clean HTTP request with a current profile
returns the same structured payload as the browser without the verification-page stall seen in
the first cloud run. The actor now tries the rotating HTTP profile pool first, then the native
iOS/Android header fallback, and only launches Patchright Chrome when both HTTP paths fail.
The browser path is unchanged and remains the final recovery layer.
