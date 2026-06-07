---
name: zillow
type: app
description: >
  Fetches Zestimate property valuations, rental estimates, and market trend data from Zillow
  via web research. Used by estate-agent for portfolio valuation updates, cap rate calculation,
  and rental market comparison. Configure target property addresses in vault/estate/config.md.
---

# Zillow

**Auth:** No authentication required for public data (web research); Zillow Bridge API via RapidAPI for programmatic lookups
**URL:** https://www.zillow.com
**Configuration:** Set property addresses and optional API key in `~/Documents/aireadylife/vault/estate/config.md`

## Data Available

- **Zestimate:** Automated property valuation for any US address. Used as the current market value for cap rate calculations: cap rate = annual NOI ÷ Zestimate. Zestimate accuracy: typically within 2–5% of sale price for residential properties.
- **Zestimate history:** 12-month trend shows whether a property is appreciating or declining — key for hold/sell analysis.
- **Rental Zestimate:** Zillow's rent estimate for a specific address. Use to benchmark current rent against market: if tenant is paying $1,800/month and Rental Zestimate is $2,100, the unit is under-market — consider a rent increase at renewal.
- **Comparable recent sales:** Properties sold within 0.5 miles, with sold price, date, beds/baths/sqft, and sold-to-list ratio. Use for more precise equity valuation than Zestimate alone.
- **Market trend stats:** Median list price, median days on market, price cut frequency for the immediate neighborhood — useful for vacancy pricing decisions.
- **Property details:** Year built, lot size, beds/baths, sqft, HOA fees — needed for depreciation calculations (land value is the component of Zillow's detail page that estimates land vs. improvement value).

## Configuration

Add to `~/Documents/aireadylife/vault/estate/config.md`:
```
zillow_rapidapi_key: YOUR_KEY   # optional
estate_properties:
  - address: "123 Main St, Minneapolis MN 55401"
    slug: main-st
  - address: "456 Oak Ave, St Paul MN 55102"
    slug: oak-ave
```

## Key Investment Property Use Cases

**Cap rate calculation:** Pull Zestimate as current value. Cap rate = (annual rent × 12 × (1 − vacancy%) − annual operating expenses) ÷ Zestimate. A property with $25,000 annual NOI and a $350,000 Zestimate has a 7.1% cap rate.

**Rent benchmarking for renewal decisions:** Compare tenant's current rent to Rental Zestimate. If current rent is more than 5% below Rental Zestimate, flag for rent increase at next renewal. The Rental Zestimate is available on the property detail page under the "Rent" tab.

**Equity tracking:** Equity = Zestimate minus outstanding mortgage balance. Run monthly during portfolio review to track equity growth through appreciation and principal paydown.

**Land value estimate:** The property detail page sometimes shows an estimated land value separate from improvement value. Use this to calculate the depreciable basis for Schedule E: depreciable basis = purchase price minus land value.

## Notes

- Zestimate is most accurate for conventional single-family homes in dense suburban markets — less reliable for rural, unique, or multi-family properties
- Supplement Zestimate with Redfin Estimate and recent comps for precision decisions (hold/sell)
- Rental Zestimate is available on property pages in most US markets
- Zillow Bridge API (via RapidAPI): programmatic access to Zestimate for multiple addresses simultaneously

## Used By

- `aireadylife-estate-portfolio-review` — pull Zestimate for each owned property for equity and cap rate calculation
- `aireadylife-estate-tenant-review` — pull Rental Zestimate to benchmark current rent against market

## Vault Output

`~/Documents/aireadylife/vault/estate/00_current/`
