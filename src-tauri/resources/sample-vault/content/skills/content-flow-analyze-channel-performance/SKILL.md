---
name: aireadylife-content-flow-analyze-channel-performance
type: flow
trigger: called-by-op
description: >
  Builds a cross-channel performance dashboard with 30-day totals per platform,
  MoM comparisons, and flags for channels underperforming vs. their 90-day average.
---

## What It Does

Reads platform analytics from all content channel vault locations and assembles a 30-day performance snapshot for every active content platform. For each platform, extracts the three core metrics that define channel health: the growth metric (subscribers gained, newsletter list net change, LinkedIn followers gained), the engagement metric (average view duration or AVD for YouTube, open rate for newsletter, impressions for LinkedIn), and the monetization metric (AdSense RPM for YouTube, paid subscription MRR for newsletter, product sales volume for Gumroad).

Calculates a 90-day rolling average for each primary metric by reading the prior three months' analytics files and averaging the figures. Compares the current 30-day figure to the 90-day average to detect deviation. A channel is flagged as underperforming if its primary growth metric is more than 15% below the 90-day average — this threshold accounts for normal monthly variation while catching genuine downward trends. Flat growth (within ±5% of average) is labeled "stable."

For flagged underperforming channels, runs a 1-line diagnosis: checks whether the publishing cadence this month was lower than the 90-day average cadence (cadence drop), whether the engagement rate per piece dropped even though volume held (quality or topic mismatch), whether the underperformance is platform-wide or isolated to a specific format or topic. Adds a trend indicator (▲ / → / ▼) to each metric to make scanning fast. Returns the full cross-channel table with trend indicators, underperformance flags, and diagnostic notes.

## Triggers

Called internally by `aireadylife-content-op-channel-review`. Not invoked directly by the user.

## Steps

1. Read analytics from `~/Documents/aireadylife/vault/content/00_current/` for current and prior 3 months; extract: views, watch time, subscribers gained, CTR, AVD, top video
2. Read analytics from `~/Documents/aireadylife/vault/content/00_current/` for current and prior 3 months; extract: subscribers, net new, open rate, CTR, send count
3. Read analytics from `~/Documents/aireadylife/vault/content/00_current/` for current and prior 3 months; extract: units sold, revenue, refund rate, conversion rate
4. For each platform, calculate 30-day totals for all metrics
5. Calculate 90-day rolling average for each primary growth metric (sum of prior 3 months / 3)
6. Compare current 30-day primary growth metric to 90-day average; calculate deviation percentage
7. Flag platforms where primary metric is >15% below average as underperforming; label 0-15% below as stable; label above average as growing
8. For underperforming channels: check publishing cadence (posts/videos this month vs 90-day average) and per-piece engagement rate vs 90-day average; compose 1-line diagnosis
9. Add trend indicator (▲ >5% above avg, → ±5%, ▼ >5% below avg) to each metric
10. Return cross-channel performance table with all metrics, trend indicators, and flags

## Input

- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — YouTube analytics, current + prior 3 months
- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — newsletter metrics, current + prior 3 months
- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — Gumroad sales data, current + prior 3 months
- `~/Documents/aireadylife/vault/content/01_prior/` — prior period records for trend comparison

## Output Format

```
## Channel Performance — {Month} {Year}

| Channel      | Growth Metric         | 30-Day | 90-Day Avg | Deviation | Trend | Status        |
|--------------|-----------------------|--------|------------|-----------|-------|---------------|
| YouTube      | Subscribers gained    | +180   | +210       | -14%      | →     | Stable        |
| Newsletter   | Net new subscribers   | +320   | +280       | +14%      | ▲     | Growing       |
| Gumroad      | Units sold            | 12     | 18         | -33%      | ▼     | ⚠ Underperforming |

### Underperformance Diagnosis
- Gumroad: 33% below 90-day avg — publishing cadence on point; product page CTR dropped from 2.8% to 1.9% — possible ad traffic quality change or product page needs optimization

### Engagement Metrics
| Channel    | Engagement Metric     | This Month | 90-Day Avg | Trend |
|------------|-----------------------|------------|------------|-------|
| YouTube    | AVD (% watched)       | 52%        | 48%        | ▲     |
| Newsletter | Open rate             | 36%        | 34%        | ▲     |
```

## Configuration

Required file naming in vault content subfolders:
- `{YYYY-MM}.md` — monthly analytics snapshot for each platform
- Each file must include the primary growth metric, engagement metric, and publish count for that month

## Error Handling

- If fewer than 2 prior months of data exist: calculate available average and note "90-day average based on {X} months of data — trend analysis will improve as more data accumulates."
- If a platform subfolder is missing: exclude from the report and note "No data folder found for {platform}."
- If current month file is missing for a platform: note "No current month data for {platform} — add analytics to vault/content/{subfolder}/."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/content/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`
- Writes to: returns data to calling op; no direct file writes
