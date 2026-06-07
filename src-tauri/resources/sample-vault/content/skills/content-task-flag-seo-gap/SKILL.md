---
name: aireadylife-content-task-flag-seo-gap
type: task
description: >
  Writes a flag to vault/content/open-loops.md when a content piece drops in ranking
  or a high-value keyword has no content coverage. Includes keyword, current position,
  opportunity score, and recommended action.
---

## What It Does

Fires when the SEO analysis identifies a ranking drop or keyword coverage gap that meets the flagging threshold. For each flag, captures everything needed to act on the opportunity without having to re-run the SEO analysis: the specific keyword, current and prior positions (for drops), estimated search volume, competition level, an opportunity score, and the precise recommended action.

For ranking drops: writes a flag when a content piece falls more than 3 positions MoM. The flag includes the page URL, the keyword that dropped, prior position and current position, the estimated monthly traffic impact (click loss based on standard CTR by position: position 3 = ~12% CTR, position 7 = ~5% CTR, position 12 = ~2% CTR), and the recommended recovery action based on the most likely cause: content freshness decay → "update content with current information and refresh publication date"; competitive pressure → "expand the content to be more comprehensive than the top-ranking competitor"; technical issue → "check page speed and Core Web Vitals"; intent shift → "review the current SERP — if it's now commercial, pivot to a comparison or review format."

For keyword gaps: writes a flag when a high-value keyword (above configured volume threshold) has no existing content targeting it. The flag includes the keyword, estimated monthly search volume, competition level assessment (high/medium/low based on Domain Rating of ranking sites), and a recommended action: create a dedicated new post, expand an existing related post, or repurpose existing content from another platform.

Assigns an opportunity score (1-10) to prioritize when multiple gaps exist simultaneously. Score formula: (volume/1000 × 2) + (10 - competition_level×3) + (position_improvement_potential/5) — normalized to 1-10 scale. Higher score = higher priority. Before writing, checks for an existing unresolved flag for the same keyword or page URL to prevent duplicate accumulation across monthly cycles.

## Triggers

Called internally by `aireadylife-content-op-seo-review` and `aireadylife-content-flow-build-seo-summary`.

## Steps

1. Receive flag data from calling op: flag type (drop or gap), keyword, page URL (for drops), current position, prior position (for drops), search volume, competition level, recommended action
2. Calculate opportunity score using the scoring formula; normalize to 1-10 scale
3. For ranking drops: calculate estimated traffic impact = (prior CTR% - current CTR%) × search volume / 100
4. Read vault/content/open-loops.md; check for existing unresolved entry for the same keyword or page URL
5. If duplicate found: update the "last surfaced" date and update the position data; do not add a new entry
6. If no duplicate: write new flag entry with all data fields
7. Assign priority: opportunity score 8-10 = 🔴, 5-7 = 🟡, 1-4 = 🟢
8. Return confirmation to calling op

## Input

- Flag data from calling op (keyword, positions, volume, action)
- `~/Documents/aireadylife/vault/content/open-loops.md` — for duplicate check

## Output Format

Ranking drop flag written to `vault/content/open-loops.md`:
```
{Priority} SEO DROP — "{keyword}" | {Page URL}
Position: {X} → {Y} (dropped {Z} positions) | Volume: {X,XXX}/mo
Traffic impact: ~-{X,XXX} clicks/mo
Recommended: {specific action}
Opportunity score: {X}/10
Source: content-op-seo-review | Raised: {date}
```

Keyword gap flag:
```
{Priority} SEO GAP — "{keyword}" | No existing content
Volume: {X,XXX}/mo | Competition: {High/Medium/Low}
Recommended: {create new post / expand [page URL] / repurpose existing content}
Opportunity score: {X}/10
Source: content-op-seo-review | Raised: {date}
```

## Configuration

Required in `~/Documents/aireadylife/vault/content/config.md`:
- `seo_volume_threshold` — minimum volume to flag a gap (default: 500)
- `seo_drop_threshold_positions` — minimum position drop to flag (default: 3)

## Error Handling

- If opportunity score formula inputs are incomplete (volume unknown): set score to "unscored" and include in 🟡 tier.
- If vault/content/open-loops.md does not exist: create it before writing the first entry.
- If called with an empty flag list: return "No SEO gaps to flag this cycle."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/content/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/content/open-loops.md`
