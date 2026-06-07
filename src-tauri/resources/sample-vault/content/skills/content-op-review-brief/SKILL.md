---
name: aireadylife-content-op-review-brief
type: op
cadence: monthly
description: >
  Monthly content review brief. Compiles channel analytics, revenue across all platforms,
  newsletter metrics, publishing schedule health, and SEO flags into a single briefing doc.
  Triggers: "content brief", "content review", "monthly content summary", "how is my content".
---

## What It Does

Produces the concise monthly content status brief — the document the user reads to get the full content business picture in under 2 minutes. Reads from vault/content/ to compile: YouTube channel metrics (views, watch time, CTR, subscriber delta), total revenue across all platforms (AdSense, Gumroad, sponsorships with MoM direction), newsletter health (subscribers, open rate, CTR), publishing schedule status (videos and issues published vs target), and top SEO or optimization opportunities from the monthly SEO review.

If the monthly channel review, revenue review, or SEO review have not yet been run for the current month, calls them before compiling the brief so the data is current. Formats everything as a scannable brief with a business health status header, a metrics table, and a prioritized ACTION ITEMS section sorted by urgency. The action items pull from vault/content/open-loops.md — not a new analysis, but a distillation of the open flags into the most important 3-5 things to do this month.

## Triggers

- "content brief"
- "content review"
- "monthly content summary"
- "how is my content"
- "content status"
- "creator brief"

## Steps

1. Check vault/content/ exists and config.md is configured
2. Check for current month channel review in vault/content/00_current/channel-review-{YYYY-MM}.md; if missing, call `aireadylife-content-op-channel-review`
3. Check for current month revenue review in vault/content/00_current/revenue-{YYYY-MM}.md; if missing, call `aireadylife-content-op-revenue-review`
4. Check for current month SEO review in vault/content/00_current/seo-review-{YYYY-MM}.md; if missing, call `aireadylife-content-op-seo-review`
5. Extract key figures from each: total revenue + MoM, total views + trend, newsletter subscribers + open rate, publishing status, top SEO opportunity
6. Read vault/content/open-loops.md; extract top 5 open items by priority
7. Assess overall content business status: Growing (revenue up, at least 1 channel above baseline), Stable (flat metrics, on-cadence publishing), At Risk (revenue decline >20%, publishing gap, underperforming channels)
8. Format brief with status header, metrics table, and action list
9. Present to user; offer to drill into any section

## Input

- `~/Documents/aireadylife/vault/content/00_current/channel-review-{YYYY-MM}.md`
- `~/Documents/aireadylife/vault/content/00_current/revenue-{YYYY-MM}.md`
- `~/Documents/aireadylife/vault/content/00_current/seo-review-{YYYY-MM}.md`
- `~/Documents/aireadylife/vault/content/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/content/open-loops.md`
- `~/Documents/aireadylife/vault/content/config.md`

## Output Format

```
# Content Brief — {Month} {Year}

**Status:** [Growing / Stable / At Risk]
**Total Revenue:** $X,XXX | MoM: ▲/▼ ±X% | YTD: $XX,XXX

## Quick Metrics
| Platform    | Key Metric         | This Month | MoM    | Status   |
|-------------|--------------------|------------|--------|----------|
| YouTube     | Views              | XX,XXX     | ▲ +X%  | ✓        |
|             | CTR                | X.X%       | →      | ✓ (4-10%)|
|             | Subscribers +/-    | +XXX       | ▼ -X%  | ⚠        |
| Newsletter  | Open Rate          | XX%        | →      | ✓ (>30%) |
|             | Subscribers        | X,XXX      | ▲ +X%  | ✓        |
| Gumroad     | Revenue            | $XXX       | ▲ +X%  | ✓        |

## Publishing: YouTube X/X | Newsletter X/X | [other] X/X

## Top SEO Action
🎯 [Single most impactful SEO action from SEO review]

## Action Items
🔴 [Urgent action]
🟡 [Watch / opportunity]
🟢 [Info]
```

## Configuration

Same as constituent ops (channel review, revenue review, SEO review). No additional configuration required.

## Error Handling

- If none of the constituent review files exist: run all three monthly reviews first; may take a few minutes.
- If vault is in demo mode: prefix all figures with "[DEMO]."
- If config.md is missing: "Configure vault/content/config.md with your channel IDs and targets before running this brief."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/content/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/open-loops.md`, `~/Documents/aireadylife/vault/content/config.md`
- Writes to: `~/Documents/aireadylife/vault/content/02_briefs/{YYYY-MM}-content-brief.md`
