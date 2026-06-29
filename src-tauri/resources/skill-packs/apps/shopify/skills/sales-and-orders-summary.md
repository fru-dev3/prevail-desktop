---
id: sales-and-orders-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/shopify-sales-summary-${date}.json, kind: replace }
---
# Sales and Orders Summary
How the store is actually selling, read straight from the latest orders snapshot.
1. **Load.** Read the newest `data/shopify-orders-*.json`.
2. **Aggregate.** Compute total revenue, order count, average order value, and refunds for the period; break out by day and by week.
3. **Compare.** Contrast this period against the prior one and flag notable swings up or down.
4. **Outstanding.** Surface the fulfillment backlog (paid-but-unfulfilled orders) and top customers by spend.
Output: a sales summary with revenue, AOV, period-over-period deltas, and an outstanding-orders list.
