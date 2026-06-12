---
id: monthly-money-review
runner: llm
trigger: on-demand
description: A 20-minute monthly close: cash flow, net worth delta, and the single biggest leak or win.
source: seed
---

# Monthly money review

Run on the first weekend of each month.

1. **Net worth delta.** From data/net-worth-history.json: this month vs last,
   and whether the change came from saving, markets, or spending.
2. **Cash flow.** From data/transactions.csv: income vs outflow, and the three
   largest discretionary line items.
3. **Leak or win.** Name the single biggest leak (recurring cost not earning
   its keep) or win (something that compounded). One only.
4. **Allocation drift.** From data/holdings.csv: is any position now overweight
   versus the plan? Flag anything more than 5 points off target.

Output: the delta, the three line items, the leak/win, and one action.
