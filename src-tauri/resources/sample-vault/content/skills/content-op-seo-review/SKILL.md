---
name: aireadylife-content-op-seo-review
type: op
cadence: monthly
description: >
  Monthly SEO health check; reviews keyword rankings, search impressions, top-performing
  content, and quick-win optimization opportunities. Identifies content losing ranking
  and keywords with no coverage.
  Triggers: "SEO review", "search rankings", "keyword performance", "SEO audit".
---

## What It Does

Analyzes the full SEO picture across all content properties on the first week of each month. SEO is a compounding asset — content that ranks well drives traffic indefinitely, but rankings are not static. Competitors optimize, algorithms update, content ages, and search intent shifts. This monthly review is what keeps the SEO asset healthy and growing rather than decaying unnoticed.

Calls `aireadylife-content-flow-build-seo-summary` to identify the quick-win keyword zone (positions 4-15 where targeted optimization can realistically push to top 3), ranking drops (content that slipped and needs recovery work), and keyword gaps (high-volume topics with no existing content). Generates a prioritized top-3 opportunity list — not a 40-item SEO audit, but three specific things to do this month.

Also checks content freshness specifically: any content currently ranking in the top 10 for a significant keyword that was published or last updated more than 6 months ago is at risk. Google's freshness signal can cause gradual ranking decay for time-sensitive topics (AI tools, finance, software tutorials). Flags these for a content refresh before ranking drops occur rather than after. A 30-minute content refresh (updated examples, new data point, refreshed publish date) can maintain a top-10 ranking for another 6-12 months.

Calls `aireadylife-content-task-flag-seo-gap` for each keyword or content piece requiring immediate action. Writes a dated SEO brief to vault/content/00_current/ and updates open-loops.

## Triggers

- "SEO review"
- "search rankings"
- "keyword performance"
- "SEO audit"
- "how is my site ranking"
- "content optimization opportunities"
- "what keywords am I losing"

## Steps

1. Confirm vault/content/00_current/ exists with at least one ranking snapshot file; if missing, prompt for Google Search Console data export
2. Call `aireadylife-content-flow-build-seo-summary` for quick-win list, ranking drops, gap analysis, and top 3 opportunities
3. Separately check top-10 content pieces for freshness: read last-updated date from content records; flag any top-10 page last updated more than 6 months ago
4. For the freshness-risk pages: note the keyword(s) they rank for, current position, and estimated traffic risk if ranking slips
5. For each opportunity in the top 3 list: call `aireadylife-content-task-flag-seo-gap` to write a prioritized action item to open-loops
6. Calculate total estimated monthly search traffic from top-10 rankings (sum: keyword search volume × expected CTR at current position — use 30% CTR for pos 1, 12% for pos 2-3, 5% for pos 4-7, 2% for pos 8-15)
7. Compare this estimated traffic to prior month to gauge whether SEO traffic is growing, stable, or declining
8. Write SEO brief to vault/content/00_current/seo-review-{YYYY-MM}.md
9. Call `aireadylife-content-task-update-open-loops` for any ranking drops or gaps not already flagged by the flag-seo-gap task

## Input

- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}-rankings.md` — keyword rankings
- `~/Documents/aireadylife/vault/content/00_current/{prior YYYY-MM}-rankings.md` — prior month for comparison
- `~/Documents/aireadylife/vault/content/00_current/keyword-gaps.md` — known keyword gaps
- `~/Documents/aireadylife/vault/content/00_current/` — content publication dates for freshness check
- `~/Documents/aireadylife/vault/content/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/content/config.md` — topic areas, volume thresholds

## Output Format

```
# SEO Review — {Month} {Year}

**Estimated Monthly Search Traffic:** ~X,XXX sessions | MoM: ▲/▼ ±X%
**Keywords Tracked:** {X} | Top 10: {X} | Top 3: {X}

## Quick-Win Opportunities (Positions 4-15)
[Table from build-seo-summary — top 5 by volume]

## Ranking Losses (Dropped >3 positions)
[Table from build-seo-summary]

## Freshness Risk (Top-10, last updated >6 months)
| Page          | Keyword     | Position | Last Updated | Risk Action                  |
|---------------|-------------|----------|--------------|------------------------------|
| /blog/post-1  | [keyword]   | 4        | 2025-08-01   | Refresh with 2026 data + date |

## Content Gaps (High-volume, no coverage)
[Top 3 from build-seo-summary]

## Top 3 Actions This Month
1. 🎯 [Specific keyword + page + action + estimated time]
2. 🎯 [Specific keyword + page + action + estimated time]
3. 🎯 [Specific keyword + page + action + estimated time]
```

## Configuration

Required in `~/Documents/aireadylife/vault/content/config.md`:
- `seo_topic_areas` — topic domains for gap analysis focus
- `seo_volume_threshold` — minimum monthly volume for gap analysis (default: 500)
- `seo_freshness_threshold_months` — months before a top-10 page is flagged for refresh (default: 6)

## Error Handling

- If no ranking data exists: "No SEO data found. Export from Google Search Console: Performance → Download → CSV. Save monthly snapshots to vault/content/00_current/."
- If prior month ranking file is missing: skip drop analysis; note "First month of tracking — ranking trends will appear next month."
- If content publication dates are unavailable for freshness check: skip freshness section with a note.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/content/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/config.md`
- Writes to: `~/Documents/aireadylife/vault/content/00_current/seo-review-{YYYY-MM}.md`, `~/Documents/aireadylife/vault/content/open-loops.md`
