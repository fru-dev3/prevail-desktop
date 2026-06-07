---
name: oura-ring
type: app
description: >
  Fetches daily sleep, readiness, and activity data from the Oura Ring API v2 using
  a personal API key. Returns sleep score, total sleep duration, deep/REM/light sleep
  stages, HRV RMSSD (nightly), resting heart rate, readiness score (0-100), steps,
  and active calories. Used by the health agent for wearable data sync, 90-day
  baseline trend analysis, and anomaly detection. Configure API key in vault/health/config.md.
---

# Oura Ring

**Auth:** API key (`oura_api_key` in config.md)
**Base URL:** https://api.ouraring.com/v2/usercollection/
**Documentation:** https://cloud.ouraring.com/v2/docs

## Data Available

| Metric | Endpoint | Notes |
|--------|----------|-------|
| Sleep score | /sleep | 0–100; composite of efficiency, duration, timing |
| Total sleep | /sleep | Minutes; convert to hours for display |
| Deep sleep | /sleep | Minutes per night |
| REM sleep | /sleep | Minutes per night |
| Sleep efficiency | /sleep | Percentage of time in bed spent asleep |
| Sleep latency | /sleep | Minutes to fall asleep |
| HRV RMSSD | /sleep | Nightly average in milliseconds |
| Readiness score | /daily_readiness | 0–100; composite recovery metric |
| Resting heart rate | /daily_readiness | Lowest HR during sleep |
| Daily steps | /daily_activity | Total steps for the day |
| Active energy | /daily_activity | Kilocalories burned above BMR |
| Equivalent walking distance | /daily_activity | km |

## Configuration

Add to `vault/health/config.md`:
```
oura_api_key: YOUR_OURA_API_KEY
oura_lookback_days: 90
```

To obtain your API key: Oura app → Profile → Personal Access Tokens → Create Token

## Key API Calls

```
# Sleep data
GET https://api.ouraring.com/v2/usercollection/sleep?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
Authorization: Bearer {oura_api_key}

# Readiness data (includes resting HR)
GET https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=YYYY-MM-DD
Authorization: Bearer {oura_api_key}

# Activity data (steps, active energy)
GET https://api.ouraring.com/v2/usercollection/daily_activity?start_date=YYYY-MM-DD
Authorization: Bearer {oura_api_key}
```

## Rate Limits

Oura API v2: 5,000 requests/day per token. The health agent's monthly sync requests approximately 3 API calls per sync (one per endpoint). Well within limits.

## Used By

- `aireadylife-health-sync-wearable-data` — pull nightly sleep, readiness, and activity data
- `aireadylife-health-anomaly-watch` — flag HRV drops, low readiness streaks, and resting HR elevation
- `aireadylife-health-build-wellness-summary` — provide data for 30-day and 90-day trend calculations

## Vault Output

- `vault/health/00_current/wearable-log.csv` — daily records appended from API response
