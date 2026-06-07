---
name: aireadylife-health-op-anomaly-watch
type: op
cadence: weekly
description: >
  Weekly wearable anomaly watch. Syncs the latest Oura Ring or Apple Health export,
  computes a 90-day rolling baseline for HRV, sleep score, resting heart rate, and
  readiness, and flags any metric that has deviated more than 2 standard deviations
  from its baseline in the past 7 days. Triggers: "weekly health check", "check my
  wearable data", "anomaly scan", "how is my HRV this week".
---

# aireadylife-health-anomaly-watch

**Cadence:** Weekly (every Monday)
**Produces:** Anomaly flags in `vault/health/open-loops.md`; updated wearable data in `vault/health/00_current/`

## What It Does

Runs every Monday to surface meaningful deviations in wearable health metrics before they escalate into health events. The 2-standard-deviation threshold is chosen deliberately: it catches true anomalies (roughly 5% of data points under a normal distribution) while filtering out the natural daily variation that would create noise with a tighter threshold.

The op first calls `aireadylife-health-sync-wearable-data` to ensure the vault contains the latest Oura Ring or Apple Health data through yesterday. It then computes a rolling 90-day baseline for each of the four primary signals: HRV RMSSD (individual baseline is essential here — a personal HRV of 25 ms may be perfectly healthy while the population average is 50 ms), sleep score (Oura 0–100), resting heart rate (BPM), and readiness score (Oura 0–100). The standard deviation for each metric is also calculated from the 90-day window.

Each of the past 7 days is evaluated: if any single day's value exceeds (baseline ± 2 SD), it is considered an anomalous data point. If 3 or more of the past 7 days are anomalous on the same metric, the flag is elevated to "sustained anomaly" — a more meaningful signal than a single-day outlier. The most common actionable patterns: sustained HRV drop (overtraining, illness onset, or excessive alcohol/stress), elevated resting HR for multiple days (illness or recovery deficit), and sleep score drops below the 2-SD floor (disrupted sleep pattern).

All anomalies detected are passed to `aireadylife-health-update-open-loops` with the metric name, baseline value, observed deviation, number of anomalous days in the window, and a suggested action (e.g., "reduce training load," "monitor for illness symptoms," "prioritize sleep this week").

## Calls

- **Flows:** `aireadylife-health-sync-wearable-data`, `aireadylife-health-build-wellness-summary`
- **Tasks:** `aireadylife-health-update-open-loops`

## Apps

- Oura Ring (JSON export or API v2)
- Apple Health (CSV export via iOS Shortcut)

## Vault Output

- `vault/health/00_current/wearable-log.csv` — updated with latest data
- `vault/health/open-loops.md` — new anomaly flags appended

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/health/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/health/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/health/02_briefs/` — prior briefs for period-over-period context
