---
name: aireadylife-health-flow-build-wellness-summary
type: flow
trigger: called-by-op
description: >
  Compiles a monthly wearable wellness summary covering sleep score, sleep duration,
  HRV (RMSSD), resting heart rate, readiness score, daily steps, and active energy.
  Calculates 30-day averages, compares to the prior 30-day period and the 90-day
  rolling baseline, and flags any metric deviating more than 15% from baseline.
  Supports Oura Ring and Apple Health as data sources.
---

# aireadylife-health-build-wellness-summary

**Trigger:** Called by `aireadylife-health-review-brief` and `aireadylife-health-anomaly-watch`
**Produces:** Monthly wellness summary in `vault/health/02_briefs/YYYY-MM-wellness-summary.md`

## What It Does

Reads all wearable data export files in `vault/health/00_current/` and calculates 30-day rolling averages for seven core wellness signals: sleep score (0–100 Oura scale), total sleep duration (hours), HRV RMSSD (nightly average, in milliseconds), resting heart rate (BPM), readiness score (Oura, 0–100), daily step count, and active energy burned (kcal). For Apple Health sources, only the metrics available are computed — the system does not fail if HRV or readiness are missing from Apple data.

Each metric's 30-day average is compared against two baselines: the prior 30-day period (month-over-month trend) and the 90-day rolling baseline (broader personal norm). A metric deviating more than 15% from the 90-day baseline is flagged with a deviation label. A metric improving vs. prior month but still deviating from the 90-day baseline is noted as "recovering" — this distinction matters for HRV and sleep score, where short-term disruptions (illness, travel) may resolve while the longer trend still warrants attention.

For HRV specifically, absolute RMSSD values vary enormously between individuals (15–100+ ms is a normal range), so the comparison is always against the user's personal baseline rather than a population average. A 20% drop in personal HRV over 7 days is flagged regardless of the absolute value. For resting heart rate, a sustained increase of 5 BPM above the 90-day average for more than 3 consecutive days is flagged as an anomaly.

Sleep duration is evaluated against the 7–9 hour adult guideline. A 30-day average below 7 hours is flagged as a moderate concern; below 6.5 hours as a high concern. Sleep score below 70 (Oura scale) for more than 10 of 30 nights is flagged as a pattern. Step count below 5,000/day on average is noted; below 7,000 is flagged. The summary does not include specific daily entries — only aggregated statistics — keeping the document concise enough to be read in under 2 minutes.

## Triggers

- "wellness summary"
- "how has my sleep been"
- "show my wearable trends"
- "HRV trend this month"
- "are my health metrics normal"
- "monthly wellness report"
- "how is my readiness trending"
- "compare this month vs last month"

## Steps

1. Read all wearable export files from `vault/health/00_current/` (Oura JSON exports or Apple Health CSV)
2. Filter records to the most recent 90 days; partition into three 30-day windows (current month, prior month, 90-day pool)
3. Calculate 30-day averages for: sleep score, sleep duration, HRV RMSSD, resting HR, readiness score, steps, active energy
4. Calculate prior 30-day averages for month-over-month delta on each metric
5. Calculate 90-day average as the personal baseline for each metric
6. For each metric, compute percent deviation from 90-day baseline
7. Flag any metric with deviation >15% from baseline; label as "declining," "improving," or "stable vs. baseline"
8. Apply special rules: HRV drop >20% over any 7-day window = anomaly; sustained resting HR +5 BPM = anomaly; sleep <7h average = concern
9. Write formatted wellness summary to `vault/health/02_briefs/YYYY-MM-wellness-summary.md`
10. Return flagged metrics list to the calling op for open-loop logging

## Input

- `vault/health/00_current/` — Oura Ring JSON or Apple Health CSV exports
- `vault/health/01_prior/` — prior period records for trend comparison
- `vault/health/config.md` — wearable type, any user-configured thresholds

## Output Format

Markdown document with:
- Header: summary period, data source (Oura / Apple Health / both), number of days covered
- Metrics table: Metric | 30-Day Avg | Prior Month Avg | MoM Delta | 90-Day Baseline | Deviation | Status
- Flags section: each flagged metric with plain-English description and recommended action
- Data quality note: number of days with missing data and any gaps >3 days

## Configuration

Required fields in `vault/health/config.md`:
- `wearable_type` — oura | apple_health | both
- `wearable_export_path` — path to the folder where exports are saved
- `sleep_target_hours` — optional override, defaults to 7.5
- `step_target_daily` — optional override, defaults to 8000

## Error Handling

- If fewer than 14 days of data are available: compute averages on available data and note "Limited data — fewer than 14 days in range; trends may not be representative"
- If export files are stale (last export >7 days ago): alert user to run a new export before the summary is generated
- If no wearable data exists in vault: skip this flow section in the brief and report "No wearable data found. See config.md to configure your device export."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/health/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/health/00_current/`
- Reads from: `~/Documents/aireadylife/vault/health/config.md`
- Writes to: `~/Documents/aireadylife/vault/health/02_briefs/YYYY-MM-wellness-summary.md`
