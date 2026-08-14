## What does Zillow Agent Scraper do?

Zillow Agent Scraper collects public real estate agent and realtor profile data from Zillow Professionals. Use a Zillow Professionals URL, a location, or an agent name keyword to build structured datasets for lead generation, market research, brokerage mapping, and agent performance analysis.

The Actor can collect search result data such as agent name, brokerage, Zillow profile URL, rating, review count, sales metrics, top-agent flag, image URL, and tags. When profile detail collection is enabled, it also collects public contact details, business address, licenses, service areas, specialties, languages, and listing or sales counts when Zillow publishes them.

## Why use Zillow Agent Scraper?

- **Agent lead research** - Build real estate agent lists by city, state, ZIP code, or name search.
- **Brokerage intelligence** - Compare brokerages, teams, ratings, review counts, and public sales metrics.
- **Clean exports** - Download results as JSON, CSV, Excel, XML, or RSS from Apify datasets.
- **Flexible inputs** - Start from a Zillow Professionals URL, a location, or a keyword.
- **Profile enrichment** - Add public phone, email, address, license, service area, and profile details when available.
- **Scheduled monitoring** - Run repeat searches to track changes in local agent directories.

## What data can you extract from Zillow?

| Field                       | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `name`                      | Agent, team, or profile name                     |
| `business_name`             | Brokerage, team, or company name                 |
| `profile_url`               | Direct Zillow profile URL                        |
| `email`                     | Public profile email when available              |
| `phone_cell`                | Public cell phone number when available          |
| `phone_office`              | Public office phone number when available        |
| `business_address`          | Public business address                          |
| `image_url`                 | Agent or team image URL                          |
| `is_top_agent`              | Whether Zillow marks the profile as a top agent  |
| `review_average`            | Average Zillow review rating                     |
| `review_count`              | Number of Zillow reviews                         |
| `team_price_range`          | Displayed team or agent price range              |
| `team_sales_last_12_months` | Displayed recent sales metric                    |
| `team_sales_in_location`    | Displayed sales metric for the searched location |
| `service_areas`             | Public service areas from the profile            |
| `agent_licenses`            | Public license records when available            |
| `source_url`                | Search page URL used for the record              |

## How to use Zillow Agent Scraper

1. Open the Actor on Apify.
2. Paste a Zillow Professionals URL or enter a location.
3. Optionally add an agent name or keyword.
4. Set `results_wanted` and `max_pages`.
5. Keep profile details enabled if you need contact and license fields.
6. Run the Actor and export the dataset.

## Input Parameters

| Parameter            | Type    | Required | Default              | Description                                  |
| -------------------- | ------- | -------- | -------------------- | -------------------------------------------- |
| `url`                | String  | No       | -                    | Zillow Professionals search URL              |
| `keyword`            | String  | No       | -                    | Agent name or keyword for Zillow name search |
| `location`           | String  | No       | `New York, NY`       | Location used when no URL is supplied        |
| `results_wanted`     | Integer | No       | `20`                 | Maximum number of agent records to save      |
| `max_pages`          | Integer | No       | `3`                  | Maximum search result pages to process       |
| `collect_details`    | Boolean | No       | `false`              | Collect extra public profile details         |
| `proxyConfiguration` | Object  | No       | Apify Proxy optional | Proxy settings for larger runs               |

## Output Data

| Field                    | Type    | Description                            |
| ------------------------ | ------- | -------------------------------------- |
| `encoded_zuid`           | String  | Zillow encoded professional identifier |
| `name`                   | String  | Agent or team name                     |
| `business_name`          | String  | Brokerage or team name                 |
| `profile_url`            | String  | Direct Zillow profile URL              |
| `email`                  | String  | Public email when available            |
| `phone_cell`             | String  | Public cell phone when available       |
| `phone_office`           | String  | Public office phone when available     |
| `business_address`       | String  | Public business address                |
| `business_city`          | String  | Business city                          |
| `business_state`         | String  | Business state                         |
| `business_postal_code`   | String  | Business postal code                   |
| `image_url`              | String  | Profile image URL                      |
| `logo_url`               | String  | Brokerage or team logo URL             |
| `is_top_agent`           | Boolean | Zillow top-agent marker                |
| `review_average`         | Number  | Average review rating                  |
| `review_average_text`    | String  | Displayed review rating                |
| `review_count`           | Integer | Review count                           |
| `review_count_text`      | String  | Displayed review count                 |
| `no_reviews_text`        | String  | Displayed no-review label              |
| `team_price_range`       | String  | Displayed team or agent price range    |
| `team_sales_last_12_months` | String | Displayed recent sales metric       |
| `team_sales_in_location` | String  | Displayed sales metric for the location |
| `tags`                   | Array   | Profile tags such as team labels       |
| `profile_name`            | String  | Name published on the detailed profile |
| `profile_types`           | Array   | Zillow profile types                   |
| `profile_photo_url`       | String  | Detailed profile photo URL             |
| `profile_review_average`  | Number  | Detailed profile rating                |
| `profile_review_count`    | Integer | Detailed profile review count          |
| `about`                   | String  | Public profile description              |
| `specialties`            | Array   | Public specialties when available      |
| `languages`              | Array   | Public languages when available        |
| `websites`               | Array   | Public profile websites                |
| `service_areas`          | Array   | Service areas from the public profile  |
| `agent_licenses`         | Array   | Public license records                 |
| `other_licenses`         | Array   | Other public license records           |
| `for_sale_listing_count` | Integer | Count of public for-sale listings      |
| `for_rent_listing_count` | Integer | Count of public for-rent listings      |
| `past_sales_count`       | Integer | Count of public past sales             |
| `review_count_detailed`  | Integer | Count of detailed public reviews       |
| `team_name`              | String  | Detailed profile team name             |
| `team_members_count`     | Integer | Number of public team members         |
| `search_location`        | String  | Location used for the search           |
| `results_found`          | Integer | Numeric total reported by Zillow      |
| `results_found_text`     | String  | Zillow result count label              |
| `source_url`             | String  | Source search URL                      |
| `page`                   | Integer | Search result page number              |
| `scraped_at`             | String  | ISO timestamp for the saved record     |

