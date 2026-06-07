---
name: aireadylife-vision-flow-build-scorecard
type: flow
trigger: called-by-op
description: >
  Assembles a domain-by-domain life scorecard with score (1-10), trend indicator,
  open loop count, and 1-line status per installed plugin. Scores are derived from
  open loop velocity and milestone activity.
---

# aireadylife-vision-build-scorecard

**Trigger:** Called by `aireadylife-vision-op-monthly-scorecard`, `aireadylife-vision-op-review-brief`
**Produces:** Structured scorecard data with per-domain scores, trend indicators, and status notes returned to calling op

## What It Does

This flow is the scoring engine for the monthly life scorecard. It collects data from across all installed plugin vaults and computes a 1-10 score for each of the 13 life domains using a three-factor weighted formula.

**Factor 1 — Resolution Ratio (50% weight):** For each domain, the flow reads vault/{domain}/open-loops.md and counts two things: items that were added this month (new items flagged since the first day of the current month) and items that were resolved this month (items marked complete with `- [x]` since the first day of the current month). The resolution ratio is resolved / (resolved + added). A domain that resolved 4 items and added 2 this month has a ratio of 4/6 = 0.67. A domain that added 6 items and resolved 0 has a ratio of 0/6 = 0. The ratio is scaled 0-10 for the scoring formula: ratio of 1.0 (all resolved, nothing added) → 10 points; ratio of 0 (nothing resolved, items accumulating) → 0 points. A domain with no open-loops.md or with no activity this month receives a neutral score of 5 on this factor.

**Factor 2 — OKR Pace (30% weight):** The flow reads vault/vision/00_current/ for the current quarter's Key Results that map to each domain. For quantitative KRs, it reads the relevant domain vault for the current metric value and calculates percentage of target achieved. For qualitative KRs, it looks for completion evidence. The expected completion percentage is calculated as: (days elapsed in quarter / total days in quarter) × 100. If the actual percentage is within 10 points of expected, the domain scores full OKR pace points. If the actual is 11-20 points behind expected, it scores partial OKR pace points. If 21+ points behind, it scores 0 OKR pace points. Domains with no OKRs this quarter receive the median score on this factor (5 points).

**Factor 3 — Milestone Count (20% weight):** The flow reads vault/vision/00_current/milestones.md and counts milestones logged this month with a domain tag matching the current domain. Zero milestones = 0 points on this factor. One milestone = 7 points. Two milestones = 9 points. Three or more milestones = 10 points.

**Score assembly:** The three factor scores are combined: (Factor1 × 0.5) + (Factor2 × 0.3) + (Factor3 × 0.2). The result is the raw 1-10 domain score for the month.

**Trend calculation:** The flow reads the prior month's scorecard from vault/vision/00_current/ and compares scores domain by domain. If the score improved by 1.0 or more points: trend = ↑. If the score declined by 1.0 or more points: trend = ↓. Within 1.0 points: trend = →.

**Status note generation:** Each domain receives a 1-line plain-language status note generated from the underlying data. The note explains the score rather than restating it: "Resolved 3/5 items; career OKR at 45% (expected 60%)" rather than "Score: 6.1."

## Steps

1. Receive list of 13 domains and which are active/installed from calling op
2. For each domain: read vault/{domain}/open-loops.md; count items added and resolved this month
3. Calculate resolution ratio; scale to 0-10 factor score
4. For each domain: read vault/vision/00_current/ for domain-mapped KRs; calculate OKR pace percentage
5. Calculate expected OKR pace; compare to actual; assign OKR pace factor score
6. Read vault/vision/00_current/milestones.md; count this-month milestones per domain
7. Assign milestone factor score based on count (0=0, 1=7, 2=9, 3+=10)
8. Compute domain score: (F1 × 0.5) + (F2 × 0.3) + (F3 × 0.2)
9. Read prior month scorecard from vault/vision/00_current/ for trend calculation
10. Assign trend indicator (↑/→/↓) per domain
11. Generate 1-line status note per domain
12. Return full scorecard data structure to calling op

## Input

- ~/Documents/aireadylife/vault/*/open-loops.md (all installed plugins)
- ~/Documents/aireadylife/vault/vision/00_current/ (current quarter OKRs)
- ~/Documents/aireadylife/vault/vision/00_current/milestones.md
- ~/Documents/aireadylife/vault/vision/00_current/ (prior month scorecard for trend)
- `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records for trend comparison

## Output Format

Returns structured data to calling op:
```
[
  { domain: "health", score: 7.2, trend: "↑", status: "Healthy — resolved 3/4 items; OKR on pace (72%)", resolution_ratio: 0.75, okr_pace: 0.72, milestone_count: 1 },
  { domain: "wealth", score: 8.5, trend: "↑", status: "Momentum — savings milestone hit; OKR ahead of pace", resolution_ratio: 0.9, okr_pace: 0.85, milestone_count: 2 },
  ...
]
```

## Configuration

Optional in vault/vision/config.md:
- `scoring_weights` — override default 50/30/20 distribution
- `domain_okr_map` — explicit mapping of OKR names to domains (if OKR naming doesn't match domain names)

## Error Handling

- **Domain plugin not installed:** Score using vision-owned data only (OKRs and milestones); set resolution ratio factor to 5 (neutral) with note "Domain plugin not installed."
- **No prior month scorecard:** Return scores without trend indicators; note "Trend available after second monthly run."
- **open-loops.md has no date information:** Cannot calculate monthly adds/resolves; set resolution factor to 5 (neutral); note "Add timestamps to open-loops.md items for resolution ratio calculation."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/*/open-loops.md, ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/milestones.md, ~/Documents/aireadylife/vault/vision/00_current/
- Writes to: none (returns data to calling op)
