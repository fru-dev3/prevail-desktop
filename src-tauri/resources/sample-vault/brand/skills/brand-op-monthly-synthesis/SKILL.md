---
name: aireadylife-brand-op-monthly-synthesis
type: op
cadence: monthly
description: >
  Monthly brand synthesis. Aggregates cross-platform analytics into a unified brand health score.
  Triggers: "brand synthesis", "brand score", "monthly brand report", "brand analytics summary".
---

## What It Does

Runs at the end of each month to produce a complete brand health assessment across all configured platforms. This is the deepest monthly brand review — it goes beyond individual platform metrics to produce a unified brand health score (0-100) that tells the user, in a single number with supporting detail, whether their personal brand is gaining strength or losing ground.

Calls `aireadylife-brand-flow-build-analytics-summary` to compile cross-platform metrics with MoM comparisons. Calls `aireadylife-brand-flow-analyze-mentions` to assess sentiment distribution and identify notable mentions. Evaluates four scoring dimensions and combines them into the 0-100 health score.

Scoring rubric (25 points each): Profile consistency (0-25): full 25 if all profiles match master and consistency score is 100%; proportional deduction — each 🔴 inconsistency costs 10 points, each 🟡 costs 3 points. Content cadence (0-25): full 25 if all primary platforms are within 10% of their set posting targets this month; 2 points deducted per cadence miss per platform; 0 for any platform with zero content in 30 days. Follower growth (0-25): full 25 if at least 2 primary platforms show positive MoM growth; 15 if 1 platform growing; 5 if all flat; 0 if any primary platform is declining. Mention sentiment (0-25): full 25 if >80% positive; 18 for 61-80%; 10 for 40-60%; 0 for <40% positive.

Tracks the health score trend: current month vs. prior 3 months average. A score above 75 is healthy. 50-74 is watch territory. Below 50 is at risk and requires a specific intervention plan. Writes the complete synthesis to vault/brand/00_current/synthesis-{YYYY-MM}.md and updates open-loops.

## Triggers

- "brand synthesis"
- "brand health score"
- "monthly brand report"
- "brand analytics summary"
- "how is my brand doing"
- "brand score this month"
- "end of month brand review"

## Steps

1. Confirm vault/brand/ is set up with analytics and config.md; if missing data, list what is needed
2. Call `aireadylife-brand-flow-build-analytics-summary` for cross-platform metrics and top content
3. Call `aireadylife-brand-flow-analyze-mentions` for sentiment distribution and notable mentions
4. Call `aireadylife-brand-flow-check-profile-consistency` (lightweight — for consistency score component only)
5. Evaluate cadence performance: compare posts published per platform this month vs. configured targets in config.md; calculate cadence score component (0-25)
6. Evaluate follower growth: count platforms with positive MoM growth; calculate growth score component (0-25)
7. Evaluate mention sentiment: use distribution from analyze-mentions flow; calculate sentiment score component (0-25)
8. Calculate combined brand health score (0-100) from the four components
9. Load prior month score from vault/brand/00_current/synthesis-{prior YYYY-MM}.md for trend line
10. Identify the single most impactful action to improve the brand health score next month
11. Write synthesis to vault/brand/00_current/synthesis-{YYYY-MM}.md
12. Call `aireadylife-brand-task-update-open-loops` with all flags from this synthesis

## Input

- `~/Documents/aireadylife/vault/brand/00_current/` — current and prior month platform analytics
- `~/Documents/aireadylife/vault/brand/00_current/` — mention log for the period
- `~/Documents/aireadylife/vault/brand/00_current/` — profile snapshots and master profile
- `~/Documents/aireadylife/vault/brand/00_current/` — content log for cadence evaluation
- `~/Documents/aireadylife/vault/brand/config.md` — platforms, posting targets, scoring weights
- `~/Documents/aireadylife/vault/brand/00_current/synthesis-{prior YYYY-MM}.md` — prior month score for trend
- `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records for trend comparison

## Output Format

```
# Brand Health Synthesis — {Month} {Year}

## Brand Health Score: {XX}/100 (▲/▼ {X} pts vs last month)

| Dimension          | Score | Max | Notes                                      |
|--------------------|-------|-----|--------------------------------------------|
| Profile Consistency| XX    | 25  | {X} inconsistencies found                  |
| Content Cadence    | XX    | 25  | LinkedIn: on track; YouTube: 1 miss        |
| Follower Growth    | XX    | 25  | 2 of 3 primary platforms growing           |
| Mention Sentiment  | XX    | 25  | 74% positive, 20% neutral, 6% negative     |

## Analytics Snapshot
[Cross-platform table from build-analytics-summary flow]

## Top Content — {Month}
[Top 3 posts from analytics summary]

## Mentions
[Summary from analyze-mentions flow]

## Score Trend
{Month-3}: {XX} → {Month-2}: {XX} → {Month-1}: {XX} → {Month}: {XX}

## Priority Action for Next Month
[Single most impactful action to improve health score]
```

## Configuration

Required in `~/Documents/aireadylife/vault/brand/config.md`:
- `platforms_primary` — list of primary platforms (used for growth and cadence weighting)
- `posting_target_{platform}` — posts per month target per platform
- `scoring_weights` — optional override of the 25/25/25/25 distribution

## Error Handling

- If analytics data is missing for more than 2 platforms: "Insufficient data for a complete health score — only {X} of {Y} platforms have analytics data. Score calculated from available data only."
- If no mention data exists for the period: sentiment score defaults to 25 (neutral assumption) with note "No mention data — sentiment score set to neutral."
- If prior month synthesis file is missing: calculate score for current month without trend line; note "No prior month data — trend tracking begins next month."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/config.md`
- Writes to: `~/Documents/aireadylife/vault/brand/00_current/synthesis-{YYYY-MM}.md`, `~/Documents/aireadylife/vault/brand/open-loops.md`
