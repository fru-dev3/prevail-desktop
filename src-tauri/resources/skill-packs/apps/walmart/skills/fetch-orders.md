---
id: fetch-orders
runner: browser-agent
trigger: refresh
goal: "Sign in to Walmart and download my purchase history and returns; do not buy, cancel, or change anything."
domain_allow:
  - walmart.com
  - www.walmart.com
outputs:
  - { path: data/walmart-orders-${date}.json, kind: replace }
  - { path: data/walmart-returns-${date}.json, kind: replace }
---
# Pull Walmart Orders & Returns
Pull in what you bought so spending and what you own stay clear.
1. **Open purchase history.** Navigate to Account > Purchase History and select the widest available date range across store and online orders.
2. **Capture each order.** Record date, order number, item names, quantity, item price, fulfillment type (pickup/delivery/shipping), totals, and status.
3. **Capture returns & refunds.** Open the returns view and record returned items, refund amounts, status, and reasons.
4. **Normalize.** Write orders to walmart-orders-${date}.json and returns to walmart-returns-${date}.json; never click Buy, Reorder, or Cancel.
Output: a read-only snapshot of Walmart orders and returns as two JSON files.
