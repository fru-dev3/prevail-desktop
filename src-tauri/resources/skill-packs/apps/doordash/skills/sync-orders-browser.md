---
id: sync-orders-browser
runner: browser-agent
trigger: refresh
favorite: true
method: browser
capability: sync-orders
session: profile
start_url: https://www.doordash.com/orders/
domain_allow: [www.doordash.com, doordash.com]
success_url_contains: doordash.com
goal: Open DoorDash order history in the logged-in session and read recent orders (restaurant, date, items, subtotal, total, tip). Read-only: never reorder, rate, tip, or change anything.
outputs:
  - { path: data/doordash-orders-${date}.json, kind: replace }
---
# Sync orders (browser, favorite)

DoorDash has no public consumer API, so browser automation over the logged-in
session is the favorite and primary method. The api variant is best-effort and
only works if the user has captured a session token; otherwise the pack stays on
browser.

Read-only. Capture restaurant, date, items, subtotal, total, and tip, then write
a normalized JSON document. Never reorder, rate, tip, or change anything.
