---
name: aireadylife-vision-op-monthly-scorecard
type: op
cadence: monthly
description: >
  Monthly life scorecard; scores each active life domain (1-10) based on open loops
  resolved, goals on pace, and positive milestones. Produces a trend view showing
  which domains are improving, stalling, or declining.
  Triggers: "life scorecard", "monthly scorecard", "how am I doing", "life review".
---

# aireadylife-vision-monthly-scorecard

**Cadence:** Monthly (last day of month or first of new month)
**Produces:** Monthly scorecard at ~/Documents/aireadylife/vault/vision/00_current/YYYY-MM-scorecard.md

## What It Does

The monthly scorecard is the most important recurring output in the vision plugin — the single-page life dashboard that tells, at a glance, where momentum is building, where domains are drifting, and where intentional effort is needed next month. It is designed to be reviewed in under 10 minutes and to produce at most 2-3 action decisions.

The op calls `vision-flow-build-scorecard` to assemble per-domain data from across all installed plugins. For each of the 13 life domains, the scorecard flow reads three data sources: (1) vault/{domain}/open-loops.md to count items added this month vs. resolved this month — the resolution ratio; (2) vault/vision/00_current/ for the current quarter's key result progress percentages; (3) vault/vision/00_current/milestones.md for any milestones logged this month attributed to each domain. These three inputs feed the weighted scoring formula: resolution ratio 50%, OKR pace 30%, milestones 20%.

The op then calls `vision-flow-score-domain-progress` to get a current-quarter OKR evaluation. Key results that are more than 20 percentage points behind expected completion pace are flagged as at-risk. KRs with less than 2 weeks remaining in the quarter and less than 50% complete are flagged as critical-at-risk and surface prominently in the scorecard's action section.

**Score interpretation:** Scores 8-10 indicate strong momentum — the domain is resolving more than it's accumulating, OKRs are on pace, and positive milestones are accumulating. Scores 5-7 indicate stable but not growing — the domain is maintaining but not advancing. Scores below 5 indicate the domain needs attention — either significant items are accumulating without resolution, OKRs are behind pace, or the domain has been neglected. Scores below 5 for 2+ consecutive months trigger a 🔴 escalation flag in vault/vision/open-loops.md and an explicit recommendation in the scorecard's action section.

After building the scorecard, the op calls `vision-task-flag-stalled-goal` for any goals in vault/vision/00_current/ that have had no activity for more than 42 days. Stalled goals appear in the scorecard's "Needs Decision" section rather than being silently dropped or passively tracked.

## Triggers

- "life scorecard"
- "monthly scorecard"
- "how am I doing"
- "life review"
- "domain scores"
- "life check-in"
- "score my month"

## Steps

1. Verify vault/vision/ exists and config.md is filled in; if missing, stop and prompt setup
2. Determine which of the 13 domains have relevant data in installed plugin vaults
3. Call `vision-flow-build-scorecard` to compute per-domain scores from open-loops, OKR pace, milestones
4. Call `vision-flow-score-domain-progress` to evaluate current-quarter OKR key results
5. Identify at-risk KRs (>20 points behind pace) and critical-at-risk KRs (<50% with <2 weeks remaining)
6. Compare current-month scores to prior month (from vault/vision/00_current/) to assign trend indicators (↑/→/↓)
7. Flag domains below 5 as "needs attention"; flag domains 8+ as "momentum"
8. Check vault/vision/00_current/ for goals with no activity in 42+ days; call `vision-task-flag-stalled-goal` for each
9. Write scorecard to vault/vision/00_current/YYYY-MM-scorecard.md
10. Call `vision-task-update-open-loops` to write any 🔴 domain or KR flags to vault/vision/open-loops.md
11. Return formatted scorecard to user

## Input

- ~/Documents/aireadylife/vault/*/open-loops.md (all installed plugins, for resolution ratio)
- ~/Documents/aireadylife/vault/vision/00_current/ (current OKRs, for KR pace)
- ~/Documents/aireadylife/vault/vision/00_current/milestones.md (milestone log, for positive signal)
- ~/Documents/aireadylife/vault/vision/00_current/ (prior month scorecard, for trend)
- ~/Documents/aireadylife/vault/vision/00_current/ (goal list, for stall check)
- `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/vision/config.md

## Output Format

```
# Life Scorecard — [Month YYYY]

## 13-Domain Scores
| Domain          | Score | Trend | Status          | Notes                                  |
|-----------------|-------|-------|-----------------|----------------------------------------|
| Health          | 7.2   | ↑     | Stable          | Resolved 3/4 items; missed gym goal    |
| Wealth          | 8.5   | ↑     | Momentum        | Hit savings milestone; on OKR pace     |
| Career          | 6.1   | →     | Stable          | No new milestones; 2 open loops stable |
| Relationships   | 4.8   | ↓     | Needs Attention | 0 items resolved; no social logs       |
| Learning        | 5.3   | ↑     | Stable          | Completed 1 course module              |
| Creativity      | 3.2   | ↓     | Needs Attention | No creative output logged this month   |
| Home            | 7.0   | →     | Stable          |                                        |
| Family          | 6.5   | →     | Stable          |                                        |
| Fun             | 5.0   | ↓     | Stable          | Below average; planned trips pending   |
| Community       | 4.0   | →     | Needs Attention |                                        |
| Spirituality    | 6.0   | →     | Stable          |                                        |
| Finance         | 7.8   | ↑     | Stable          | Budget on track; no overruns           |
| Personal Growth | 5.5   | ↑     | Stable          |                                        |

**Overall life score: 5.9/10 — Stable**

## At-Risk OKRs
| KR Description                    | Progress | Expected | Gap   | Status          |
|-----------------------------------|----------|----------|-------|-----------------|
| Reach $50k liquid savings by Jun 30| 38%     | 55%      | -17%  | ⚠️ At-risk       |

## Needs Decision (Stalled Goals)
- **[Goal name]** — [Domain] — Last activity: [N] days ago
  Options: Recommit | Modify | Drop

## Action This Month
1. [Domain scoring <5]: Run [domain]-op-review-brief to identify top resolution opportunities
2. [At-risk KR]: [Specific action to close gap]
```

## Configuration

Required in vault/vision/config.md:
- `domain_baselines` — starting scores for trend calculation on first run
- `active_domains` — which of the 13 domains to score (default: all 13)
- `scoring_weights` — optional: override default resolution/OKR/milestone weights

## Error Handling

- **No prior month scorecard (first run):** Cannot calculate trends — show scores without trend indicators; note "Trend available after second monthly scorecard run."
- **Domain plugin not installed:** Score based on vault/vision/00_current/ milestones and open loops data only; OKR pace calculation may be incomplete — note in scorecard.
- **No OKRs for current quarter:** Score using resolution ratio and milestones only; note OKR pace weight is redistributed to resolution ratio.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/*/open-loops.md, ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/
- Writes to: ~/Documents/aireadylife/vault/vision/00_current/YYYY-MM-scorecard.md, ~/Documents/aireadylife/vault/vision/open-loops.md
