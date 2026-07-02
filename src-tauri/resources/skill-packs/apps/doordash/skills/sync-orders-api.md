---
id: sync-orders-api
runner: api
trigger: on-demand
capability: sync-orders
auth: [DOORDASH_SESSION_TOKEN]
url: https://www.doordash.com/graphql/getConsumerOrdersWithDetails
method: POST
headers:
  - "Authorization: Bearer ${env.DOORDASH_SESSION_TOKEN}"
  - "Content-Type: application/json"
body: '{"limit": 25, "offset": 0}'
save: doordash-orders-${date}.json
---
# Sync orders (API fallback, best-effort)

Headless best-effort fallback for the sync-orders capability. Access method
derives from `runner: api`; `method: POST` is the HTTP verb. DoorDash exposes no
official consumer API, so this targets the internal GraphQL endpoint with a
session token in DOORDASH_SESSION_TOKEN. It may break when DoorDash changes the
endpoint, which is exactly why the browser method is the favorite. Read-only.
