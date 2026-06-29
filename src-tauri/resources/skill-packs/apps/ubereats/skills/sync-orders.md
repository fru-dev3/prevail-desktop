---
id: sync-orders
runner: browser-agent
trigger: refresh
goal: "Open Uber Eats in my logged-in browser, go to order history, and read my past food orders. For each order capture the date, restaurant, items, item count, subtotal, fees, tip, total, and currency. Read-only: do not reorder, add to cart, place an order, rate, or message anyone. Scroll back through history to capture the last several months, then stop."
domain_allow: [ubereats.com]
outputs:
  - { path: data/ubereats-orders-${date}.json, kind: replace }
---
# Sync orders from Uber Eats

Pull the takeout you actually order so the spending, the cravings, and the rhythm of busy nights are part of the picture.

1. **Open order history.** In the logged-in browser, navigate to Uber Eats order history.
2. **Read each order.** Capture date and time, restaurant, items, item count, subtotal, fees, tip, total, and currency.
3. **Scroll back.** Page through history to cover the last several months, staying read-only the whole time.
4. **Write the file.** Save the orders as one normalized JSON document, never reorder, add to cart, or place an order.

Output: data/ubereats-orders-${date}.json with your recent order history, items, and totals.
