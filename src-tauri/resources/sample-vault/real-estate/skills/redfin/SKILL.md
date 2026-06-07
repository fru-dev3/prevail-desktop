---
name: redfin
type: app
description: >
  Pulls active listings, comparable sales, market statistics, and property estimates from Redfin
  via web research. Used by real-estate-agent for market analysis, affordability calculations,
  and listing tracking. Configure target search areas in vault/real-estate/config.md.
---

# Redfin

**Auth:** No authentication required for public data (web research)
**URL:** https://www.redfin.com
**Configuration:** Set target search areas and filters in `~/Documents/aireadylife/vault/real-estate/config.md`

## Data Available

- Active listings for a city, zip code, or neighborhood with all standard filters (price, beds, baths, sqft, home type)
- Property detail: list price, beds, baths, sqft, lot size, year built, HOA fee, garage
- Days on market and full price history per listing (reductions, relists)
- Redfin Estimate (AVM — automated valuation model) for any address
- Recent comparable sales: sold price, days on market before sale, sold vs. list price ratio, sale date
- Market stats by city or zip: median sale price, homes sold per month, median DOM, sale-to-list ratio, percentage of homes that sold above list
- School district ratings and walkability scores per listing

## Configuration

Add to `~/Documents/aireadylife/vault/real-estate/config.md`:
```
listing_source: redfin
target_markets:
  - "Minneapolis MN"
  - "Eden Prairie MN"
max_price: 500000
min_beds: 3
min_baths: 2
min_sqft: 1500
```

## Key Data Points for Market Analysis

- **Median Sale Price:** Use for price trend tracking; compare MoM and YoY
- **Sale-to-List Ratio:** >100% = seller's market; <97% = buyer has leverage
- **Median DOM:** <21 days = highly competitive; 30–60 = normal; >90 = buyer's market
- **Homes Sold Above List:** >30% = offers need to be aggressive
- **Months of Supply:** derived from active inventory ÷ monthly sales rate

## Notes

- Redfin data is available publicly without login for most metrics
- CSV download of search results available via search results page (may require login)
- Market stats available under "Housing Market" section for each city: redfin.com/city/[name]/housing-market
- Redfin Estimate may differ from Zillow Zestimate by 2–5%; use both when precision matters
- For sold comparables, filter to "sold in the last 6 months" for most relevant pricing data

## Used By

- `aireadylife-real-estate-market-scan` — pull active listings and market stats for all target markets
- `aireadylife-real-estate-scan-market-listings` — get current inventory, prices, and DOM data
- `aireadylife-real-estate-run-buy-vs-rent` — gather rental comp data for the rent side of the model
- `aireadylife-real-estate-log-listing` — look up Redfin Estimate and price history for a saved listing

## Vault Output

`~/Documents/aireadylife/vault/real-estate/00_current/`
