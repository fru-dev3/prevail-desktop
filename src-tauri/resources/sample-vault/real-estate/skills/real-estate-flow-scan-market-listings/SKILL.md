---
name: aireadylife-real-estate-flow-scan-market-listings
type: flow
trigger: called-by-op
description: >
  Searches configured target neighborhoods for active listings matching criteria and summarizes
  market stats including median price, active inventory, average days on market, price-to-rent
  ratio, and months of supply. Stores a timestamped snapshot for trend tracking over time.
---

# aireadylife-real-estate-scan-market-listings

**Trigger:** Called by `aireadylife-real-estate-market-scan`
**Produces:** Market snapshot table with aggregate stats and filtered active listings per target market

## What It Does

This flow reads the configured search criteria from the vault and assembles a comprehensive market snapshot for each target neighborhood. It applies the user's search filters — price ceiling, minimum bedrooms, minimum bathrooms, minimum square footage — to current listing data sourced from Zillow or Redfin, producing both an aggregate market statistics table and a filtered listing table showing individual homes that match all criteria.

The aggregate market stats captured per neighborhood are: median active list price, active inventory count (number of homes currently listed), median days on market (DOM), median price per square foot, and months of supply (active inventory ÷ average monthly sales — under 3 months signals a seller's market, 3–6 is balanced, above 6 is a buyer's market). The flow also calculates the price-to-rent ratio for each market by dividing the median home price by the annual median rent for comparable units. A price-to-rent ratio below 15 favors buying; 15–20 is a gray zone; above 20 favors renting. The list-to-sale ratio (final sale price as a percentage of original list price) is also captured when available — ratios above 100% indicate homes are selling above list, a sign of a hot market.

Each data point is stored as a monthly snapshot with the run date so trends can be tracked over time. On a second or subsequent run, the flow compares each metric to the prior month's snapshot and calculates the month-over-month change, flagging any metric that has moved more than 5% as a significant market shift.

The filtered listing table shows individual active listings that match the search criteria. Each listing row includes: address, list price, beds/baths, square footage, price per square foot, days on market, and a direct Zillow or Redfin URL. Listings that have been on the market more than 60 days are flagged as potential negotiation opportunities. New listings (posted in the last 7 days) are flagged as fresh inventory.

## Steps

1. Read search criteria from `~/Documents/aireadylife/vault/real-estate/config.md` (target markets, price ceiling, min beds/baths/sqft)
2. For each target market, pull active listing data from Zillow or Redfin via web research
3. Filter listings to only those matching all configured criteria
4. Calculate aggregate market stats per market: median price, active count, median DOM, median price/sqft, months of supply, price-to-rent ratio, list-to-sale ratio
5. Read prior month snapshot from `~/Documents/aireadylife/vault/real-estate/00_current/` and calculate MoM change for each metric
6. Flag any metric that changed more than 5% MoM as a significant market shift
7. Flag individual listings: >60 days on market as negotiation opportunity, <7 days as fresh inventory
8. Write timestamped market snapshot and filtered listing table to `~/Documents/aireadylife/vault/real-estate/00_current/`
9. Return full market snapshot and listing table to the calling op

## Input

- `~/Documents/aireadylife/vault/real-estate/config.md` — target markets, search filters, Zillow/Redfin preference
- `~/Documents/aireadylife/vault/real-estate/00_current/` — prior month snapshots for MoM comparison
- `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records for trend comparison
- Live data: Zillow or Redfin active listings for each target market (via web research)

## Output Format

**Market Stats Table** (one row per target market)
| Market | Median Price | Inventory | Median DOM | $/sqft | Months Supply | Price-to-Rent | MoM Change |

**Significant Shifts** — any metric flagged with >5% MoM change, with direction and magnitude

**Filtered Listings Table** (individual active listings matching criteria)
| Address | Price | Beds/Bath | Sqft | $/sqft | DOM | Flag | URL |

## Configuration

Required fields in `~/Documents/aireadylife/vault/real-estate/config.md`:
- `target_markets` — list of city/state pairs to scan (e.g., ["Minneapolis MN", "Eden Prairie MN"])
- `max_price` — upper price ceiling for listing filter
- `min_beds` — minimum bedroom count
- `min_baths` — minimum bathroom count
- `min_sqft` — minimum square footage
- `listing_source` — preferred source: "zillow" or "redfin"

## Error Handling

- If target_markets is empty: prompt user to configure at least one target market in config.md
- If live listing data is unavailable for a market: note data gap in output; do not error on other markets
- If no listings match filters in a market: output "No matching listings" for that market; still record aggregate stats
- If prior month snapshot is missing: run current month only; note "No prior period for comparison"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/real-estate/config.md`
- Reads from: `~/Documents/aireadylife/vault/real-estate/00_current/` (prior snapshots)
- Writes to: `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-{market-slug}-snapshot.md`
