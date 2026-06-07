---
name: aireadylife-content-op-revenue-review
type: op
cadence: monthly
description: >
  Monthly revenue review across all content channels: YouTube AdSense, newsletter
  sponsorships and paid tiers, and digital product sales (Gumroad). Produces a
  consolidated MoM comparison with top channel identification.
  Triggers: "content revenue", "creator revenue", "how much did I make", "monthly revenue".
---

## What It Does

Runs on the first of each month to consolidate revenue from every content monetization channel into a single comparable report. This is the financial heartbeat of the content business — one document that answers "how much did the content business make last month, where did it come from, and is it growing?"

Calls `aireadylife-content-flow-build-revenue-summary` to aggregate YouTube AdSense earnings, newsletter revenue (sponsorship + paid subscriptions as separate line items), and Gumroad digital product revenue by individual product. Calculates MoM change per channel and total. Identifies the top revenue channel and flags any channel with >20% MoM decline.

Goes deeper than the raw numbers: calculates YouTube RPM trend (is revenue per view improving or declining, independent of view volume?), newsletter subscriber LTV (MRR divided by total paid subscribers to get average value per subscriber), and Gumroad conversion rate trend (are more or fewer page visitors becoming buyers?). These ratio metrics tell the quality story behind the volume numbers.

Writes a structured revenue log entry via `aireadylife-content-task-log-revenue` so the vault has a clean monthly record for YTD tracking. Calculates YTD total content revenue if prior monthly data is available. Flags revenue anomalies — unexpected spikes (which source drove the spike? is it repeatable?) and unexpected drops (seasonal or structural change?). Writes the complete brief and updates open-loops.

## Triggers

- "content revenue"
- "creator revenue"
- "how much did I make this month"
- "monthly revenue review"
- "YouTube earnings"
- "Gumroad sales"
- "newsletter revenue"

## Steps

1. Determine review period: prior full calendar month
2. Call `aireadylife-content-flow-build-revenue-summary` for per-channel and total revenue figures with MoM deltas
3. Calculate quality metrics: YouTube RPM this month vs prior (RPM = AdSense earnings / views × 1000); newsletter subscriber LTV (MRR / paid subscribers); Gumroad conversion rate (units sold / page visits if traffic data available)
4. Calculate content revenue as a % of total income if total income context is available in config.md
5. Calculate YTD total content revenue by summing all monthly log files in vault/content/00_current/, 00_youtube/, 01_newsletter/
6. Flag any channel with >20% MoM decline; assess whether it is seasonal (YouTube RPM always drops in January) or anomalous
7. Flag any channel with >50% MoM spike; note which activity drove it (promotional email, viral video, etc.) for repeatability assessment
8. Call `aireadylife-content-task-log-revenue` to write a structured monthly revenue record to the vault
9. Write complete revenue review brief to vault/content/00_current/revenue-{YYYY-MM}.md
10. Call `aireadylife-content-task-update-open-loops` with revenue decline flags and anomalies

## Input

- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — AdSense earnings, views, RPM
- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — sponsorship fees, MRR, paid subscribers
- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — product sales by product
- `~/Documents/aireadylife/vault/content/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/content/config.md` — channel list, seasonal expectations

## Output Format

```
# Content Revenue Review — {Month} {Year}

**Total Content Revenue:** $X,XXX | MoM: ▲/▼ ±X% | YTD: $XX,XXX

## Revenue by Channel
[Table from build-revenue-summary flow]

## Quality Metrics
| Metric                     | This Month | Prior Month | Trend |
|----------------------------|------------|-------------|-------|
| YouTube RPM                | $X.XX      | $X.XX       | ▲/▼   |
| Newsletter Subscriber LTV  | $X.XX/mo   | $X.XX/mo    | ▲/▼   |
| Gumroad Conversion Rate    | X.X%       | X.X%        | ▲/▼   |

## Revenue Flags
🟡 [Channel]: declined X% MoM — [seasonal/anomalous] — [action or monitor]
🟢 [Spike channel]: +X% — driven by [specific activity] — [repeatable?]

## Action Items
1. [Most impactful revenue action for next month]
```

## Configuration

Required in `~/Documents/aireadylife/vault/content/config.md`:
- `revenue_channels` — list of monetization channels
- `revenue_target_monthly` — monthly revenue target (enables target vs actual display)
- `seasonal_expectations` — notes on expected seasonal RPM fluctuations (optional)

## Error Handling

- If a channel has no revenue data this month: include as $0 and note "No revenue data for {channel} — add file to vault/content/{subfolder}/."
- If Gumroad product has refund rate >10%: flag in revenue review as "elevated refund rate — review product positioning."
- If YTD calculation is incomplete (missing months): note which months are absent and calculate from available data.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/content/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/config.md`
- Writes to: `~/Documents/aireadylife/vault/content/00_current/revenue-{YYYY-MM}.md`, `~/Documents/aireadylife/vault/content/open-loops.md`
