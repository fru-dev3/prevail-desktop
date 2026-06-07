---
name: aireadylife-wealth-op-cash-flow-review
type: op
cadence: monthly
description: >
  Monthly income vs. expense review. Aggregates all income sources (W-2 net, rental,
  business, dividends) and expense categories (housing, food, transportation, healthcare,
  subscriptions, entertainment, savings contributions), compares each category to its
  configured budget target, and flags variances greater than 20%. Calculates savings
  rate and net cash flow. Triggers: "cash flow review", "check my spending", "am I
  over budget", "monthly budget review", "how much did I spend this month".
---

# aireadylife-wealth-cash-flow-review

**Cadence:** Monthly (1st of month)
**Produces:** Cash flow summary at `vault/wealth/00_current/YYYY-MM-cashflow.md`; budget variance flags in `vault/wealth/open-loops.md`

## What It Does

Aggregates income and expense data for the prior month and compares spending in each category against its configured budget target. The op calls `aireadylife-wealth-build-cash-flow-summary` to produce the full income-minus-expenses analysis, then routes findings to the appropriate task handlers.

For each expense category that exceeds its budget by more than 20%, `aireadylife-wealth-flag-budget-variance` is called to write a structured flag. The flag includes the category name, actual spend, budget target, dollar overage, percentage overage, and a context note when the overage has a plausible one-time explanation (e.g., "Healthcare: January deductible reset"). The 20% threshold filters out normal month-to-month variation while catching genuine budget overruns. Recurring overages — when the same category is flagged 3+ consecutive months — are automatically escalated to HIGH severity as a signal that the budget target needs revision, not just willpower.

The op calculates two savings metrics: gross savings rate (total savings contributions ÷ gross income) and net savings rate (net cash flow ÷ net income). Both are compared to the configured savings rate target (default 20% gross). A savings rate below 10% for any month is flagged as a concern; below 0% (spending more than earning) is flagged as critical.

The review also checks whether the prior month's cash flow is consistent with the net worth change computed in the net worth review. If net worth increased by $X but cash flow shows $Y net positive, a large discrepancy may indicate unreported income, investment gains not yet captured, or a missing account in the vault.

## Calls

- **Flows:** `aireadylife-wealth-build-cash-flow-summary`
- **Tasks:** `aireadylife-wealth-flag-budget-variance`, `aireadylife-wealth-update-open-loops`

## Apps

None (reads from vault; Monarch Money CSV export or bank transaction files must be in vault before this op runs)

## Vault Output

- `vault/wealth/00_current/YYYY-MM-cashflow.md` — full cash flow summary
- `vault/wealth/open-loops.md` — budget variance flags and savings rate alerts

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/wealth/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/wealth/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/wealth/02_briefs/` — prior briefs for period-over-period context
