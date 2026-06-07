---
name: aireadylife-business-op-pl-review
type: op
cadence: monthly
description: >
  Monthly P&L review that compares revenue vs expenses, calculates net profit margin, and flags
  variances vs prior month and budget. Triggers: "P&L review", "profit and loss", "business
  financials", "how is my business doing".
---

## What It Does

Runs on the first of each month to produce a complete P&L statement for the prior month. Reads all revenue records from `~/Documents/aireadylife/vault/business/00_current/` and all expense records from `~/Documents/aireadylife/vault/business/00_current/` for the review period. Computes gross revenue (paid invoices only, not pending), total expenses by category, net income, and profit margin percentage. Applies the 50% meals and entertainment cap automatically when calculating deductible expense totals.

Compares each figure to the prior month to surface MoM variances — dollar and percentage change for gross revenue, each expense category, net income, and margin. If a monthly budget is configured in `config.md`, flags any expense category running more than 10% over budget as a 🟡 watch item; more than 25% over budget as 🔴 urgent. Flags any revenue stream down more than 20% MoM for investigation.

Calls `aireadylife-business-task-flag-overdue-invoice` to scan the invoice file for any unpaid invoices where the due date has passed 30 days or more. Calls `aireadylife-business-flow-build-pl-summary` to produce the formatted P&L table. Writes the complete dated brief to `vault/business/02_briefs/pl-{YYYY-MM}.md` and pushes all action items to `vault/business/open-loops.md`.

## Triggers

- "P&L review"
- "profit and loss"
- "show me the business financials"
- "how is my business doing this month"
- "revenue and expenses"
- "net income this month"
- "did I make money last month"

## Steps

1. Confirm vault/business/ exists and config.md has required fields (entity name, accounting method); if missing, prompt for setup
2. Determine the review period: prior full calendar month (1st through last day)
3. Read all revenue records from vault/business/00_current/ for the review period; filter to paid status
4. Read all expense records from vault/business/00_current/ for the review period
5. Call `aireadylife-business-flow-build-pl-summary` to calculate and format the P&L table with MoM comparison
6. If budget configured in config.md: compare each expense category to budget; flag overages >10% as 🟡, >25% as 🔴
7. Flag any revenue stream down >20% MoM for investigation
8. Call `aireadylife-business-task-flag-overdue-invoice` to scan for unpaid invoices >30 days past due
9. Calculate estimated SE tax liability on net income for the period at 15.3% rate; surface as "estimated tax set-aside needed" line
10. Compile all flags and action items
11. Write complete P&L brief to vault/business/02_briefs/pl-{YYYY-MM}.md
12. Call `aireadylife-business-task-update-open-loops` with all flags
13. Present the brief to the user with a prioritized action list

## Input

- `~/Documents/aireadylife/vault/business/00_current/` — monthly revenue records
- `~/Documents/aireadylife/vault/business/00_current/` — monthly expense records
- `~/Documents/aireadylife/vault/business/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/business/config.md` — entity settings, budget targets, accounting method
- `~/Documents/aireadylife/vault/business/02_briefs/pl-{prior month}.md` — prior month brief for MoM comparison (optional)

## Output Format

```
# Business P&L Brief — {Month} {Year}

**Status:** [Profitable / Break-even / Net loss]
**Net Income:** $X,XXX | Margin: XX% | MoM: ±X%

## P&L Table
[Formatted table from build-pl-summary flow]

## Flags
🔴 [Overdue invoice / budget overrun / compliance item]
🟡 [Watch item]
🟢 [Info]

## Estimated Tax Set-Aside
Net income × 15.3% SE tax + estimated income tax rate = $X,XXX suggested set-aside for Q{X} estimated payment due {date}

## Action Items
1. [Highest priority action with specific deadline]
2. [Next action]
```

## Configuration

Required in `~/Documents/aireadylife/vault/business/config.md`:
- `entity_name` — business name
- `accounting_method` — cash or accrual
- `fiscal_year_start` — month (e.g., January)
- `budget_*` fields per expense category (optional)

## Error Handling

- If vault/business/ does not exist: "Vault not found. Purchase at frudev.gumroad.com/l/aireadylife-business and set up at ~/Documents/aireadylife/vault/business/."
- If revenue and expense folders are empty: produce a $0/$0 P&L and note "No records found for {month}. Add data to run a real review."
- If config.md is missing required fields: list which fields are missing and what each needs to contain.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/business/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/config.md`
- Writes to: `~/Documents/aireadylife/vault/business/02_briefs/pl-{YYYY-MM}.md`, `~/Documents/aireadylife/vault/business/open-loops.md`
