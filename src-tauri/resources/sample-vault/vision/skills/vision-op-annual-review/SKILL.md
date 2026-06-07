---
name: aireadylife-vision-op-annual-review
type: op
cadence: annual
description: >
  December annual life review; retrospective on goals achieved across all domains,
  life vision document refresh, and next year's priority targets. The single most
  important op of the year.
  Triggers: "annual review", "year review", "end of year", "life vision review".
---

# aireadylife-vision-annual-review

**Cadence:** Annual (December, first two weeks)
**Produces:** Annual retrospective and refreshed vision doc in ~/Documents/aireadylife/vault/vision/01_prior/ plus Q1 draft OKRs in vault/vision/00_current/

## What It Does

The annual review is the most comprehensive and highest-stakes op in the entire AI Ready Life system. It synthesizes a full year of domain activity, assesses the trajectory of the life vision, and sets the strategic direction for the coming year. Plan for 2-4 hours to complete a thorough annual review — it can be split into multiple sessions and the op saves progress between conversations.

**Year-in-review retrospective:** The op reads all 12 monthly scorecard files from vault/vision/00_current/ to build a full-year trajectory for each of the 13 domains. For each domain, it calculates: the average score across the year, the best month, the worst month, and whether the domain ended the year higher, lower, or the same as it started. This year-arc picture answers the question "Which areas of life actually got better this year, and which got worse or stagnated?"

**Achievement compilation:** The op reads vault/vision/00_current/milestones.md for all milestones logged during the year and organizes them by domain and date. These are the concrete things that were accomplished — career wins, financial milestones, health achievements, creative outputs, relationship investments, learning completions, business wins. The milestone log is the antidote to recency bias in year-end review: without it, people remember only the last few weeks. The full milestone list is presented as the achievements section of the year-in-review report.

**Vision document review:** The op reads the current life vision document from vault/vision/00_current/ (the 3-5 year picture of the ideal life) and asks a structured set of questions: Does this still describe what I actually want? Have my priorities fundamentally shifted? Did I discover this year that something I thought mattered a lot actually doesn't — or vice versa? Are there new life circumstances (children, relationships, health, career shift) that the vision document doesn't reflect? The vision document may be updated based on this review. If the BHAG needs updating, it is also reviewed here.

**OKR completion assessment:** Calls `vision-flow-score-domain-progress` to assess how the full year's OKRs ended — aggregating across all four quarterly OKR files to show a year-level completion rate. Which types of goals consistently got achieved? Which consistently fell short? The pattern reveals both the user's actual priorities (revealed by action rather than stated intention) and the types of goals that were systematically miscalibrated (consistently set too ambitiously or too passively).

**Q1 draft generation:** After the retrospective, the op calls `vision-flow-draft-quarterly-plan` to generate a first draft of Q1 OKRs for the new year. The Q1 draft is informed by the full year of retrospective data rather than just the prior quarter — making it a more strategic starting point than a standard quarterly planning session.

## Triggers

- "annual review"
- "year review"
- "end of year"
- "life vision review"
- "year in review"
- "year recap"
- "2026 review" (or any year)

## Steps

1. Verify vault/vision/00_current/ contains monthly scorecards for the year; note any missing months
2. Read all 12 monthly scorecard files; calculate per-domain year trajectory (average, best month, worst month, start-vs-end)
3. Read vault/vision/00_current/milestones.md; organize milestones by domain and quarter
4. Present year-in-review retrospective: domain trajectories + achievement compilation
5. Facilitate vision document review conversation: does the 3-5 year picture still fit?
6. If vision document needs updating: assist with edits and write updated version
7. Call `vision-flow-score-domain-progress` with all four quarterly OKR files for year-level completion assessment
8. Identify patterns in goal achievement vs. shortfall across the year
9. Archive current-year OKR files and scorecard files to vault/vision/01_prior/YYYY/
10. Call `vision-flow-draft-quarterly-plan` for Q1 next year draft OKRs
11. Present Q1 draft for review; facilitate refinement conversation
12. Write final annual review report to vault/vision/01_prior/YYYY-annual-review.md
13. Write Q1 draft OKRs to vault/vision/00_current/YYYY-Q1-draft-okrs.md
14. Call `vision-task-update-open-loops` to reset vision open-loops.md for the new year
15. Call `vision-task-log-milestone` for any significant year-end achievements worth recording

## Input

- ~/Documents/aireadylife/vault/vision/00_current/YYYY-01-scorecard.md through YYYY-12-scorecard.md
- ~/Documents/aireadylife/vault/vision/00_current/milestones.md
- ~/Documents/aireadylife/vault/vision/00_current/ (life vision document, BHAG)
- ~/Documents/aireadylife/vault/vision/00_current/ (all four quarterly OKR files for the year)

## Output Format

Annual review report (vault/vision/01_prior/YYYY-annual-review.md):
```
# [YYYY] Annual Review

## Year in Numbers
Overall average life score: [N]/10
Highest-scoring domain: [Domain] ([score])
Most-improved domain: [Domain] ([start score] → [end score])
Most-declined domain: [Domain] ([start score] → [end score])
Milestones logged: [N] across [N] domains
OKR completion rate: [N]% of KRs achieved (Q1-Q4 combined)

## Achievements — What Got Done
### [Domain]
- [Milestone title] — [Date] — [Description]
...

## Domain Trajectories
| Domain       | Jan  | Apr  | Jul  | Oct  | Dec  | Trend |
|--------------|------|------|------|------|------|-------|
| Health       | 6.5  | 7.0  | 7.5  | 7.0  | 7.2  | ↑     |
...

## What Worked (Lessons)
- [Pattern that produced results: specific examples]

## What Didn't (Lessons)
- [Pattern that consistently fell short: diagnosis]

## Vision Document Status
[Updated / Unchanged — summary of what changed if updated]

## Q1 [New Year] Preview
[Summary of Q1 draft OKRs]
```

## Configuration

Required in vault/vision/config.md:
- Life vision document must be present
- Prior year scorecard files must exist in vault/vision/00_current/

## Error Handling

- **Missing monthly scorecards:** Note which months have no data; run review with available months; recommend running the monthly scorecard for missing months if they're recent enough.
- **No milestone log found:** Conduct the review without the achievement section; recommend starting the milestone log next year.
- **Vision document missing:** Create a new vision document during the review rather than skipping the section.

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/
- Writes to: ~/Documents/aireadylife/vault/vision/01_prior/YYYY-annual-review.md, ~/Documents/aireadylife/vault/vision/00_current/YYYY-Q1-draft-okrs.md, ~/Documents/aireadylife/vault/vision/00_current/ (if vision doc updated)
