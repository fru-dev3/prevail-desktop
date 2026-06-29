---
id: order-history-spend-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/walmart-spend-summary-${date}.json, kind: replace }
---
# Walmart Spend Summary
Make your Walmart spending legible so it feeds the wealth picture.
1. **Load orders.** Read the latest data/walmart-orders-*.json snapshot.
2. **Bucket spend.** Total by month and by category (groceries, household, apparel, etc.), with item counts and average order value.
3. **Compare channels.** Split spend across in-store, pickup, and delivery to see where the money goes.
4. **Surface outliers.** Flag the largest orders and any unusually heavy spending months.
Output: a spend summary JSON with monthly totals, category and channel breakdowns, and top outliers.
