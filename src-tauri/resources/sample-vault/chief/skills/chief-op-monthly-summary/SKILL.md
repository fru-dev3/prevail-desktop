---
name: prevail-chief-op-monthly-summary
type: op
cadence: monthly
description: >
  End-of-month rollup. Aggregates the four weekly reviews + per-domain
  state changes into a single monthly summary used for quarterly
  planning. Counts shipped vs. slipped, surfaces compounding wins
  ("third month in a row I logged ≥4 workouts/week"), flags areas with
  zero movement. Triggers: "monthly review", "month in review", "how
  was this month", "end of month summary", "monthly rollup".
---

# chief-op-monthly-summary

**Cadence:** Monthly (last day of month, 17:00 local)
**Produces:** `vault/chief/02_briefs/YYYY-MM.md`

## What It Does

Reads the four weekly reviews from the month and synthesizes them into
ONE monthly summary. Quantifies progress where possible.

Sections:

1. **Top 3 wins** (the most consequential, not the easiest)
2. **Top 3 misses** (what was on the board start-of-month that didn't move)
3. **Compounding patterns** — 3+ consecutive months of consistent action
4. **Areas with zero movement** — domains whose `state.md` didn't change
5. **Calibration delta** — did your gut-vs-council accuracy improve this month?
6. **Spend / saved** — if wealth connector synced, monthly cash-flow headline
7. **Quarter-to-date** — running tally toward this quarter's OKRs

## Inputs

- `vault/chief/02_briefs/week-YYYY-WW.md` for the 4-5 weeks in this month
- Every `<domain>/state.md` (mtime + content diff)
- `vault/chief/00_current/okrs.md` (quarterly targets)
- `vault/wealth/_log/YYYY-MM-*.md` (if Plaid connector is syncing)

## Outputs

- `vault/chief/02_briefs/YYYY-MM.md` (one per month)
- Updates `vault/chief/state.md` "this month" section
