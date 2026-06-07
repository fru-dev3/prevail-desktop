---
name: aireadylife-content-flow-build-seo-summary
type: flow
trigger: called-by-op
description: >
  Summarizes keyword rankings, search impressions, and top content performance;
  identifies quick-win keywords (positions 4-15), ranking drops, and top 3
  optimization opportunities.
---

## What It Does

Reads SEO data from `~/Documents/aireadylife/vault/content/00_current/` and produces a monthly SEO intelligence summary with three specific outputs: quick-win opportunities, ranking loss alerts, and content gap flags.

Quick-win zone (positions 4-15): these keywords already have proven search demand and the user's content has demonstrated enough authority to rank in the top 2 pages. The gap between position 11 and position 3 is often bridgeable with targeted on-page optimization — updating the title tag to include the keyword more naturally, adding the keyword to subheadings, improving internal linking to the page, refreshing the publication date, or adding a table or summary section that could capture a featured snippet. Quick wins are sorted by search volume (highest potential traffic impact first).

Ranking loss alerts (dropped more than 3 positions MoM): a content piece dropping from position 4 to position 7 has lost roughly 30-40% of its click traffic. Common causes: a competitor published a better-optimized piece, the content has not been updated and has freshness decay, a technical issue (slow page speed, broken internal links), or the search intent for that query has shifted (e.g., the query now returns more commercial results and the informational piece is less favored). The alert includes the page URL, keywords affected, prior position, current position, and a diagnosis attempt.

Content gap analysis: keywords in the user's topic space that have sufficient monthly search volume (above the configured threshold) but no existing content targeting them. These are uncontested opportunities where creating or expanding content could capture organic traffic from a standing start. Returns the top 3 optimization opportunities ranked by impact potential (search volume × position improvement potential ÷ estimated effort).

## Triggers

Called internally by `aireadylife-content-op-seo-review`. Not invoked directly by the user.

## Steps

1. Read keyword ranking data from `~/Documents/aireadylife/vault/content/00_current/` — current month and prior month keyword snapshots, each with keyword, ranking position, search volume, page URL, CTR
2. Identify all keywords ranking in positions 4-15 (quick-win zone): list with current position, search volume, page URL, and a specific optimization recommendation
3. Sort quick-win keywords by search volume descending (highest potential click impact first)
4. Identify all keywords that have dropped more than 3 positions vs prior month; record: keyword, prior position, current position, page URL, estimated traffic impact (click loss)
5. For each ranking drop: attempt diagnosis based on available signals (freshness of last update, competitor activity if noted, content format vs SERP intent)
6. Read keyword gap list from vault/content/00_current/keyword-gaps.md (if exists); filter to keywords with volume above configured threshold and no existing content
7. Score each opportunity: score = (search volume / 1000) × (position improvement potential) ÷ effort estimate (1=high effort, 3=low effort)
8. Select top 3 opportunities by score, one from each category where possible (quick-win, ranking recovery, content gap)
9. Return: quick-win list, ranking drop list, gap list, top 3 prioritized opportunities

## Input

- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}-rankings.md` — keyword rankings current month
- `~/Documents/aireadylife/vault/content/00_current/{prior YYYY-MM}-rankings.md` — prior month rankings for comparison
- `~/Documents/aireadylife/vault/content/00_current/keyword-gaps.md` — keyword gap list (optional)
- `~/Documents/aireadylife/vault/content/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/content/config.md` — keyword volume threshold, topic areas

## Output Format

```
## SEO Summary — {Month} {Year}

### Quick-Win Zone (Positions 4-15)
| Keyword            | Position | Volume/Mo | Page URL       | Optimization Action              |
|--------------------|----------|-----------|----------------|----------------------------------|
| [keyword]          | 8        | 2,400     | /blog/post-1   | Add keyword to H2, update meta   |
| [keyword]          | 12       | 1,800     | /blog/post-2   | Refresh content + internal links |

### Ranking Drops (>3 positions MoM)
| Keyword       | Prior | Current | Page URL     | Traffic Impact | Diagnosis                |
|---------------|-------|---------|--------------|----------------|--------------------------|
| [keyword]     | 4     | 9       | /blog/post-3 | ~-40% clicks   | Freshness decay — update |

### Content Gaps (No existing content)
| Keyword       | Volume/Mo | Competition | Action                          |
|---------------|-----------|-------------|---------------------------------|
| [keyword]     | 3,200     | Medium      | Create dedicated post            |

### Top 3 Opportunities
1. 🎯 [Keyword] — Pos 8 → 3 potential: update [page] with [specific action] — Est. 30 min effort
2. 🎯 [Keyword] — Ranking recovery: refresh [page] content from 2024 — Est. 45 min effort
3. 🎯 [Keyword] — New content: create guide targeting this 3,200/mo keyword — Est. 2 hr effort
```

## Configuration

Required in `~/Documents/aireadylife/vault/content/config.md`:
- `seo_topic_areas` — list of topic domains to focus gap analysis on
- `seo_volume_threshold` — minimum monthly search volume to include in gap analysis (default: 500)
- `seo_quick_win_positions` — position range for quick-win zone (default: 4-15)

Required file format in `03_seo/{YYYY-MM}-rankings.md`:
- Each row: keyword, position, search-volume, page-url, impressions, ctr

## Error Handling

- If no ranking files exist: "No SEO data found. Export keyword rankings from Google Search Console and save to vault/content/00_current/ to enable SEO tracking."
- If prior month rankings file is missing: skip drop analysis and note "No prior month data — ranking drop detection unavailable."
- If keyword-gaps.md is missing: skip gap analysis and note "No keyword gap list found — add keywords to track to vault/content/00_current/keyword-gaps.md."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/content/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/config.md`
- Writes to: returns data to calling op; no direct file writes
