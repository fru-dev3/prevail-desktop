---
id: order-history-spend-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/amazon-spend-summary-${date}.json, kind: replace }
---
# Amazon Spend Summary
Your spending and what you actually own should never be a mystery.
1. **Load orders.** Read the latest data/amazon-orders-*.json synced snapshot.
2. **Bucket spend.** Total spend by month and by category (electronics, household, groceries, etc.), counting items and average order value.
3. **Surface outliers.** Flag the largest single orders and any months that ran well above your typical spend.
4. **Tie to wealth.** Frame totals against monthly budgets so the numbers feed the wealth domain.
Output: a spend summary JSON with monthly totals, category breakdown, and top outlier orders.
