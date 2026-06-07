---
name: aireadylife-wealth-flow-build-cash-flow-summary
type: flow
trigger: called-by-op
description: >
  Summarizes all income and expenses for the month, compares each expense category
  to its configured budget target, and flags categories more than 20% over budget.
  Income is aggregated by source: W-2 net pay, rental income, side income, dividends,
  interest. Expenses are grouped into standard categories: housing, transportation,
  food, healthcare, subscriptions, entertainment, savings contributions. Calculates
  net cash flow and MoM comparison for each category.
---

# aireadylife-wealth-build-cash-flow-summary

**Trigger:** Called by `aireadylife-wealth-cash-flow-review`
**Produces:** Cash flow summary at `vault/wealth/00_current/YYYY-MM-cashflow.md`

## What It Does

Reads all income and expense transaction records from `vault/wealth/00_current/` for the current month and produces a complete income-minus-expenses picture with budget variance analysis.

**Income aggregation.** All income is categorized by source: W-2 Net Pay (take-home after taxes and benefits deductions — read from pay stub records or bank deposit records), Rental Income (gross rents received; property-level detail from the estate plugin if installed), Business/Freelance Income (1099 income or business account deposits), Dividends and Interest (from investment account records in `vault/wealth/00_current/`), Other Income (ESPP proceeds, RSU net vest proceeds, one-time items). Total gross income and total net income are both shown; the difference is taxes and benefits deducted at source.

**Expense categorization.** Expenses from transaction records are grouped into standard categories with budget targets from config: Housing (rent or mortgage payment, HOA, renter's/homeowner's insurance, utilities — electricity, gas, water, internet), Transportation (car payment, auto insurance, gas, parking, tolls, rideshare), Food and Dining (groceries separate from dining out), Healthcare (insurance premiums paid out-of-pocket, copays, prescriptions, dental, vision), Subscriptions (streaming services, software, gym, all recurring charges), Entertainment (events, hobbies, travel), Personal (clothing, personal care), Children (childcare, school, activities), Savings Contributions (401k beyond employer match, IRA contributions, brokerage auto-invest, HYSA transfers). Savings contributions are shown as an expense line but also tracked separately as savings rate: total savings contributions ÷ total net income.

**Budget variance.** Each expense category is compared to its monthly budget target in config. Variance is shown as dollar difference and percent difference. Categories more than 20% over budget are passed to `aireadylife-wealth-flag-budget-variance`. Categories more than 20% under budget are noted as "under budget — expected or actual saving?"

**Net cash flow.** Total income minus total expenses (excluding savings contributions from "expenses" to show true discretionary cash flow), and separately, total income minus all outflows including savings. If the review runs mid-month, a projected month-end figure is shown based on average daily spend rates for variable categories with the days remaining in the month.

## Triggers

- "cash flow review"
- "check my spending"
- "am I over budget"
- "monthly budget review"
- "how much did I spend"
- "income and expenses"
- "budget variance"
- "show my cash flow"

## Steps

1. Read all transaction records from `vault/wealth/00_current/YYYY-MM/` for the current month period
2. Categorize each transaction against the expense taxonomy using payee matching and category tags
3. Aggregate income by source type (W-2, rental, business, investment, other)
4. Sum expense totals per category
5. Calculate net cash flow: total income minus total expenses
6. Calculate savings rate: total savings contributions ÷ total net income
7. Compare each expense category to its budget target from config.md; calculate dollar and percent variance
8. Flag categories more than 20% over budget for `aireadylife-wealth-flag-budget-variance`
9. Compare to prior month per-category totals and calculate MoM delta
10. Write formatted cash flow summary to `vault/wealth/00_current/YYYY-MM-cashflow.md`

## Input

- `vault/wealth/00_current/YYYY-MM/` — transaction records for the current month (from Monarch Money CSV export or manual entry)
- `vault/wealth/00_current/YYYY-MM-1/` — prior month transactions for MoM comparison
- `vault/wealth/01_prior/` — prior period records for trend comparison
- `vault/wealth/config.md` — budget targets per category, income source list

## Output Format

Markdown document at `vault/wealth/00_current/YYYY-MM-cashflow.md`:
- Income table: Source | Amount | vs. Budget | Notes
- Expense table: Category | Actual | Budget | Variance ($) | Variance (%) | Status (OK / OVER / UNDER)
- Summary: Total Income | Total Expenses | Net Cash Flow | Savings Rate
- Flagged categories section with overage amount and context note
- MoM comparison: each category current vs. prior month

## Configuration

Required fields in `vault/wealth/config.md`:
- `budget_[category]` — monthly budget target for each expense category
- `income_sources` — list of expected income sources for the month
- `savings_rate_target` — target savings rate percentage (default: 20%)

## Error Handling

- If no transaction records exist for the month: prompt "No transaction records found for [YYYY-MM]. Export transactions from Monarch Money (or your bank) and place in vault/wealth/00_current/YYYY-MM/"
- If a transaction cannot be categorized by payee matching: list it as "Uncategorized" and prompt user to tag it after the summary is generated
- If budget targets are not configured: show actuals without variance comparison and note which categories need budget targets in config.md

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/wealth/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/wealth/00_current/YYYY-MM/`
- Reads from: `~/Documents/aireadylife/vault/wealth/config.md`
- Writes to: `~/Documents/aireadylife/vault/wealth/00_current/YYYY-MM-cashflow.md`
