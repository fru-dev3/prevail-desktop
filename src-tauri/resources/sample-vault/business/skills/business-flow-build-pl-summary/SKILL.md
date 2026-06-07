---
name: aireadylife-business-flow-build-pl-summary
type: flow
trigger: called-by-op
description: >
  Builds a monthly P&L summary: revenue by client/source, expense categories, net profit, margin,
  and comparison to prior month.
---

## What It Does

Reads all revenue records for the current month from `~/Documents/aireadylife/vault/business/00_current/` and groups them by client name and revenue stream type (consulting, product sales, licensing, retainer, other). Calculates gross revenue as the sum of all recognized revenue items for the period. Reads all expense records from `~/Documents/aireadylife/vault/business/00_current/` and groups them by category: software subscriptions, equipment and hardware, contractor labor, professional services (legal, accounting), marketing and advertising, travel (100% deductible), meals and entertainment (50% deductible limit applied automatically), home office, and other. Sums all expense categories to produce total operating expenses.

Computes net income as gross revenue minus total expenses, and profit margin as net income divided by gross revenue expressed as a percentage. Loads the prior month's P&L figures from the most recently dated brief or raw records file in the vault to generate MoM (month-over-month) comparison figures: dollar change and percentage change for revenue, expenses, and net income. A revenue variance of +/-10% vs prior month is noted; +/-20% is flagged as significant.

Formats the result as a structured two-section table: first the revenue breakdown (one row per client/stream, with this-month and prior-month columns and a delta column), then the expense breakdown (one row per category), followed by a summary section showing gross revenue, total expenses, net income, profit margin, and MoM deltas for each. Returns the formatted P&L table to the calling op.

## Triggers

Called internally by `aireadylife-business-op-pl-review` and `aireadylife-business-op-monthly-synthesis`. Not invoked directly by the user.

## Steps

1. Read all revenue records from `~/Documents/aireadylife/vault/business/00_current/` for the current month; identify date, client, amount, stream type, and payment status for each
2. Filter to recognized revenue only (status: paid); exclude pending invoices from gross revenue total
3. Group revenue by client and stream type; sum to produce gross revenue
4. Read all expense records from `~/Documents/aireadylife/vault/business/00_current/` for the current month; identify date, vendor, amount, and category for each
5. Apply the 50% meals and entertainment cap: multiply all M&E line items by 0.5 for the deductible figure used in net income calculation
6. Group expenses by category; sum each category; sum all categories to produce total expenses
7. Calculate net income = gross revenue - total expenses; calculate profit margin = net income / gross revenue
8. Locate prior month P&L data from `~/Documents/aireadylife/vault/business/00_current/` — look for a file named `pl-{YYYY-MM}.md` or `brief-{YYYY-MM}.md` from the previous month
9. Extract prior month gross revenue, total expenses, and net income figures for MoM comparison
10. Calculate MoM dollar delta and percentage change for revenue, expenses, and net income
11. Flag any revenue variance above 20% or expense category over budget threshold
12. Format as two-section table (revenue then expenses) with summary row and delta column throughout
13. Return formatted P&L table to the calling op

## Input

- `~/Documents/aireadylife/vault/business/00_current/` — invoice and revenue records for current month; each file should include: date, client, amount, stream type, payment status
- `~/Documents/aireadylife/vault/business/00_current/` — expense records for current month; each file should include: date, vendor, amount, category
- `~/Documents/aireadylife/vault/business/00_current/pl-{YYYY-MM}.md` — prior month P&L for MoM comparison (optional; if missing, MoM columns show "N/A")
- `~/Documents/aireadylife/vault/business/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/business/config.md` — monthly budget targets per expense category (optional; used for variance flags)

## Output Format

```
## P&L — {Month} {Year}

### Revenue
| Client / Stream       | This Month | Prior Month | Delta |
|-----------------------|------------|-------------|-------|
| [Client A]            | $X,XXX     | $X,XXX      | +X%   |
| [Revenue stream B]    | $X,XXX     | $X,XXX      | -X%   |
| **Gross Revenue**     | **$X,XXX** | **$X,XXX**  | **±X%** |

### Expenses
| Category              | This Month | Prior Month | Delta |
|-----------------------|------------|-------------|-------|
| Software              | $XXX       | $XXX        | +X%   |
| Contractor labor      | $XXX       | $XXX        | —     |
| Meals (50% adj.)      | $XXX       | $XXX        | —     |
| **Total Expenses**    | **$X,XXX** | **$X,XXX**  | **±X%** |

### Summary
| Metric          | This Month | Prior Month | Delta |
|-----------------|------------|-------------|-------|
| Gross Revenue   | $X,XXX     | $X,XXX      | ±X%   |
| Total Expenses  | $X,XXX     | $X,XXX      | ±X%   |
| Net Income      | $X,XXX     | $X,XXX      | ±X%   |
| Profit Margin   | XX%        | XX%         | ±Xpp  |
```

## Configuration

Required fields in `~/Documents/aireadylife/vault/business/config.md`:
- `entities` — list of business entities (name, state, type: LLC/S-corp/sole prop)
- `fiscal_year_start` — month when your fiscal year starts (default: January)
- `budget_{category}` — monthly budget target per expense category (optional; enables variance flagging)
- `accounting_method` — cash or accrual (default: cash)

## Error Handling

- If `01_revenue/` is empty for the current month: return a P&L with $0 gross revenue and note "No revenue records found for {month}. Add records to vault/business/00_current/ to populate this report."
- If `02_expenses/` is empty: return P&L with $0 expenses and note "No expense records found."
- If prior month P&L file is missing: populate prior month columns with "N/A" and note "No prior month data — MoM comparison unavailable."
- If a revenue or expense record is missing required fields (amount, date, category): flag the specific file as "incomplete record — review required" and exclude it from totals.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/business/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/config.md`
- Writes to: called by ops that write to `~/Documents/aireadylife/vault/business/02_briefs/`
