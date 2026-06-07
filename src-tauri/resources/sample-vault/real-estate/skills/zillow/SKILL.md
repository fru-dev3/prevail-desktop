---
name: zillow
type: app
description: >
  Fetches Zestimate property valuations, active listings, rental estimates, and market trend
  data from Zillow via web research. Used by real-estate-agent for market scanning, property
  valuation, and investment analysis. Configure in vault/real-estate/config.md.
---

# Zillow

**Auth:** No authentication required for public data (web research); Zillow Bridge API via RapidAPI for programmatic Zestimate lookups
**URL:** https://www.zillow.com
**Configuration:** Set search areas and API key in `~/Documents/aireadylife/vault/real-estate/config.md`

## Data Available

- **Zestimate:** Zillow's automated property valuation for any US address. Accuracy: typically within 2–5% of sale price for on-market homes; less reliable for off-market or unique properties. Includes 12-month Zestimate trend.
- **Active listing prices** for a search area with full filter support (price, beds, baths, sqft, home type, days on market)
- **Recent comparable sales** (sold price, date sold, vs. list price, beds/baths/sqft)
- **Rental Zestimate:** Zillow's rent estimate for a specific address — critical for investment property analysis and buy vs. rent comparisons
- **Market trend stats:** median list price, median days on market, price cut frequency, number of homes listed
- **Price history** for a specific property (all price changes, listing and relisting dates)
- **Home details:** year built, HOA fees, school ratings, lot size, parking, last sale price and date

## Configuration

Add to `~/Documents/aireadylife/vault/real-estate/config.md`:
```
listing_source: zillow
zillow_rapidapi_key: YOUR_KEY   # optional; for programmatic Zestimate lookups
target_markets:
  - "Minneapolis MN"
  - "Eden Prairie MN"
max_price: 500000
min_beds: 3
min_baths: 2
min_sqft: 1500
```

## Key Investment Analysis Use Cases

- **Rental Zestimate for 1% rule check:** monthly rent ÷ purchase price ≥ 1% is the threshold. Example: a $300,000 home passing the 1% rule needs to rent for $3,000/month. Use Rental Zestimate to verify this is achievable before running full cap rate analysis.
- **Zestimate for cap rate denominator:** cap rate = annual NOI ÷ current property value. Use Zestimate as the current value estimate for owned properties in the estate plugin.
- **Price-to-Zestimate ratio:** comparing a listing's ask price to its Zestimate reveals whether it's priced above, at, or below market — useful for negotiation and offer strategy. A listing at 95% of Zestimate has more room than one at 110%.

## Notes

- Zillow Bridge API (available via RapidAPI) enables programmatic Zestimate lookups for multiple addresses without manual web research
- Web research access is sufficient for one-off lookups and market snapshots
- Zestimate is an estimate, not an appraisal — use alongside Redfin Estimate and recent comps for best accuracy
- For rental income estimates, Zillow Rental Zestimate is available on the property detail page under "Rent vs. Buy" section

## Used By

- `aireadylife-real-estate-market-scan` — scan active listings in target cities matching filters
- `aireadylife-real-estate-scan-market-listings` — pull current inventory, prices, and DOM trends
- `aireadylife-real-estate-log-listing` — look up Zestimate and rental estimate for a saved listing
- `aireadylife-real-estate-run-buy-vs-rent` — pull Rental Zestimate for the rent side of the model

## Vault Output

`~/Documents/aireadylife/vault/real-estate/00_current/`
