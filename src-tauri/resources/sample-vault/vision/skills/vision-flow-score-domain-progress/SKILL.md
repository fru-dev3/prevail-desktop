---
name: aireadylife-vision-flow-score-domain-progress
type: flow
trigger: called-by-op
description: >
  Evaluates progress toward quarterly OKRs across all domains; calculates percent
  complete per key result and flags OKRs at less than 50% with less than 2 weeks
  remaining in the quarter.
---

# aireadylife-vision-score-domain-progress

**Trigger:** Called by `aireadylife-vision-op-quarterly-planning`, `aireadylife-vision-op-monthly-scorecard`, `aireadylife-vision-op-annual-review`, `aireadylife-vision-op-review-brief`
**Produces:** Per-OKR progress report with completion percentages, pace ratings, and at-risk flags returned to calling op

## What It Does

This flow reads all active OKRs from vault/vision/00_current/ and evaluates how much progress has been made on each key result. It is the measurement engine — it reads the relevant domain vault for current metric values and checks for completion evidence.

**Quantitative KR evaluation:** For KRs with a numeric target (e.g., "Reach $50,000 liquid savings by June 30," "Publish 12 YouTube videos by March 31," "Reduce monthly expenses below $3,000"), the flow reads the relevant domain vault for the current value of that metric. It looks in the domain-specific vault files where that metric is maintained (vault/wealth/ for financial metrics, vault/content/ for content metrics, vault/benefits/ for HSA/401k balances). If the metric is not found in a standard location, it checks vault/vision/00_current/ for any manually logged progress updates. The completion percentage is calculated as (current value / target value) × 100.

**Qualitative KR evaluation:** For KRs with a qualitative completion condition (e.g., "Complete estate planning documents," "Have a financial advisor in place," "Establish consistent morning routine"), the flow looks for completion evidence in three places: (1) vault/vision/00_current/milestones.md for a logged milestone matching the KR description, (2) the relevant domain vault for a document, log entry, or state update indicating the work was done, (3) vault/*/open-loops.md for the original open loop that corresponded to this KR, marked as completed. If any evidence is found, the KR is scored as complete (100%). If no evidence is found, it is scored as 0%.

**Pace calculation:** The expected completion percentage is calculated as (days elapsed in quarter / total days in quarter) × 100. A quarter with 90 total days that is currently at day 63 has an expected completion pace of 70%. Any KR more than 20 percentage points behind expected pace is flagged as at-risk. Any KR with less than 14 days remaining in the quarter and less than 50% complete is flagged as critical-at-risk regardless of pace.

**Diagnosis generation:** For each at-risk KR, the flow generates a brief plain-language diagnosis. Possible diagnoses: "Target appears unrealistic given actual capacity — consider modifying the target," "Work on this KR was deprioritized in favor of [pattern from open-loops]," "Blocking issue: [specific item that has been preventing progress if identifiable from open-loops]," "No progress activity logged — may have been forgotten rather than deprioritized."

## Steps

1. Read all active OKR files from vault/vision/00_current/ (current quarter)
2. For each Key Result: determine if quantitative or qualitative
3. For quantitative KRs: identify the domain vault source for the metric; read current value; calculate % complete
4. For qualitative KRs: search vault/vision/00_current/milestones.md, domain vaults, and open-loops.md for completion evidence; assign 100% or 0%
5. Calculate expected completion % based on days elapsed in quarter
6. Flag KRs >20 points behind expected pace as at-risk (⚠️)
7. Flag KRs with <14 days remaining and <50% complete as critical-at-risk (🔴)
8. Generate diagnosis note for each flagged KR
9. Compute Objective-level completion rate (average of its KR completion percentages)
10. Return full progress report to calling op

## Input

- ~/Documents/aireadylife/vault/vision/00_current/ (current quarter OKR files)
- ~/Documents/aireadylife/vault/vision/00_current/milestones.md (qualitative KR evidence)
- `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/*/open-loops.md (completion evidence and blocking items)
- Domain-specific vault files (wealth, content, benefits, etc.) for quantitative KR metrics

## Output Format

Returns structured data to calling op:
```
[
  {
    objective: "Build the financial foundation for the first rental property",
    objective_completion: 55,
    key_results: [
      { kr: "Reach $50,000 liquid savings by June 30", actual_pct: 76, expected_pct: 67, status: "on_pace", diagnosis: null },
      { kr: "Research 3 target markets and document findings", actual_pct: 0, expected_pct: 67, status: "critical_at_risk", diagnosis: "No progress activity logged — may have been deprioritized" },
      { kr: "Have a financial advisor relationship in place", actual_pct: 100, expected_pct: 67, status: "achieved", diagnosis: null }
    ]
  },
  ...
]
```

## Configuration

Optional in vault/vision/config.md:
- `domain_metric_map` — explicit mapping of KR targets to vault file paths for metric lookup
- `critical_at_risk_threshold_days` — default 14; number of days remaining below which <50% = critical

## Error Handling

- **No active OKRs found:** Return empty list with note "No OKRs found for current quarter. Run vision-op-quarterly-planning to set goals."
- **Metric not found for quantitative KR:** Score as 0% with note "Metric not found — log progress in vault/vision/00_current/ manually."
- **Quarter end date unclear from OKR file:** Default to March 31, June 30, September 30, or December 31 based on the quarter the OKR file was created.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/milestones.md, ~/Documents/aireadylife/vault/*/open-loops.md, domain-specific vault files
- Writes to: none (returns data to calling op)
