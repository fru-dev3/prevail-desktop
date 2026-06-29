---
id: monthly-spend-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/cashapp-spend-summary-${date}.json, kind: replace }
---
# Monthly Spend Summary
Where the money actually went this month through Cash App.
1. **Load.** Read the latest `data/cashapp-transactions-*.json`.
2. **Total.** Sum outflows (Cash Card purchases, payments sent, withdrawals) for the month.
3. **Categorize.** Group spend by merchant and category; rank the top merchants and biggest single charges.
4. **Compare.** Compare against the prior month if available and flag notable jumps.
Output: a monthly spend summary with total outflow, top categories/merchants, and month-over-month changes.
