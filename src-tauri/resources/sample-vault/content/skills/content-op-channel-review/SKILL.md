---
name: aireadylife-content-op-channel-review
type: op
cadence: monthly
description: >
  Monthly cross-channel performance review; subscriber growth, video views, newsletter
  opens, and product sales all in one brief. Flags channels underperforming vs.
  their 90-day average.
  Triggers: "channel review", "platform review", "YouTube review", "newsletter review".
---

## What It Does

Runs in the first week of each month to produce a complete cross-channel performance dashboard. This is the strategic monthly read — one document that tells the full content business story: where audiences are growing, where engagement is healthy, where monetization is working, and where the engine is stalling.

For YouTube: total views for the period, watch time in hours, net subscriber change, CTR on impressions (benchmark: 4-10% is strong), average view duration as a percentage of total video length (AVD >50% is strong), and the top-performing video by views with its CTR and AVD highlighted. For the newsletter: total subscriber count, net new subscribers for the period, open rate (benchmark: 30-40% for niche), click rate (benchmark: 2-5%), and the top-performing issue by open rate. For digital products (Gumroad): total units sold, revenue, conversion rate from page visits to purchases, and top-performing product. For LinkedIn: impressions and follower count change.

Calls `aireadylife-content-flow-analyze-channel-performance` to run the 90-day baseline comparison and identify underperforming channels. For each underperforming channel, produces a 1-line diagnosis and a specific recommended corrective action — not just "performance is down" but "YouTube subscriber growth is 23% below average; publishing cadence was 1 video/week vs prior 2 — resume 2/week cadence." Writes the dashboard brief to vault/content/00_current/channel-review-{YYYY-MM}.md.

## Triggers

- "channel review"
- "platform review"
- "YouTube review"
- "newsletter review"
- "content performance this month"
- "how are my channels doing"
- "subscriber growth update"

## Steps

1. Confirm vault/content/ is set up with analytics subfolders; list which platforms have current month data
2. Call `aireadylife-content-flow-analyze-channel-performance` for cross-channel performance table, 90-day baseline comparison, and underperformance flags
3. Extract YouTube key metrics from vault/content/00_current/: views, watch hours, sub change, CTR, AVD, top video
4. Extract newsletter key metrics from vault/content/00_current/: subscribers, net new, open rate, CTR, top issue
5. Extract Gumroad metrics from vault/content/00_current/: units, revenue, conversion rate, top product
6. Benchmark each metric against platform standards; note which are above, at, or below benchmark
7. For each underperforming channel (>15% below 90-day baseline): compose diagnosis and specific recommended action
8. Identify the single best-performing piece of content across all platforms this month
9. Calculate publishing cadence for each platform: posts/videos published vs target from config.md
10. Write channel review brief to vault/content/00_current/channel-review-{YYYY-MM}.md
11. Call `aireadylife-content-task-update-open-loops` with all underperformance flags and cadence misses

## Input

- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — YouTube analytics
- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — newsletter metrics
- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — Gumroad sales
- `~/Documents/aireadylife/vault/content/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/content/config.md` — channel list, cadence targets, benchmarks

## Output Format

```
# Channel Review — {Month} {Year}

## YouTube
| Metric           | This Month | 90-Day Avg | Benchmark | Status  |
|------------------|------------|------------|-----------|---------|
| Views            | XX,XXX     | XX,XXX     | —         | ▲ +X%  |
| Watch Hours      | XXX hrs    | XXX hrs    | —         | →       |
| Subscribers +/-  | +XXX       | +XXX       | —         | ▼ -X%  |
| CTR              | X.X%       | X.X%       | 4-10%     | ✓       |
| AVD              | XX%        | XX%        | >50%      | ✓       |
Top video: "[Title]" — X,XXX views, X.X% CTR

## Newsletter
| Metric         | This Month | 90-Day Avg | Benchmark | Status |
|----------------|------------|------------|-----------|--------|
| Subscribers    | X,XXX      | —          | —         | ▲      |
| Net New        | +XXX       | +XXX       | —         | ▲      |
| Open Rate      | XX%        | XX%        | 30-40%    | ✓      |
| CTR            | X.X%       | X.X%       | 2-5%      | ✓      |

## Gumroad
[Similar table with units, revenue, conversion rate]

## Publishing Cadence
| Platform    | Target | Published | Status   |
|-------------|--------|-----------|----------|
| YouTube     | 8/mo   | 6/mo      | 🟡 miss  |
| Newsletter  | 4/mo   | 4/mo      | 🟢       |

## ⚠ Underperformance Flags
- [Channel]: [diagnosis] — [recommended action]
```

## Configuration

Required in `~/Documents/aireadylife/vault/content/config.md`:
- `channels` — list of active content platforms
- `youtube_cadence_monthly`, `newsletter_cadence_monthly` — publishing targets
- `underperformance_threshold_pct` — % below 90-day avg to flag (default: 15)

## Error Handling

- If fewer than 2 prior months of data: run review with available data; note trend analysis will improve over time.
- If a channel has no current month data: include in dashboard with "No data this month."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/content/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/config.md`
- Writes to: `~/Documents/aireadylife/vault/content/00_current/channel-review-{YYYY-MM}.md`, `~/Documents/aireadylife/vault/content/open-loops.md`
