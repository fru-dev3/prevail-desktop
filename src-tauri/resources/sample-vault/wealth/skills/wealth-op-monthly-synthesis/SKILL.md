---
name: aireadylife-wealth-op-monthly-synthesis
type: op
cadence: monthly
description: >
  Full monthly wealth synthesis. Runs after monthly account statements are downloaded
  (typically the 3rd of the month). Calls net worth review, cash flow review, and
  investment review in sequence. Produces a consolidated wealth synthesis document and
  then triggers the wealth review brief. Triggers: "monthly wealth synthesis", "wealth
  summary", "net worth delta", "how did my wealth change this month", "run the monthly
  wealth sync".
---

# aireadylife-wealth-monthly-synthesis

**Cadence:** Monthly (3rd of month, after statements are downloaded)
**Produces:** Wealth synthesis at `vault/wealth/02_briefs/YYYY-MM-wealth-synthesis.md`; then triggers `aireadylife-wealth-review-brief`

## What It Does

The monthly synthesis is the master wealth operation. It runs on the 3rd of each month — after most financial institutions have published the prior month's statements — and orchestrates the full wealth review across all sub-domains in sequence.

**Phase 1: Net Worth.** Calls `aireadylife-wealth-net-worth-review` to aggregate all account balances and compute the authoritative net worth number with MoM delta.

**Phase 2: Cash Flow.** Calls `aireadylife-wealth-cash-flow-review` to summarize income and expenses, compare to budget targets, and flag overages. At this phase, the synthesis also checks whether the MoM net worth change is broadly consistent with the net cash flow — large discrepancies surface data quality issues (missing accounts, unrecorded income, unrealized investment gains).

**Phase 3: Investments.** Calls `aireadylife-wealth-investment-review` to compute account-level returns, check allocation drift, and verify 401k contribution pace.

**Synthesis document.** After the three reviews complete, the op writes a synthesis document that combines the key outputs: net worth (number and MoM delta), net cash flow (total income minus total expenses), total investments (value and MoM change), savings rate for the month, active open-loop count by severity, and 3-5 prioritized actions for the month. The synthesis document is a single-page executive view that references the detailed sub-documents for anyone who wants to drill down.

**Cross-domain signals.** The synthesis checks for events that affect other plugins: RSU vests or ESPP purchases that create taxable income (route note to tax plugin if installed), HSA balance crossing the investment threshold (note to benefits plugin), income change that affects tax estimated payment calculations.

The synthesis concludes by triggering `aireadylife-wealth-review-brief` to produce the formatted monthly brief.

## Configuration

Set in `vault/wealth/config.md`:
- `monthly_sync_day` — override default (3) if needed
- `institution_list` — all accounts for which statements should be downloaded before synthesis runs

## Calls

- **Ops:** `aireadylife-wealth-net-worth-review`, `aireadylife-wealth-cash-flow-review`, `aireadylife-wealth-investment-review`
- **Then triggers:** `aireadylife-wealth-review-brief`

## Apps

None directly (each sub-op uses its own configured data sources)

## Vault Output

- `vault/wealth/02_briefs/YYYY-MM-wealth-synthesis.md` — cross-domain synthesis document
- `vault/wealth/00_current/current-net-worth.md` — updated headline number
- `vault/wealth/open-loops.md` — all new flags from all sub-reviews
- `vault/wealth/02_briefs/YYYY-MM-wealth-brief.md` — monthly brief (produced by triggered op)

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/wealth/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/wealth/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/wealth/02_briefs/` — prior briefs for period-over-period context