## Usage Examples

### Search by Zillow Professionals URL

Collect agents from a specific Zillow Professionals location page:

```json
{
    "url": "https://www.zillow.com/professionals/real-estate-agent-reviews/new-york-ny/",
    "results_wanted": 20,
    "max_pages": 2,
    "collect_details": false
}
```

### Search by agent name in a location

Find agents matching a name or keyword in New York:

```json
{
    "keyword": "gary",
    "location": "New York, NY",
    "results_wanted": 50,
    "max_pages": 4,
    "collect_details": true
}
```

### Search by location only

Collect top directory results for a city:

```json
{
    "location": "Seattle, WA",
    "results_wanted": 100,
    "max_pages": 7,
    "collect_details": false
}
```

## Sample Output

```json
{
    "encoded_zuid": "X1-ZUyydtqq6p0gll_a6mey",
    "name": "Gary Papirov",
    "business_name": "Homes R Us Realty",
    "profile_url": "https://www.zillow.com/profile/Gary%20Papirov",
    "email": "example@example.com",
    "phone_cell": "(555) 555-0100",
    "business_address": "Example Street, New York, NY 10001",
    "image_url": "https://photos.zillowstatic.com/fp/example-h_l.jpg",
    "is_top_agent": true,
    "review_average": 5,
    "review_count": 594,
    "team_price_range": "$135K - $4.3M",
    "team_sales_last_12_months": "246",
    "team_sales_in_location": "2,398",
    "tags": ["TEAM"],
    "service_areas": ["New York", "Brooklyn", "Queens"],
    "results_found_text": "97 agents found",
    "source_url": "https://www.zillow.com/professionals/real-estate-agent-reviews/new-york-ny/?name=gary",
    "page": 1,
    "scraped_at": "2026-08-07T08:30:00.000Z"
}
```

## Tips for Best Results

- Use a full Zillow Professionals URL when you already have the exact city or filter page.
- Use `keyword` for agent or team names, not broad property terms.
- Start with `20` results for testing, then raise `results_wanted`.
- Keep `collect_details` off when you only need search result fields and faster runs.
- Turn on `collect_details` when you need public contact, license, service area, and profile fields.
- Some contact, license, service area, and sales fields may be missing because Zillow does not publish them on every profile.
- For cloud runs at scale, enable residential proxy settings.
- If Zillow presents a verification page, use residential proxy settings and retry with a fresh run. Keeping a single proxy session for a run usually gives the most consistent results.

## Integrations

- **Google Sheets** - Send agent records to spreadsheets for review.
- **CRM tools** - Import CSV or Excel exports for lead workflows.
- **Webhooks** - Trigger downstream processing after each run.
- **Make or Zapier** - Connect datasets to no-code automations.
- **API access** - Read dataset items programmatically from Apify.

## Frequently Asked Questions

### Can I scrape Zillow agents by city?

Yes. Enter a location such as `New York, NY`, `Seattle, WA`, or a ZIP code, or paste a Zillow Professionals city URL.

### Can I search by agent name?

Yes. Use `keyword` to search Zillow's agent directory by name or team keyword.

### Why are some contact fields missing?

Some profiles do not publish every contact field. The Actor skips empty values instead of filling the dataset with nulls.

### Can I export Zillow agent data to CSV or Excel?

Yes. Apify datasets can be exported to CSV, Excel, JSON, XML, RSS, and other formats.

### Can I schedule repeat Zillow agent searches?

Yes. Use Apify schedules to refresh agent datasets daily, weekly, or at another interval.

### Is it legal to scrape Zillow agent data?

Scraping public web data can be legal, but you are responsible for complying with applicable laws, Zillow terms, and privacy rules.

## Related Actors

- [StreetEasy Scraper](https://apify.com/shahidirfan/streeteasy-scraper)
- [Domain.com.au Property Scraper](https://apify.com/shahidirfan/domain-com-au-property-scraper)
- [OpenRent Property Scraper](https://apify.com/shahidirfan/openrent-property-scraper)

## Support

For issues, feature requests, or custom Actor work, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is designed for legitimate collection of publicly available Zillow Professionals data. Users are responsible for using the data responsibly and complying with applicable laws, platform terms, and privacy requirements.
