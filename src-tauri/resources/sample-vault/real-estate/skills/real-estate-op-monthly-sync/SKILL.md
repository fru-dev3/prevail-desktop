---
name: aireadylife-real-estate-op-monthly-sync
type: op
cadence: monthly
description: >
  Full real estate data sync on the 1st of each month. Pulls market data for all target
  markets, updates affordability analysis with current rates, recalculates the buy vs. rent
  model, and triggers the review brief.
  Triggers: "real estate monthly sync", "sync market data", "refresh real estate vault".
---

# aireadylife-real-estate-monthly-sync

**Cadence:** Monthly (1st of month)
**Produces:** Real estate vault refreshed with current market data, updated affordability analysis, and a review brief

## What It Does

The monthly sync is the primary recurring operation that keeps the real estate vault current. It runs on the 1st of each month and coordinates three parallel updates: market data, affordability model, and buy vs. rent analysis. The result is a fully refreshed vault and a ready-to-read review brief summarizing where things stand for the month ahead.

Market data is updated for all configured target markets by calling the market scan flow, which pulls fresh median prices, inventory counts, days on market, and price-to-rent ratios from Zillow or Redfin. Any significant market shifts (greater than 5% month-over-month change in median price, inventory, or DOM) are flagged in open-loops.md.

Affordability is recalculated using the current 30-year fixed mortgage rate. Mortgage rates move frequently — a rate increase of 0.5% on a $400,000 loan reduces purchasing power by roughly $25,000–$35,000. The sync prompts the user to confirm the current rate if the vault value is more than 30 days old, then re-runs the affordability worksheet and stores the result with a timestamp. The delta from the prior month's affordability ceiling is noted so the user can see how rate movements are affecting their buying power in dollar terms.

The buy vs. rent model is also refreshed using the updated target market median price and the user's current rent. If the user's rent has changed since the last sync, this is a prompt to update config.md before the model runs. The updated break-even horizon and 5/7/10-year cost comparison replace the prior month's analysis.

After these three updates, the monthly sync triggers the review brief, which formats all findings into a single readable document and surfaces the most urgent action items.

## Triggers

- "Run the real estate monthly sync"
- "Sync my real estate data"
- "Monthly real estate update"
- "Refresh the real estate vault"

## Steps

1. Confirm `~/Documents/aireadylife/vault/real-estate/config.md` is populated; halt and prompt if required fields are blank
2. Check if `current_30yr_rate` is older than 30 days; prompt user to confirm or update rate before proceeding
3. Call `aireadylife-real-estate-market-scan` to pull fresh market data for all target markets
4. Call `aireadylife-real-estate-affordability-review` to recalculate max purchase price at updated rate
5. Note delta from prior month affordability ceiling (e.g., "Rate increase of 0.25% reduced max purchase price by $18,000")
6. Call `aireadylife-real-estate-run-buy-vs-rent` with updated market prices and current rent
7. Check for any active listings saved in `~/Documents/aireadylife/vault/real-estate/00_current/` and update their DOM count
8. Call `aireadylife-real-estate-update-open-loops` to add new flags and resolve any completed items
9. Trigger `aireadylife-real-estate-review-brief` to compile results into the monthly brief
10. Write sync completion record to `~/Documents/aireadylife/vault/real-estate/00_current/last-sync.md`

## Input

- `~/Documents/aireadylife/vault/real-estate/config.md`
- `~/Documents/aireadylife/vault/real-estate/00_current/` (prior snapshots)
- `~/Documents/aireadylife/vault/real-estate/00_current/` (saved listings to update)
- `~/Documents/aireadylife/vault/real-estate/00_current/` (prior affordability worksheet)
- `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records for trend comparison
- Live data from Zillow or Redfin via web research

## Output Format

**Monthly Sync Summary:**
- Sync date and markets covered
- Rate used for affordability calculation
- Affordability delta from prior month (dollar change in max purchase price)
- Number of significant market shifts flagged
- Buy vs. rent verdict (same as prior month / changed)
- Number of open loop items added / resolved
- Link to full review brief: `vault/real-estate/02_briefs/YYYY-MM-realestate-brief.md`

## Configuration

Required fields in `~/Documents/aireadylife/vault/real-estate/config.md`:
- `gross_monthly_income`, `monthly_debts`, `available_down_payment`
- `current_30yr_rate` (confirm monthly)
- `target_markets`, `max_price`, `min_beds`, `min_baths`, `min_sqft`
- `current_monthly_rent`

## Error Handling

- If config.md is missing or incomplete: halt; direct user to frudev.gumroad.com/l/aireadylife-real-estate
- If market data pull fails for one market: continue sync; note data gap in brief
- If rate not updated in 30+ days: warn user; use stale rate with disclaimer; recommend updating before making decisions
- If prior month snapshot is missing: skip MoM comparison; note first-run status

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/real-estate/config.md`
- Reads from: `~/Documents/aireadylife/vault/real-estate/00_current/`, `01_listings/`, `02_analysis/`
- Writes to: `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-market-report.md`
- Writes to: `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-affordability.md`
- Writes to: `~/Documents/aireadylife/vault/real-estate/02_briefs/YYYY-MM-realestate-brief.md`
- Writes to: `~/Documents/aireadylife/vault/real-estate/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/real-estate/00_current/last-sync.md`
