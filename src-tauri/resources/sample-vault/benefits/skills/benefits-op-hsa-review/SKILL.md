---
name: aireadylife-benefits-op-hsa-review
type: op
cadence: monthly
description: >
  Monthly HSA review tracking YTD contributions vs. the 2025 IRS limit ($4,300 individual / $8,550 family), investment threshold status, projected year-end balance, and pending qualified expense reimbursements. Flags under-contribution pace and uninvested cash above threshold. Triggers: "HSA review", "HSA balance", "HSA contributions", "health savings account", "HSA investment", "pending reimbursements".
---

## What It Does

Runs monthly to maximize the value of your HSA — the only triple-tax-advantaged account available to working Americans. HSA funds are pre-tax going in, grow tax-free, and come out tax-free for qualified medical expenses. A dollar contributed to an HSA at age 35 and invested for 30 years is worth roughly 3x more than a dollar in a taxable account at equivalent pre-tax income, because the entire investment period is tax-sheltered and the withdrawal is tax-free. This op ensures every available HSA contribution dollar is being deployed and that cash is not sitting idle above the investment threshold.

**Contribution pace tracking:** The 2025 IRS limits are $4,300 for self-only HDHP coverage and $8,550 for family coverage (these limits increase annually with inflation; catch-up contribution of $1,000 for age 55+). Reads YTD employee contributions from `vault/benefits/00_current/` and computes the monthly contribution rate. Projects whether the annual limit will be reached by December 31 at the current pace. If the pace will fall short, calculates the additional monthly contribution needed. Note: the IRS limit applies to all HSA contributions combined — employee payroll contributions + employer contributions. If the employer contributes to the HSA, that counts toward the annual limit.

**Investment threshold check:** Most HSA carriers hold contributions in a cash account by default, requiring the account holder to manually move funds to the investment sleeve. The investment threshold — the balance below which cash is kept liquid for expected near-term medical expenses — is carrier-specific and configurable. Common threshold: $1,000-$2,000 in cash, remainder invested. If the current cash balance exceeds the configured threshold and uninvested funds exist, the op flags this and calculates the exact dollar amount to move. Cash sitting above the threshold in a money market earns 4-5% at most; invested in a diversified equity fund it compounds tax-free at whatever the market returns.

**Pending reimbursements:** A powerful HSA strategy is to pay medical expenses out-of-pocket (from regular cash) and let HSA funds compound invested, then reimburse yourself years later — there is no deadline for HSA self-reimbursement as long as the expense was incurred after the account was established and the receipt is saved. The op reads `vault/benefits/00_current/pending-reimbursements.md` for logged qualified expenses that have receipts saved but haven't been submitted for reimbursement. Reports the total pending amount and sorts by date.

**Qualified expense verification:** Confirms that all logged reimbursements are for IRS-qualified medical expenses. Common qualified expenses: doctor visits, prescriptions, dental care, vision care, medical equipment. Common non-qualified: insurance premiums (exception: Medicare premiums at 65+), cosmetic procedures, general health items without a medical diagnosis.

## Triggers

- "HSA review"
- "HSA balance"
- "HSA contributions"
- "health savings account status"
- "HSA investment threshold"
- "pending medical reimbursements"
- "should I move HSA money to investments"

## Steps

1. Read `vault/benefits/config.md` — confirm HSA coverage tier (self-only or family), employer HSA contribution amount and schedule, and configured investment threshold.
2. Read most recent HSA statement from `vault/benefits/00_current/` — extract cash balance, invested balance, YTD employee contributions, YTD employer contributions.
3. Calculate total YTD contributions (employee + employer) and compare to IRS annual limit for coverage tier.
4. Calculate projected year-end contribution at current monthly pace — flag if shortfall vs. limit.
5. Calculate additional monthly contribution needed to reach limit by December 31.
6. Calculate months remaining and maximum allowed catch-up contribution to reach limit.
7. Read investment threshold from `vault/benefits/00_current/config.md` or `vault/benefits/config.md`.
8. Compare current cash balance to investment threshold — if cash > threshold, calculate amount to transfer to investment sleeve.
9. Read `vault/benefits/00_current/pending-reimbursements.md` — list all unpaid qualified expenses with receipt confirmed, sorted by date.
10. Sum pending reimbursements by category and in total.
11. Write HSA review to `vault/benefits/00_current/hsa-review-YYYY-MM.md`.
12. Call `aireadylife-benefits-task-update-open-loops` with: contribution shortfall flag (if any), investment threshold action (if needed), pending reimbursement count and total.

## Input

- `~/Documents/aireadylife/vault/benefits/config.md` — coverage tier, employer contribution, investment threshold
- `~/Documents/aireadylife/vault/benefits/00_current/` — statements, pending-reimbursements.md
- `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records for trend comparison

## Output Format

**HSA Review** — saved as `vault/benefits/00_current/hsa-review-YYYY-MM.md`

```
## HSA Review — [Month Year]

### Contribution Pace
Coverage tier: Self-only / Family
2025 IRS limit: $4,300 / $8,550
YTD employee contributions: $X
YTD employer contributions: $X
YTD total: $X (X% of limit)
Monthly pace: $X/month
Projected year-end: $X
Status: On track / Behind — [need $X more/month to reach limit]

### Investment Threshold
Cash balance: $X
Investment threshold: $X
Invested balance: $X
Action: Transfer $X to investment sleeve / Cash is within threshold

### Pending Reimbursements
Total pending: $X across X expenses
[Date] — [Provider] — $X — [expense type]
[Date] — [Provider] — $X — [expense type]
Oldest unpaid: [date]

### Summary
IRS limit on track: Yes / No
Investment action needed: Yes / No
Reimbursements pending: $X
```

## Configuration

Required in `vault/benefits/config.md`:
- `hsa_coverage_tier` — self-only or family
- `employer_hsa_contribution_annual` — employer's annual HSA contribution (counts toward limit)
- `hsa_investment_threshold` — dollar amount to keep in cash

Pending reimbursement log at `vault/benefits/00_current/pending-reimbursements.md`:
```
date: YYYY-MM-DD
provider: "[name]"
amount: X.XX
category: doctor / prescription / dental / vision / other
receipt_saved: yes
notes: "[optional]"
```

## Error Handling

- **No HSA statement in vault:** Cannot review without current balance. Prompt user to download statement from HSA carrier portal and save to `vault/benefits/00_current/`.
- **HSA not enrolled:** If user is on a non-HDHP plan, note that HSA is not available and skip this review.
- **Investment threshold not configured:** Use $1,500 as a reasonable default and note the assumption.
- **Pending reimbursements log empty:** Note that no reimbursements are logged; if user has paid medical expenses out-of-pocket in the current or prior years, recommend logging them for future reimbursement.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/benefits/config.md`, `~/Documents/aireadylife/vault/benefits/00_current/`
- Writes to: `~/Documents/aireadylife/vault/benefits/00_current/hsa-review-YYYY-MM.md`, `~/Documents/aireadylife/vault/benefits/open-loops.md`
