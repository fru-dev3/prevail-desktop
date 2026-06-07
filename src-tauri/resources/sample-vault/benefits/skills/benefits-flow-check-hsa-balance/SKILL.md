---
name: aireadylife-benefits-flow-check-hsa-balance
type: flow
trigger: called-by-op
description: >
  Reads HSA account data to produce a complete balance snapshot: cash vs. invested balances, YTD contributions by source (employee/employer) vs. IRS limit for coverage tier, projected year-end pace, investment threshold comparison, and pending qualified expense reimbursement list. Returns all data to the calling op.
---

## What It Does

Called by `aireadylife-benefits-op-hsa-review` to produce the core HSA analysis data. Reads all HSA account data from `vault/benefits/00_current/` and performs all calculations needed for the monthly HSA review. Returns structured data to the calling op for brief writing and open loop flagging.

**Balance breakdown:** Reads the most recent HSA statement and extracts: cash balance (the money market portion held liquid), invested balance (the investment sleeve), and total balance. Distinguishes between these because only the invested balance is compounding; cash above the investment threshold is essentially idle.

**Contribution tracking with limit enforcement:** The IRS annual HSA contribution limit for 2025 is $4,300 (self-only HDHP) or $8,550 (family HDHP), with an additional $1,000 catch-up for age 55+. Reads YTD employee payroll contributions and any YTD employer contributions from the statement. Computes total YTD contributions and compares to the limit for the user's coverage tier. Identifies remaining contribution room (limit − total YTD). Projects year-end total at the current monthly contribution rate. If on pace to undershoot the limit: calculates the additional monthly contribution needed to reach it.

**Investment threshold comparison:** Reads the configured investment threshold from `vault/benefits/00_current/config.md` or `vault/benefits/config.md`. Compares current cash balance to threshold. If cash > threshold: the excess should be moved to the investment sleeve to start compounding. Calculates the exact transfer amount.

**Pending reimbursements:** Reads `vault/benefits/00_current/pending-reimbursements.md` — all logged qualified medical expenses with receipts saved but not yet submitted for HSA reimbursement. Returns a sorted list (oldest first) with expense date, provider, amount, and category. The total represents HSA funds the user can claim from past out-of-pocket spending while keeping invested funds growing.

**Pro-rata limit consideration:** If the user was not enrolled in an HDHP for the full year (enrolled mid-year), the annual HSA contribution limit is pro-rated based on months of HDHP coverage. The flow checks config for enrollment start date and applies the pro-rata calculation if needed.

## Steps

1. Read coverage tier and enrollment start date from `vault/benefits/config.md`.
2. Determine applicable IRS limit: $4,300 (self-only) or $8,550 (family) for 2025; apply catch-up if age 55+.
3. Apply pro-rata reduction if HDHP enrollment started after January 1 of current year.
4. Read most recent HSA statement from `vault/benefits/00_current/` — extract cash balance, invested balance, YTD employee contributions, YTD employer contributions.
5. Calculate total YTD contributions (employee + employer).
6. Calculate remaining contribution room: applicable_limit − total_YTD_contributions (floor at 0).
7. Calculate monthly contribution rate from YTD employee contribution pace.
8. Project year-end total at current monthly rate.
9. Calculate additional monthly contribution needed to reach limit from current month forward.
10. Read investment threshold from config. Compare to current cash balance. Calculate transfer amount if cash > threshold.
11. Read all entries from `vault/benefits/00_current/pending-reimbursements.md` where paid = no. Sort by date ascending.
12. Sum total pending reimbursements.
13. Return all results as structured data to calling op.

## Input

- `~/Documents/aireadylife/vault/benefits/config.md` — coverage tier, enrollment date, investment threshold, age (for catch-up)
- `~/Documents/aireadylife/vault/benefits/00_current/` — most recent HSA statement
- `~/Documents/aireadylife/vault/benefits/00_current/pending-reimbursements.md` — pending expenses
- `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records for trend comparison

## Output Format

Structured data returned to calling op:

```
Coverage tier: self-only / family
2025 IRS limit: $X (pro-rated: $X if applicable)
YTD employee contributions: $X
YTD employer contributions: $X
Total YTD: $X (X% of limit)
Remaining room: $X
Monthly contribution rate: $X/month
Projected year-end: $X
Additional monthly needed to max: $X

Cash balance: $X
Invested balance: $X
Total balance: $X
Investment threshold: $X
Cash above threshold: $X → transfer $X to investment sleeve / Cash within threshold

Pending reimbursements: X expenses totaling $X
  Oldest: [date] [provider] $X
  [list sorted by date]
```

## Configuration

Required in `vault/benefits/config.md`:
- `hsa_coverage_tier` — self-only or family
- `hsa_enrollment_start_date` — YYYY-MM-DD (for pro-rata limit calculation)
- `hsa_investment_threshold` — dollar amount
- `user_age` or `user_birth_year` — for catch-up contribution eligibility

`vault/benefits/00_current/pending-reimbursements.md` entry format:
```yaml
date: YYYY-MM-DD
provider: "[name]"
amount: X.XX
category: doctor / prescription / dental / vision / other
receipt_saved: yes
paid: no
```

## Error Handling

- **No HSA statement:** Cannot compute balances. Return error to calling op with prompt to download statement.
- **Coverage tier unavailable:** Default to self-only limit and note assumption. Prompt user to set in config.
- **Employer HSA contribution not in statement:** Check config for employer HSA contribution schedule; if not configured, note that employer contribution tracking is unavailable and total may be underestimated.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/benefits/config.md`, `~/Documents/aireadylife/vault/benefits/00_current/`
- Writes to: None (returns data to calling op)
