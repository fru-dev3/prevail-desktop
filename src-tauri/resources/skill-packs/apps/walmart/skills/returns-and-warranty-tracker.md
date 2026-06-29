---
id: returns-and-warranty-tracker
runner: llm
trigger: on-demand
outputs:
  - { path: data/walmart-returns-warranty-${date}.json, kind: replace }
---
# Walmart Returns & Warranty Tracker
Track refunds owed and coverage windows so nothing slips.
1. **Load data.** Read the latest walmart-returns-*.json and walmart-orders-*.json snapshots.
2. **Track returns.** List open returns, pending refunds, and any refund delayed past its expected window.
3. **Map warranties.** For higher-value items, estimate return/warranty windows from purchase date and flag those closing soon.
4. **Prioritize.** Rank items needing attention (collect a refund, register coverage) without taking action.
Output: a returns-and-warranty JSON with open returns, pending refunds, and closing windows.
