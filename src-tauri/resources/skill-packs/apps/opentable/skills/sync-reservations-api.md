---
id: sync-reservations-api
runner: api
trigger: on-demand
capability: sync-reservations
auth: [OPENTABLE_API_TOKEN]
url: https://platform.otqa.com/sync/v2/reservations
method: GET
headers:
  - "Authorization: Bearer ${env.OPENTABLE_API_TOKEN}"
  - "Accept: application/json"
save: opentable-reservations-${date}.json
---
# Sync reservations (API fallback)

Headless fallback for the sync-reservations capability. Access method derives
from `runner: api`. OpenTable's reservation API is partner-gated, so most users
will not have OPENTABLE_API_TOKEN; that is why the browser method is the
favorite. Read-only GET.
