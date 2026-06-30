---
id: sync-activities-api
runner: api
trigger: on-demand
capability: sync-activities
auth: [STRAVA_ACCESS_TOKEN]
url: https://www.strava.com/api/v3/athlete/activities?per_page=30
method: GET
headers:
  - "Authorization: Bearer ${env.STRAVA_ACCESS_TOKEN}"
  - "Accept: application/json"
save: strava-activities-${date}.json
---
# Sync activities (API fallback)

Headless fallback for the sync-activities capability. Access method derives from
`runner: api`; `method: GET` is the HTTP verb. Pulls recent activities from the
Strava API using STRAVA_ACCESS_TOKEN (scope activity:read). Read-only GET.
