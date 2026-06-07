---
name: aireadylife-vision-op-review-brief
type: op
cadence: monthly
description: >
  Monthly vision review brief. Compiles 13-domain life scorecard, top 3 at-risk goals,
  and alignment flags into a single strategic briefing.
  Triggers: "vision brief", "life scorecard", "goal review", "how am I doing", "life check-in".
---

# aireadylife-vision-review-brief

**Cadence:** Monthly (1st of month)
**Produces:** Vision brief at ~/Documents/aireadylife/vault/vision/02_briefs/YYYY-MM-vision-brief.md

## What It Does

The vision review brief is the monthly strategic summary — a single document that answers three questions: How is life going across all domains? Which goals are at risk of failing this quarter? Is how I'm spending my time actually pointed toward what I say matters most?

The brief is designed to be read in under 5 minutes and to produce no more than 3 concrete action decisions. It is not a comprehensive review — it is an executive summary that surfaces only the most important signals and the specific actions they imply.

**Scorecard summary:** The brief includes the most recent monthly scorecard from vault/vision/00_current/ or runs `vision-flow-build-scorecard` if no current-month scorecard exists yet. The scorecard is presented as the full 13-domain table with scores, trend indicators, and status notes. Below the table, the brief highlights the 2 highest-momentum domains (positive reinforcement signal) and the 2 lowest-scoring domains (highest intervention priority).

**At-risk OKR summary:** The brief calls `vision-flow-score-domain-progress` to identify any key results that are critically at-risk (less than 50% with less than 2 weeks remaining) or significantly behind pace (more than 20 points behind expected completion based on days elapsed in the quarter). The top 3 at-risk KRs are surfaced with: the KR description, the current completion percentage, the expected completion percentage, the gap, and a brief diagnosis of the primary reason for the gap.

**Calendar alignment check:** If the calendar plugin is installed, the brief checks whether the user's top quarterly OKR domains have corresponding focus blocks in vault/calendar/00_current/ from the past 4 weeks. A domain that is in the top-3 OKR priority but has had zero focus blocks allocated in the past 4 weeks receives an alignment flag: "Career OKR is Q2 Priority 1 — but 0 of the last 4 weekly agendas included a career-focused deep work block. Intention vs. attention gap detected."

**Action items:** The brief closes with a list of at most 3 action items derived from the signals above — not generic advice, but specific actions with owners and target dates.

## Triggers

- "vision brief"
- "life scorecard"
- "goal review"
- "how am I doing"
- "life check-in"
- "monthly vision review"
- "OKR check-in"

## Steps

1. Verify vault/vision/ exists and config.md is filled in
2. Read most recent monthly scorecard from vault/vision/00_current/ (within past 35 days)
3. If no recent scorecard: call `vision-flow-build-scorecard` to generate one now
4. Identify 2 highest-momentum domains (8+ score or largest positive trend) and 2 lowest (below 5 or largest negative trend)
5. Call `vision-flow-score-domain-progress` to evaluate current-quarter OKR key results
6. Identify top 3 at-risk or critical-at-risk KRs with diagnosis
7. If calendar plugin installed: read vault/calendar/00_current/ for past 4 weeks; check focus block allocation per OKR domain
8. Flag any OKR priority domain with 0 focus blocks in past 4 weeks as "intention vs. attention gap"
9. Generate 3 specific action items from above signals
10. Assemble brief in standard format
11. Write to vault/vision/02_briefs/YYYY-MM-vision-brief.md
12. Return formatted brief to user

## Input

- ~/Documents/aireadylife/vault/vision/00_current/ (most recent monthly scorecard)
- ~/Documents/aireadylife/vault/vision/00_current/ (current quarter OKRs)
- ~/Documents/aireadylife/vault/calendar/00_current/ (if calendar plugin installed, for alignment check)
- `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/*/open-loops.md (for on-demand scorecard if needed)
- ~/Documents/aireadylife/vault/vision/config.md

## Output Format

```
# Vision Brief — [Month YYYY]

## Life Scorecard (Summary)
| Domain       | Score | Trend | Status          |
|--------------|-------|-------|-----------------|
[full 13-domain table]

**Momentum domains:** [Domain] ([score] ↑), [Domain] ([score] ↑)
**Needs attention:** [Domain] ([score] ↓), [Domain] ([score] ↓)
**Overall life score: [N]/10 — [Trend]**

## At-Risk OKRs
| KR                                   | Progress | Expected | Gap   | Diagnosis                    |
|--------------------------------------|----------|----------|-------|------------------------------|
| [KR description]                     | 32%      | 60%      | -28%  | [Specific diagnosis]         |

## Intention vs. Attention Check
- ✅ [Domain]: [N] focus blocks in past 4 weeks — aligned with OKR priority
- ⚠️ [Domain]: 0 focus blocks in past 4 weeks — OKR Priority [N] but no allocated time found

## Action This Month
1. [Specific action — domain — target date]
2. [Specific action — domain — target date]
3. [Specific action — domain — target date]
```

## Configuration

Required in vault/vision/config.md:
- Current quarter OKRs must be set
- Calendar plugin recommended for alignment check

## Error Handling

- **No current-month scorecard and no prior scorecard:** Generate scorecard on-demand via vision-flow-build-scorecard; note "Scorecard generated on-demand — run vision-op-monthly-scorecard at month end for the full report."
- **No OKRs for current quarter:** Skip at-risk OKR section; note "No OKRs set for this quarter — run vision-op-quarterly-planning to set goals."
- **Calendar plugin not installed:** Skip alignment check section; note "Install calendar plugin to enable focus time alignment analysis."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/calendar/00_current/, ~/Documents/aireadylife/vault/*/open-loops.md
- Writes to: ~/Documents/aireadylife/vault/vision/02_briefs/YYYY-MM-vision-brief.md
