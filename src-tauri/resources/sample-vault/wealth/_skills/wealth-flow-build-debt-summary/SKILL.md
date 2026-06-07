---
name: aireadylife-wealth-flow-build-debt-summary
type: flow
trigger: called-by-op
description: >
  Builds a debt table with outstanding balance, interest rate, minimum monthly payment,
  projected payoff date at current pace, and total remaining interest cost for each
  loan. Ranks debts by interest rate (avalanche method). Models two extra-payment
  scenarios — $100/month and $500/month added to the highest-rate debt — and computes
  interest savings and payoff acceleration. Flags when a debt hits a meaningful payoff
  milestone.
---

# aireadylife-wealth-build-debt-summary

**Trigger:** Called by `aireadylife-wealth-debt-review`
**Produces:** Debt summary table at `vault/wealth/00_current/YYYY-MM-debt-summary.md`

## What It Does

Reads all outstanding loan records from `vault/wealth/00_current/` — each stored as a structured file with the debt name, type, original balance, current balance, interest rate (APR), minimum monthly payment, origination date, and lender — and produces a complete debt picture with payoff analysis.

**Per-debt payoff calculation.** For each loan, the flow calculates the remaining payoff timeline at the current minimum payment pace using the standard amortization formula. It also computes total remaining interest: the sum of all future interest payments from today through payoff at current pace. This figure — not the remaining balance — is the true cost of the debt, and it's typically the number that motivates action.

**Debt ranking.** All debts are ranked by interest rate descending (avalanche method) — the optimal order for minimizing total interest paid. Mortgage debt is shown separately with a note that it is typically lowest-rate and also provides a tax deduction if the user itemizes. Credit card debt is flagged at any rate above 15% APR as high-priority paydown. Student loan debt at sub-5% rates is noted as low priority relative to investing.

**Extra-payment modeling.** Two scenarios are modeled by applying extra payments to the highest-rate non-mortgage debt (avalanche method):
- Scenario A: $100/month extra — shows payoff date acceleration and total interest saved
- Scenario B: $500/month extra — shows payoff date acceleration and total interest saved
For both scenarios, the "freed cash flow" is shown: when the highest-rate debt is paid off under the extra-payment scenario, the calculation rolls that payment amount plus the extra payment into the next-highest-rate debt (snowball rollover within the avalanche strategy).

**Debt-to-income ratio.** Total monthly minimum debt payments ÷ gross monthly income (from config.md). Normal: below 36%. Warning: 36–43%. High: above 43%.

**Milestone detection.** When a debt's outstanding balance crosses a configured milestone (e.g., mortgage below $300k, student loan below $10k, auto loan paid off), `aireadylife-wealth-flag-savings-milestone` is called.

## Triggers

- "debt review"
- "payoff timeline"
- "how much interest am I paying"
- "debt summary"
- "model extra payments"
- "when will I pay off my student loan"
- "mortgage payoff date"
- "debt-to-income ratio"

## Steps

1. Read all debt files from `vault/wealth/00_current/` — parse: name, type, current balance, rate, minimum payment
2. For each debt, calculate remaining payoff months and date at current minimum payment pace
3. Calculate total remaining interest: sum of all future interest payments at current pace
4. Rank debts by interest rate descending (avalanche order); flag credit card debt >15% APR
5. Calculate debt-to-income ratio using total monthly minimums and gross income from config
6. Model Scenario A ($100/month extra to highest-rate debt): recalculate payoff date and interest saved
7. Model Scenario B ($500/month extra to highest-rate debt): recalculate payoff date and interest saved
8. For both scenarios, calculate rollover effect for second-highest-rate debt after first is paid off
9. Check each debt balance against configured milestones; call `aireadylife-wealth-flag-savings-milestone` for any crossed
10. Write formatted debt summary to `vault/wealth/00_current/YYYY-MM-debt-summary.md`

## Input

- `vault/wealth/00_current/` — all debt record files
- `vault/wealth/01_prior/` — prior period records for trend comparison
- `vault/wealth/config.md` — gross monthly income (for DTI), debt milestone thresholds

## Output Format

Markdown document at `vault/wealth/00_current/YYYY-MM-debt-summary.md`:
- DTI ratio summary: Monthly debt payments | Gross income | DTI % | Status
- Debt table (sorted by rate): Debt | Type | Balance | Rate | Min Payment | Payoff Date | Total Remaining Interest | Priority
- Extra-payment models: table showing both scenarios with interest saved and payoff acceleration
- Milestone section: any debts that crossed a balance milestone this quarter

## Configuration

Required in `vault/wealth/config.md`:
- Debt list with type classification for each
- `gross_monthly_income` — for DTI calculation
- `debt_milestones` — optional list of balance thresholds to flag (e.g., mortgage_milestone: 300000)

## Error Handling

- If a debt record is missing the interest rate: calculate payoff timeline without interest modeling and note "Rate unknown — update in vault/wealth/00_current/[filename]"
- If no debt records exist: report "No debt records found. If you have outstanding loans, add them to vault/wealth/00_current/ using the vault template."
- If minimum payment is less than the monthly interest accrual: flag as "Interest-only or negative amortization — this debt is not being paid down at the minimum payment"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/wealth/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/wealth/00_current/` (all debt files)
- Reads from: `~/Documents/aireadylife/vault/wealth/config.md`
- Writes to: `~/Documents/aireadylife/vault/wealth/00_current/YYYY-MM-debt-summary.md`
