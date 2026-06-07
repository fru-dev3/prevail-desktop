---
name: aireadylife-brand-flow-build-analytics-summary
type: flow
trigger: called-by-op
description: >
  Compiles cross-platform analytics: followers, growth, engagement rate, and impressions per
  platform with month-over-month deltas and top-performing content identified.
---

## What It Does

Reads platform analytics data from `~/Documents/aireadylife/vault/brand/00_current/` where monthly metric snapshots are stored per platform. For each configured platform (LinkedIn, Twitter/X, YouTube, newsletter/Beehiiv, personal site via Google Analytics), extracts the current month's key metrics: follower or subscriber count, total impressions for the period, total engagements (likes, comments, shares, clicks), and calculates an engagement rate (engagements divided by impressions, expressed as a percentage).

Compares each metric to the prior month's figures — both absolute change and percentage change — to produce MoM growth indicators. Growth direction is shown as ▲ (up), ▼ (down), or → (flat, within ±2%). Benchmarks the calculated engagement rate against platform-specific standards: LinkedIn 2-5% is good; Instagram 1-5%; Twitter/X 0.5-1%; newsletter 30-40% open rate, 2-5% CTR.

Scans `~/Documents/aireadylife/vault/brand/00_current/` for the content performance log to identify the top 3 performing pieces across all platforms by engagement. These are surfaced as the "best of the period" in the analytics summary — understanding what performs best informs content strategy.

Formats the complete result as a structured summary table with one row per platform, metric columns for this month and prior month, delta indicators, and engagement rate vs benchmark. Flags any platform where engagement rate has dropped more than 20% MoM as 🟡 watch. Returns the formatted table to the calling op.

## Triggers

Called internally by `aireadylife-brand-op-monthly-synthesis` and `aireadylife-brand-op-content-review`. Not invoked directly by the user.

## Steps

1. Read all platform analytics files from `~/Documents/aireadylife/vault/brand/00_current/` for current and prior month; identify which platforms have data
2. For each platform: extract follower count, total impressions, total engagements; calculate engagement rate = engagements / impressions
3. Compare to prior month: calculate absolute delta and percentage change for followers, impressions, and engagement rate
4. Benchmark engagement rate against platform-specific thresholds; flag if below benchmark or if dropped >20% MoM
5. Read `~/Documents/aireadylife/vault/brand/00_current/` content log; identify top 3 posts by engagement across all platforms
6. Calculate an overall reach metric: sum of all-platform impressions for the period
7. Format structured summary table with platform rows, metric columns, delta indicators, and benchmark comparison
8. Return formatted table, top content list, and any 🟡 engagement drop flags to calling op

## Input

- `~/Documents/aireadylife/vault/brand/00_current/{platform}-{YYYY-MM}.md` — monthly analytics snapshot per platform; fields: followers, impressions, engagements
- `~/Documents/aireadylife/vault/brand/00_current/{platform}-{prior YYYY-MM}.md` — prior month for MoM comparison
- `~/Documents/aireadylife/vault/brand/00_current/` — content performance log for top content identification
- `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/brand/config.md` — configured platforms, engagement rate benchmarks

## Output Format

```
## Cross-Platform Analytics — {Month} {Year}

| Platform    | Followers | MoM    | Impressions | Engagements | Eng Rate | vs Benchmark |
|-------------|-----------|--------|-------------|-------------|----------|--------------|
| LinkedIn    | X,XXX     | ▲ +X%  | XX,XXX      | XXX         | 3.2%     | ✓ (2-5%)    |
| Twitter/X   | X,XXX     | → 0%   | XX,XXX      | XXX         | 0.7%     | ✓ (0.5-1%) |
| YouTube     | X,XXX     | ▲ +X%  | XX,XXX      | XXX         | N/A      | —           |
| Newsletter  | X,XXX     | ▲ +X%  | XX,XXX      | XXX         | 34% OR  | ✓ (30-40%) |

**Total Reach (all platforms):** XXX,XXX impressions

## Top Content — {Month}
1. "[Post title]" — {Platform} — {X,XXX} engagements
2. "[Post title]" — {Platform} — {XXX} engagements
3. "[Post title]" — {Platform} — {XXX} engagements

## Flags
🟡 [Platform]: engagement rate dropped from X% to X% (-X%) — investigate
```

## Configuration

Required in `~/Documents/aireadylife/vault/brand/config.md`:
- `platforms` — list of active platforms to include in analytics summary
- `engagement_benchmark_{platform}` — override default benchmarks per platform (optional)

Required file naming convention in `01_analytics/`:
- `{platform}-{YYYY-MM}.md` — e.g., `linkedin-2026-03.md`

## Error Handling

- If a platform file is missing for the current month: include the platform row with "No data — update vault" and exclude from engagement calculations.
- If prior month file is missing: show current month metrics but populate MoM columns with "N/A."
- If `04_content/` is empty or missing: skip top content section and note "No content log — add entries to vault/brand/00_current/ to enable top content tracking."
- If all platform files are missing: "No analytics data found. Export monthly metrics from each platform and add to vault/brand/00_current/."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/config.md`
- Writes to: returns data to calling op; no direct file writes
