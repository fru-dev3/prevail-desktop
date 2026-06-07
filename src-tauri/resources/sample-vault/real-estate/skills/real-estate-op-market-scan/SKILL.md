---
name: aireadylife-real-estate-op-market-scan
type: op
cadence: monthly
description: >
  Monthly market scan for target neighborhoods tracking median price, inventory, days on market,
  price/sqft, months of supply, and price-to-rent ratio. Flags significant shifts and buy-window
  signals. Triggers: "market scan", "real estate market", "home prices", "housing market update",
  "what's the market doing".
---

# aireadylife-real-estate-market-scan

**Cadence:** Monthly (1st of month)
**Produces:** Market trend report for configured target neighborhoods with key metrics, MoM changes, and buy-window signals

## What It Does

This op runs a monthly snapshot of housing market conditions in each of the user's configured target neighborhoods, building a running data series that reveals whether the market is heating, cooling, or holding steady. Tracking market conditions monthly is how you avoid buying at a peak or missing a window during a temporary dip.

The four core metrics tracked per market are: median active list price (the price point most sellers are asking, which predicts near-term transaction prices), active inventory (total number of homes listed — falling inventory is the earliest signal of a heating market), median days on market (how long homes sit before going under contract — DOM below 14 is extremely competitive, 30–60 is normal, above 90 signals buyer leverage), and median price per square foot (the most apples-to-apples metric across home sizes). From these, the op also calculates months of supply (active inventory ÷ average monthly closings). The rule of thumb: under 3 months is a seller's market, 3–6 balanced, over 6 is a buyer's market. The list-to-sale ratio — what percentage of list price homes are actually selling for — provides a real-time competitiveness signal: ratios above 100% mean homes are selling over asking.

The op compares each metric to the prior month's snapshot and year-over-year (same month prior year) to distinguish seasonal patterns from structural trends. A market where inventory has dropped 20% YoY but prices are only up 5% may be signaling an early accumulation phase. A market where DOM has dropped from 45 to 12 over three months is heating rapidly.

Buy-window signals are flagged when three or more of the following conditions exist simultaneously: inventory declining more than 10% MoM, DOM falling more than 15% MoM, price-to-rent ratio below 18, mortgage rates declining from prior month, and new listings in the past 7 days matching the user's criteria. When a buy-window signal fires, it is written to open-loops.md and surfaced prominently in the next morning brief.

## Triggers

- "Run the market scan"
- "What's the housing market doing in [city]?"
- "Home prices this month"
- "Real estate market update"
- "Is it a good time to buy?"
- "Market conditions for [city/neighborhood]"
- "How's inventory in [city]?"
- "Monthly real estate scan"

## Steps

1. Read target markets and search criteria from `~/Documents/aireadylife/vault/real-estate/config.md`
2. Call `aireadylife-real-estate-scan-market-listings` to pull current listings and market stats for each target market
3. Read prior month and prior year snapshots from `~/Documents/aireadylife/vault/real-estate/00_current/` for comparison
4. Calculate MoM and YoY change for: median price, active inventory, median DOM, price/sqft, months of supply
5. Flag any metric with >5% MoM change as a significant shift
6. Evaluate buy-window signal criteria; flag if 3+ conditions are met
7. Log any buy-window signals or significant shifts to open-loops.md
8. Write market trend report to `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-market-report.md`
9. Call `aireadylife-real-estate-update-open-loops` with any flagged signals
10. Present full report with narrative summary and tables

## Input

- `~/Documents/aireadylife/vault/real-estate/config.md` — target markets, search filters
- `~/Documents/aireadylife/vault/real-estate/00_current/` — prior snapshots for comparison
- `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records for trend comparison
- Live market data from Zillow or Redfin (via web research)

## Output Format

**Market Snapshot Table** (one row per target market):
| Market | Median Price | MoM% | Inventory | MoM% | Median DOM | MoM% | $/sqft | Months Supply | Price-to-Rent | List-to-Sale |

**Significant Shifts** — bulleted list of any metric that changed >5% MoM, with direction and magnitude

**Buy-Window Signal** — if triggered: bold callout with which conditions are met and recommended action

**YoY Comparison Table** — same metrics vs. same month prior year

**Filtered Active Listings** — listings matching the user's search criteria with address, price, DOM, and URL

## Configuration

Required fields in `~/Documents/aireadylife/vault/real-estate/config.md`:
- `target_markets` — list of city/state pairs
- `max_price`, `min_beds`, `min_baths`, `min_sqft`
- `listing_source` — "zillow" or "redfin"

## Error Handling

- If no prior snapshot exists: run current month only; note "First run — no prior period for comparison"
- If a target market returns no data: note the gap; continue scanning other markets
- If listing data is unavailable: generate aggregate note without filtered listings table
- If open-loops.md is missing: create it with the first flag entry

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/real-estate/config.md`
- Reads from: `~/Documents/aireadylife/vault/real-estate/00_current/` (prior snapshots)
- Writes to: `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-market-report.md`
- Writes to: `~/Documents/aireadylife/vault/real-estate/open-loops.md`
