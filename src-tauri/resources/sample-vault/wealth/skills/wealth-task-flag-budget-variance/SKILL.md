---
name: aireadylife-wealth-task-flag-budget-variance
type: task
cadence: monthly
description: >
  Writes a flag to vault/wealth/open-loops.md when an expense category exceeds its
  monthly budget by more than 20%. Each entry includes: category name, actual amount
  spent, budget target, dollar overage, percent overage, severity tier (MEDIUM 20–50%,
  HIGH 51–100%, CRITICAL >100%), and a context note for likely one-time overages.
  Recurring overages (same category flagged 3+ consecutive months) auto-escalate to HIGH.
---

# aireadylife-wealth-flag-budget-variance

**Cadence:** Monthly (called by cash flow review op)
**Produces:** Budget variance entries in `vault/wealth/open-loops.md`

## What It Does

Called by `aireadylife-wealth-build-cash-flow-summary` for each expense category that exceeded its monthly budget by more than 20%. The 20% threshold is intentional: it filters out normal month-to-month variation (e.g., a grocery bill $40 over a $400 budget is not actionable) while surfacing overages that indicate a genuine pattern or a one-time large expense that warrants awareness.

Each flag entry contains:
- **Category name** — e.g., "Healthcare," "Food and Dining," "Subscriptions"
- **Actual amount spent** — total for the month in this category
- **Budget target** — the configured monthly budget for this category
- **Dollar overage** — actual minus budget
- **Percent overage** — (actual − budget) ÷ budget × 100
- **Severity tier** — MEDIUM (20–50% over), HIGH (51–100% over), CRITICAL (>100% over, i.e., doubled the budget)
- **Context note** — when the overage has a plausible seasonal or one-time cause, this is auto-populated: "Healthcare: January — likely deductible reset," "Transportation: December — holiday travel," "Entertainment: one-time event." If no context is identifiable, the note is blank and the user is prompted to annotate.
- **Recurring flag** — if the same category was flagged in 2 of the past 3 months, the severity is escalated one tier with a note: "Recurring overage — consider revising the budget target"

**Budget revision prompt.** When a category is flagged as recurring for 3+ consecutive months, the flag includes a suggested revised budget target: the average actual spend over those 3 months, rounded up to the nearest $50. The user can accept this as the new budget or keep the aspirational target — either is valid, but the flag makes the mismatch visible.

**Under-budget note.** Categories more than 20% under budget are not flagged as open-loop items but are mentioned in the cash flow summary as "Potential savings: [category] was $X under budget." Consistent under-budget performance on a category may warrant lowering the target and redirecting funds to savings.

## Apps

None

## Vault Output

- `vault/wealth/open-loops.md` — budget variance flag entries appended
