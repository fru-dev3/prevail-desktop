---
id: sync-reservations-browser
runner: browser-agent
trigger: refresh
favorite: true
method: browser
capability: sync-reservations
session: profile
start_url: https://www.opentable.com/my/reservations
domain_allow: [www.opentable.com, opentable.com]
success_url_contains: opentable.com
goal: Open OpenTable reservations in the logged-in session and read upcoming and past reservations (restaurant, date, time, party size, status). Read-only: never book, modify, or cancel a reservation.
outputs:
  - { path: data/opentable-reservations-${date}.json, kind: replace }
---
# Sync reservations (browser, favorite)

Read upcoming and past reservations from OpenTable using the logged-in browser
session. Favorite, zero-setup. Falls through to the API method when the browser
is blocked and a partner token is configured.

Read-only. Capture restaurant, date, time, party size, and status, then write a
normalized JSON document. Never book, modify, or cancel.
