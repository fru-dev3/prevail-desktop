---
name: aireadylife-health-flow-sync-wearable-data
type: flow
trigger: called-by-op
description: >
  Ingests new wearable device exports from Oura Ring (JSON) or Apple Health (XML/CSV)
  and appends new daily records to vault/health/00_current/ without overwriting
  existing data. Extracts sleep score, sleep duration, HRV RMSSD, resting heart rate,
  readiness score, steps, and active energy. Reports date range coverage and flags gaps
  greater than 3 consecutive days.
---

# aireadylife-health-sync-wearable-data

**Trigger:** Called by `aireadylife-health-monthly-sync` and `aireadylife-health-anomaly-watch`
**Produces:** Updated wearable records in `vault/health/00_current/`

## What It Does

Checks the configured sync folder (set in config.md) for new wearable export files. For Oura Ring, this is the JSON export downloaded from the Oura app or fetched via the Oura API v2 using the configured API key. For Apple Health, this is the XML or CSV export triggered via iOS Shortcuts and synced to the configured iCloud Drive path. When both sources are configured, both are processed and their non-overlapping metrics are merged into a unified daily record.

For Oura Ring exports, the following fields are extracted per day: date, sleep score (0–100), total sleep duration (minutes), deep sleep (minutes), REM sleep (minutes), sleep efficiency (%), latency (minutes to fall asleep), HRV RMSSD (nightly average, ms), resting heart rate (BPM), readiness score (0–100), activity steps, active energy (kcal). For Apple Health exports, the fields extracted are: date, steps, active energy (kcal), resting heart rate (if recorded), body weight (if recorded), workout sessions (type, duration, energy).

New records are appended to the unified wearable log at `vault/health/00_current/wearable-log.csv` (or one file per source if both are configured). The append operation checks each incoming record's date against existing dates in the file — no duplicate entries are written. After appending, the flow confirms the full date range now covered and reports any gap greater than 3 consecutive days where no data exists. Gaps are common after device battery death, travel without syncing, or manual export failures and are reported as warnings rather than errors.

## Triggers

- "sync wearable data"
- "update my health data"
- "pull Oura data"
- "sync Apple Health"
- "refresh health metrics"
- "import wearable export"
- "update sleep data"

## Steps

1. Read `vault/health/config.md` to identify: wearable type, export folder path, and API key (if Oura API is configured)
2. Check configured sync folder for new export files newer than the last sync timestamp recorded in vault
3. For Oura JSON exports: parse daily records and extract the target fields per day
4. For Apple Health XML/CSV: parse records and extract available daily aggregates per day
5. For each incoming date record, check against existing records in `vault/health/00_current/wearable-log.csv`
6. Append only records with dates not already present in the log (no overwrite)
7. Update the last-sync timestamp in vault to the latest record date processed
8. Compute the full date range now covered (earliest date to latest date in the log)
9. Identify any gap >3 consecutive days within the covered range and report them
10. Return a sync summary: records added, date range now covered, gaps found (if any)

## Input

- `vault/health/config.md` — wearable type, export path, API key, sync folder
- New export file(s) in the configured sync folder (Oura JSON or Apple Health CSV/XML)
- `vault/health/01_prior/` — prior period records for trend comparison

## Output Format

Console summary to the user:
- Records added: N new records appended
- Coverage: [earliest date] through [latest date] (N days)
- Gaps: [list any gaps >3 days] or "No gaps found"

Written to vault:
- Appended rows in `vault/health/00_current/wearable-log.csv`
- Updated last-sync timestamp in `vault/health/00_current/sync-status.md`

## Configuration

Required fields in `vault/health/config.md`:
- `wearable_type` — oura | apple_health | both
- `wearable_export_path` — path to folder containing export files
- `oura_api_key` — Oura Ring API v2 key (if using API instead of manual export)
- `apple_health_export_path` — iCloud Drive path for Apple Health CSV exports

## Error Handling

- If no new export file is found in the sync folder: report "No new export files found. Open your wearable app, export data, and save to [export path]."
- If the export file format is unrecognized: report the filename and ask user to confirm format (Oura JSON vs Apple Health XML)
- If fewer than 7 days of new data are found in an export that should cover 30 days: warn that the export may be partial; suggest re-exporting from the device app
- If the wearable-log.csv does not exist: create it with the standard column headers before appending

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/health/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/health/config.md`
- Reads from: configured export folder (typically Downloads or iCloud Drive path)
- Writes to: `~/Documents/aireadylife/vault/health/00_current/wearable-log.csv`
- Writes to: `~/Documents/aireadylife/vault/health/00_current/sync-status.md`
