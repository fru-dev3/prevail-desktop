---
name: aireadylife-wealth-op-investment-review
type: op
cadence: monthly
description: >
  Monthly investment performance review. Calculates 30-day and YTD returns for each
  investment account (401k, Roth IRA, Traditional IRA, HSA invested, brokerage). Checks
  actual asset allocation vs. target and flags any asset class drifted more than 5
  percentage points. Checks 401k contribution pace against the $23,500 2025 IRS limit.
  Triggers: "investment review", "check my portfolio", "am I due for rebalancing",
  "how are my investments doing", "portfolio check".
---

# aireadylife-wealth-investment-review

**Cadence:** Monthly (1st of month)
**Produces:** Investment performance summary at `vault/wealth/00_current/YYYY-MM-performance.md`; rebalancing flags in `vault/wealth/open-loops.md`

## What It Does

Pulls investment account data from `vault/wealth/00_current/` and runs `aireadylife-wealth-analyze-investment-performance` to produce a complete investment health check across all accounts.

**Returns.** For each account, the review reports 30-day and YTD returns in both dollar and percentage terms. Returns are time-weighted where possible (to eliminate the distortion of large contributions mid-period). If a Fidelity or M1 Finance download has been completed, the return data from the institution is used directly; otherwise, the return is approximated from balance changes net of contributions.

**Allocation.** The review checks current allocation across the entire invested portfolio — not per account — since rebalancing opportunities may exist across accounts. When an asset class has drifted more than 5 percentage points from target, the review surfaces a specific rebalancing action: "Buy $X of [fund/asset class] in [account]" or "Sell $X of [fund/asset class] in [account]." Tax-advantaged accounts are recommended for rebalancing first to avoid triggering taxable capital gains. The op never recommends specific securities — only asset classes — and always surfaces the flag as "consider rebalancing" not "you must rebalance."

**401k pace.** If the 401k contribution rate in config.md implies a full-year contribution below the 2025 IRS limit of $23,500 (or $31,000 if age 50+), the op calculates the per-paycheck increase needed to close the gap. Example: "At your current $800/paycheck (biweekly), you'll contribute $20,800 by year-end — $2,700 short of the limit. Increasing to $904/paycheck would max out."

**IRA deadline.** Near April 15 (within 60 days), the op checks IRA YTD contributions vs. the $7,000 limit and flags if the prior-year contribution window is still open.

## Calls

- **Flows:** `aireadylife-wealth-analyze-investment-performance`
- **Tasks:** `aireadylife-wealth-update-open-loops`

## Apps

None (reads from vault; Fidelity, M1, or brokerage downloads must be in vault before this op runs)

## Vault Output

- `vault/wealth/00_current/YYYY-MM-performance.md` — performance and allocation summary
- `vault/wealth/open-loops.md` — rebalancing flags and 401k pace alerts

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/wealth/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/wealth/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/wealth/02_briefs/` — prior briefs for period-over-period context
