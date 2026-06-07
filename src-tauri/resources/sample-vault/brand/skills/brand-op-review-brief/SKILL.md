---
name: aireadylife-brand-op-review-brief
type: op
cadence: monthly
description: >
  Monthly brand brief. Pulls consistency score, mention summary, analytics highlights, and reputation flags.
  Triggers: "brand brief", "brand summary", "how is my brand doing", "brand health", "brand check".
---

## What It Does

Produces the concise monthly brand status brief — the 90-second version of the monthly brand picture. Reads the most recent brand health synthesis from vault/brand/00_current/ for the health score and key metrics. If the synthesis has not been run this month, calls the monthly synthesis op first. Pulls the current mention summary from vault/brand/00_current/. Reads vault/brand/open-loops.md for all unresolved brand action items.

Synthesizes into a brief with: brand health score with direction (up/down), platform-by-platform one-line status, top mention from the period, consistency score, publishing cadence status, and a prioritized action list of no more than 5 items. The user should be able to read the brief in under 2 minutes and know exactly what their brand looks like right now and what to do about it.

## Triggers

- "brand brief"
- "brand summary"
- "how is my brand doing"
- "brand health"
- "brand check"
- "brand status"
- "monthly brand update"

## Steps

1. Check vault/brand/ exists; if missing, direct to setup
2. Locate most recent brand synthesis in vault/brand/00_current/synthesis-{YYYY-MM}.md; if current month not found, call `aireadylife-brand-op-monthly-synthesis` first
3. Extract health score, component scores, and top content from synthesis
4. Read vault/brand/00_current/ for most notable mention of the period (highest-priority mention in terms of source credibility or sentiment)
5. Read vault/brand/open-loops.md; count 🔴 and 🟡 items; extract top 3 by priority
6. Assess overall brand status: Healthy (score 75+, no 🔴 flags), Watch (score 50-74 or 1-2 🟡 flags), At Risk (score <50 or any 🔴 flag)
7. Format brief with score, per-platform status table, mentions summary, and action list
8. Present to user; offer to drill into any section

## Input

- `~/Documents/aireadylife/vault/brand/00_current/synthesis-{YYYY-MM}.md` — current month synthesis
- `~/Documents/aireadylife/vault/brand/00_current/` — mention records for notable mention
- `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/brand/open-loops.md` — current brand action items
- `~/Documents/aireadylife/vault/brand/config.md` — platform list, thresholds

## Output Format

```
# Brand Brief — {Month} {Year}

**Health Score:** {XX}/100 ▲/▼ {X} pts | **Status:** [Healthy / Watch / At Risk]

## Platform Status
| Platform   | Followers | MoM    | Engagement | Cadence  |
|------------|-----------|--------|------------|----------|
| LinkedIn   | X,XXX     | ▲ +X%  | 3.2%       | On track |
| Twitter/X  | X,XXX     | → 0%   | 0.8%       | 🔴 Gap   |
| YouTube    | X,XXX     | ▲ +X%  | —          | On track |

## Consistency: XX% | Mentions: {X} total, {X}% positive

## Notable This Month
[Single most notable mention or content win]

## Action Items
🔴 [Urgent action]
🟡 [Watch item]
🟢 [Info]
```

## Configuration

Same as brand-op-monthly-synthesis. No additional configuration required.

## Error Handling

- If no synthesis exists for current or prior month: "No brand health data found. Run 'brand synthesis' first."
- If vault is in demo mode: prefix all figures with "[DEMO]" and note sample data.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/open-loops.md`, `~/Documents/aireadylife/vault/brand/config.md`
- Writes to: `~/Documents/aireadylife/vault/brand/02_briefs/brief-{YYYY-MM}.md` (if saving)
