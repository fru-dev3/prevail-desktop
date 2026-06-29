---
id: fetch-orders
runner: browser-agent
trigger: refresh
goal: "Sign in to Amazon and download my order history and returns; do not buy, cancel, or change anything."
domain_allow:
  - amazon.com
  - www.amazon.com
outputs:
  - { path: data/amazon-orders-${date}.json, kind: replace }
  - { path: data/amazon-returns-${date}.json, kind: replace }
---
# Pull Amazon Orders & Returns
Almost everything you buy shows up here, so pull it in cleanly and read-only.
1. **Open order history.** Navigate to Your Orders and select the widest time range available (this year, last year, and any archived orders).
2. **Capture each order.** For every order record date, order number, item titles, quantity, item price, shipping, tax, order total, and current status (delivered, shipped, returned).
3. **Capture returns & refunds.** Open Your Orders > Returns and record returned items, refund amounts, refund status, and return reasons.
4. **Normalize.** Write orders to amazon-orders-${date}.json and returns to amazon-returns-${date}.json; never click Buy, Cancel, or Reorder.
Output: a complete read-only snapshot of Amazon orders and returns as two JSON files.
