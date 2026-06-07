---
name: aireadylife-brand-op-content-review
type: op
cadence: monthly
description: >
  Monthly content output review that tracks publishing cadence vs goal, cross-platform performance,
  and top-performing content. Triggers: "content review", "brand performance", "how is my content doing".
---

## What It Does

Runs on the first of each month to evaluate the prior month's content output across all platforms. This is the brand-lens view of content — focused on how the content is building brand equity (followers, engagement rate, impressions, profile visibility) rather than revenue. The Content plugin handles the revenue dimension; this op handles the brand-building dimension.

Reads the content log from `~/Documents/aireadylife/vault/brand/00_current/` for the prior month to count posts published per platform. Compares to the user's configured cadence targets (e.g., 4 LinkedIn posts/month, 2 YouTube videos/month, 1 newsletter/week). Flags any cadence misses — a platform that published fewer posts than the minimum target for the month. A cadence miss on a primary platform is 🔴 if it is the second consecutive month of misses; 🟡 for a first miss.

Calls `aireadylife-brand-flow-build-analytics-summary` for cross-platform engagement metrics and top content identification. Surfaces the top 3 performing pieces by engagement and labels the topic area each belongs to — this reveals which content pillars are generating the most brand traction. Calculates MoM change in follower counts and engagement rate per platform.

Surfaces content gaps: any platform that had zero output in the prior month, and any topic area from the user's configured content pillars that had no coverage in the month. Topic area with above-average engagement is flagged as a "double down" opportunity — create more content in this area. Writes a dated brief to vault/brand/02_briefs/ and pushes cadence misses and engagement anomalies to open-loops.

## Triggers

- "content review"
- "brand performance"
- "how is my content doing"
- "publishing cadence check"
- "content output this month"
- "what performed best this month"

## Steps

1. Determine the review period: prior full calendar month
2. Read content log from vault/brand/00_current/ for the period; count posts per platform
3. Compare posts per platform to configured cadence targets in config.md; calculate cadence achievement % per platform
4. Flag platforms below minimum cadence target: 🔴 if second consecutive miss, 🟡 for first miss, 🟢 if within 10% of target
5. Flag any platform with zero output in the period as a "content gap" — 🔴 if primary platform, 🟡 if secondary
6. Call `aireadylife-brand-flow-build-analytics-summary` for cross-platform engagement metrics and top content
7. Calculate MoM follower growth and engagement rate trend per platform; surface notable changes (>10% shift)
8. Identify top 3 posts by engagement; map each to its content pillar from config.md
9. Calculate average engagement rate per content pillar; flag which pillars are above and below average
10. Identify any configured content pillar with zero posts this month (topic coverage gap)
11. Write content review brief to vault/brand/02_briefs/content-review-{YYYY-MM}.md
12. Call `aireadylife-brand-task-update-open-loops` with cadence misses, engagement anomalies, and topic gaps

## Input

- `~/Documents/aireadylife/vault/brand/00_current/` — content log for the period; each entry: platform, date, format, title, topic-pillar, engagement-metrics
- `~/Documents/aireadylife/vault/brand/00_current/` — monthly platform analytics
- `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/brand/config.md` — cadence targets per platform, content pillars list

## Output Format

```
# Content Review — {Month} {Year}

## Cadence Scorecard
| Platform   | Target/Month | Published | Achievement | Status |
|------------|--------------|-----------|-------------|--------|
| LinkedIn   | 4 posts      | 3 posts   | 75%         | 🟡     |
| YouTube    | 4 videos     | 5 videos  | 125%        | 🟢     |
| Newsletter | 4 issues     | 4 issues  | 100%        | 🟢     |
| Twitter/X  | 20 posts     | 0 posts   | 0%          | 🔴     |

## Top Performers
1. "[Post title]" — LinkedIn — 5,200 impressions, 4.1% engagement — Pillar: [AI Tools]
2. "[Post title]" — YouTube — 12,800 views — Pillar: [Personal Finance]
3. "[Post title]" — Newsletter — 38% open rate — Pillar: [Career]

## Pillar Performance
| Content Pillar   | Posts | Avg Engagement | vs Overall Avg |
|------------------|-------|----------------|----------------|
| AI Tools         | X     | 3.8%           | ▲ +1.2%       |
| Personal Finance | X     | 2.1%           | → -0.1%       |
| Career           | X     | 1.9%           | ▼ -0.3%       |

## Action Items
🔴 [Cadence miss / platform gap / urgent action]
🟡 [Watch item / opportunity]
```

## Configuration

Required in `~/Documents/aireadylife/vault/brand/config.md`:
- `posting_target_{platform}` — monthly post target per platform (e.g., posting_target_linkedin: 4)
- `content_pillars` — list of 3-5 topic areas (e.g., ["AI Tools", "Personal Finance", "Career"])
- `platforms_primary` — which platforms get 🔴 escalation for cadence misses vs 🟡

## Error Handling

- If content log is empty for the period: "No content logged for {month}. Add entries to vault/brand/00_current/ to enable cadence tracking."
- If cadence targets are not configured: perform the review without cadence comparison and note "Set posting targets in config.md to enable cadence tracking."
- If a post in the content log references an unknown content pillar: include it in analytics but flag "unclassified post — assign to a content pillar in the log."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/config.md`
- Writes to: `~/Documents/aireadylife/vault/brand/02_briefs/content-review-{YYYY-MM}.md`, `~/Documents/aireadylife/vault/brand/open-loops.md`
