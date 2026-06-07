---
name: apple-health
type: app
description: >
  Exports iPhone Health data — steps, active energy, resting heart rate, body weight,
  and workouts — via an iOS Shortcut that saves a CSV or XML export to iCloud Drive
  for automatic Mac sync. No API key required; uses device-local export. The health
  agent reads the synced file from the configured iCloud Drive path. Can be used
  standalone or alongside Oura Ring. Configure the iCloud export path in vault/health/config.md.
---

# Apple Health

**Auth:** None (iOS device-local export; no API key)
**Export method:** iPhone → Shortcuts app → "Export Health Data" shortcut → iCloud Drive
**Sync to Mac:** iCloud Drive auto-syncs within minutes on same Apple ID

## Data Available

| Metric | Source | Notes |
|--------|--------|-------|
| Steps | HealthKit | Daily total aggregated across all sources |
| Active energy | HealthKit | Kilocalories burned above BMR (Move ring) |
| Resting heart rate | HealthKit | Daily average from Apple Watch HR sensor |
| Body weight | HealthKit | If logged manually or from connected scale |
| Workout sessions | HealthKit | Type, duration, energy, distance |
| Stand hours | HealthKit | Stand ring progress |
| Exercise minutes | HealthKit | Exercise ring (green ring) minutes |
| Sleep (if using Apple Watch sleep tracking) | HealthKit | Total sleep, asleep/in-bed times |

Note: Apple Health does not natively export HRV RMSSD or readiness scores. If both Oura and Apple Health are configured, Oura provides HRV and readiness; Apple Health provides step count and workout detail.

## Configuration

Add to `vault/health/config.md`:
```
apple_health_export_path: ~/Library/Mobile Documents/com~apple~CloudDocs/HealthExports/
apple_health_export_format: csv
```

## iOS Shortcut Setup

1. On iPhone, open the **Shortcuts** app
2. Create a new shortcut or download a community "Export Health Data to CSV" shortcut
3. Configure the shortcut to export the desired metrics (steps, energy, HR, weight, workouts)
4. Set the save destination to the iCloud Drive path matching `apple_health_export_path` in config.md
5. Run the shortcut manually when you want to update data, or add it to an Automation (e.g., every Monday morning)

## Merge Behavior With Oura

When both `oura` and `apple_health` are configured as `wearable_type: both` in config.md:
- Steps: prefer Apple Health (typically more accurate for iPhone step counting)
- HRV and readiness: Oura only (Apple does not export these)
- Resting HR: Oura preferred if available; Apple Watch used as fallback
- Workouts: Apple Health (richer workout detail)
- Sleep score: Oura preferred; Apple Watch sleep used if Oura data is missing

## Used By

- `aireadylife-health-sync-wearable-data` — read and append Apple Health daily records
- `aireadylife-health-build-wellness-summary` — supplement Oura data or serve as primary source

## Vault Output

- `vault/health/00_current/wearable-log.csv` — daily records appended from Apple Health export
