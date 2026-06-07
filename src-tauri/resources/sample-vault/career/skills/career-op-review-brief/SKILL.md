---
name: aireadylife-career-op-review-brief
type: op
cadence: monthly
description: >
  Monthly career review brief compiling market position, application pipeline status, comp vs. market summary, skills gap priorities, and 3-5 next actions. Produces a dated brief file and prioritized action list. Triggers: "career brief", "career review", "career status", "how is my career", "career update", "monthly career report".
---

## What It Does

Generates the monthly career brief — your one-stop view of where your career stands right now and what the 3-5 most important moves are for the coming month. This is the synthesis layer: it reads the outputs of all the individual career ops and flows that have run during the month and assembles them into a single, scannable document. The brief is saved as a dated file so you have a historical record of your career trajectory over time.

The brief has five sections. Market position: where you sit relative to the current market based on the most recent market scan — how many target roles are active, what compensation ranges look like, and any notable shifts in the market since last month. Pipeline status: a count of active applications by stage (applied, phone screen, technical, final, offer, watching), flags for anything requiring action in the next 7 days, and the overall health of your search funnel. Comp vs. market summary: your current TC percentile position based on the most recent quarterly benchmark, the gap vs. P50, and the recommended action level (none, negotiate, explore). Skills gap priorities: the top 3 skills from the quarterly gap analysis that have the highest demand in target role postings and the most impact on your candidacy, with specific learning resources for each. Next actions: exactly 3-5 concrete, dated next steps — not a list of everything you could do but the subset that will have the most impact this month.

The brief is formatted for a 2-minute read — executive summary at the top, detail sections below. It is not a data dump; it is a decision-support document. Every section either confirms that something is on track (no action needed) or identifies a specific gap and a specific action to close it.

## Triggers

- "career brief"
- "career review"
- "career status"
- "how is my career"
- "career update"
- "monthly career report"
- "show me my career"

## Steps

1. Read `vault/career/00_current/status.md` for sync status — confirm data freshness (if sync is more than 5 days old, note stale data warning).
2. Read most recent market scan brief from `vault/career/02_briefs/` — extract market health summary and qualifying posting count.
3. Read `vault/career/00_current/` — compile pipeline stage counts and identify items requiring action within 7 days.
4. Read most recent comp review brief from `vault/career/02_briefs/` — extract percentile position, gap vs. P50, and action level.
5. Read skills gap analysis from `vault/career/00_current/` — extract top 3 gap priorities with demand scores.
6. Read `vault/career/open-loops.md` — extract all open items, filter to highest priority by severity and deadline.
7. Synthesize market position section: posting volume, comp range, market health signal.
8. Synthesize pipeline status section: active opportunities by stage, items needing action with specific deadlines.
9. Synthesize comp summary section: current percentile, gap, recommended action.
10. Synthesize skills section: top 3 gaps with specific learning resource recommendations.
11. Synthesize next actions: select 3-5 highest-impact actions from open loops and current briefing data, assign target dates.
12. Write complete monthly brief to `vault/career/02_briefs/YYYY-MM-career-brief.md`.
13. Call `aireadylife-career-task-update-open-loops` with any new flags from this synthesis.

## Input

- `~/Documents/aireadylife/vault/career/02_briefs/` — prior market scan and comp review briefs
- `~/Documents/aireadylife/vault/career/00_current/` — active application pipeline
- `~/Documents/aireadylife/vault/career/00_current/` — skills gap analysis
- `~/Documents/aireadylife/vault/career/00_current/status.md` — sync status
- `~/Documents/aireadylife/vault/career/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/career/open-loops.md` — all outstanding flags

## Output Format

**Monthly Career Brief** — saved as `vault/career/02_briefs/YYYY-MM-career-brief.md`

```
# Career Brief — [Month Year]

## Executive Summary
[2-3 sentences: where you stand, biggest opportunity or risk right now]

## Market Position
Active postings matching your criteria: X
Comp range at target level (P25-P50): $X–$X
Market signal: [Strong / Neutral / Soft] — [brief explanation]

## Pipeline Status
| Stage | Count | Action Needed |
|-------|-------|--------------|
| Watching | X | — |
| Applied | X | X follow-ups due |
| Screening | X | — |
| Final | X | [specific action] |
| Offer | X | [deadline] |

## Comp vs. Market
Current TC: $X — [Xth percentile]
Gap vs. P50: +/-$X
Action level: None / Negotiate at review / Begin passive exploration / Active search

## Skills Gap Priorities
1. [Skill] — appears in X% of target postings — Resource: [specific course/cert]
2. [Skill] — appears in X% of target postings — Resource: [specific course/cert]
3. [Skill] — appears in X% of target postings — Resource: [specific course/cert]

## Next Actions (this month)
1. [Specific action] — by [date]
2. [Specific action] — by [date]
3. [Specific action] — by [date]
```

## Configuration

No additional configuration beyond standard `vault/career/config.md`. Brief cadence is monthly; if sub-domain ops (market scan, comp review, skills gap) have not run recently, the brief will note stale data.

## Error Handling

- **Sub-domain data missing or stale:** Note in brief which sections are based on stale data (>30 days) and recommend running the relevant op.
- **Pipeline vault empty:** Report pipeline section as "no active applications" — not an error, just a state.
- **No recent comp review:** Use config.md base salary for a rough percentile estimate and flag that a full comp review is needed for accuracy.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/career/02_briefs/`, `~/Documents/aireadylife/vault/career/00_current/`, `~/Documents/aireadylife/vault/career/00_current/`, `~/Documents/aireadylife/vault/career/00_current/status.md`, `~/Documents/aireadylife/vault/career/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/career/02_briefs/YYYY-MM-career-brief.md`, `~/Documents/aireadylife/vault/career/open-loops.md`
