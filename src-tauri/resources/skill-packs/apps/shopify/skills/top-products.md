---
id: top-products
runner: llm
trigger: on-demand
outputs:
  - { path: data/shopify-top-products-${date}.json, kind: replace }
---
# Top Products
What's moving and what's stalling, so restock and promotion calls are grounded in data.
1. **Load.** Read the newest `data/shopify-orders-*.json` and `data/shopify-products-*.json`.
2. **Rank.** Order products and variants by units sold and by revenue over the period.
3. **Trend.** Compare recent vs. earlier sub-periods to mark rising vs. fading SKUs.
4. **Dead weight.** Flag catalog items with zero sales in the window.
Output: a ranked top-products list with units, revenue, and trend per SKU plus a zero-sellers list.
