---
name: aireadylife-learning-op-goal-review
type: op
cadence: quarterly
description: >
  Quarterly learning goal alignment review evaluating whether the active learning portfolio is pointed at career and life vision priorities for the next quarter. Adds goals driven by career skills gap data, removes or deprioritizes goals that are no longer strategically relevant, and produces an updated quarterly learning plan with priority rankings. Triggers: "learning goals review", "quarterly learning", "skills update", "certifications review", "am I learning the right things", "update my learning plan".
---

## What It Does

Runs quarterly (January 1, April 1, July 1, October 1) to ensure your learning investments are systematically aligned with your career trajectory, not with whatever happens to look interesting this month. The quarterly cadence is intentional: frequent enough to incorporate career skill gap updates (which run on the same cycle) and life vision shifts, infrequent enough to allow meaningful progress on each goal before re-evaluating.

**Portfolio assessment:** Reads all active and queued learning goals from `vault/learning/00_current/`. For each goal, assesses three dimensions: (1) strategic relevance — does this goal directly support a top career priority or life vision objective? Cross-references with the most recent skills gap analysis from `vault/career/00_current/` (if Career plugin is installed) and the user's stated vision priorities from `vault/learning/config.md`; (2) progress reality — given the completion pace to date, is the user likely to reach working proficiency on this goal within the quarter? A goal that is 5% complete with 85% of the quarter elapsed is either behind schedule or was overambitious at the start; (3) opportunity cost — is the time spent on this goal preventing progress on a higher-priority goal?

**New goal additions:** Based on the most recent career skills gap priorities (typically provided by the Career plugin's quarterly op), proposes specific new learning goals for the next quarter. Each proposed goal comes with: a specific resource (exact course name, platform, estimated hours), a target completion date within the quarter, a weekly study commitment calculation (total hours ÷ weeks in quarter), and a connection to the career gap data that motivates it (skill name, demand percentage in target role postings).

**Goal pruning:** Recommends removing or pausing goals that meet any of these criteria: no progress in 21+ days and no committed restart date; strategic relevance has dropped (the skill is no longer in top-5 skills gap priorities or the career direction has shifted); the goal was aspirational rather than actionable (e.g., "learn machine learning broadly" without a specific resource or completion definition). Pruning is not failure — it is a focused portfolio management decision.

**SMART goal validation:** All active goals after the review should be SMART: Specific (exact course or certification named), Measurable (completion percentage or exam pass), Achievable (within the quarter's available study time), Relevant (connected to top career or vision priority), and Time-bound (specific target date). Vague goals are rewritten or removed.

**Output — quarterly learning plan:** A prioritized list of 2-4 active learning goals for the next quarter, each with weekly milestone markers, a study commitment (hours/week), and a connection to the career or vision priority it serves. Not a wish list — a realistic, time-bound plan.

## Triggers

- "learning goals review"
- "quarterly learning review"
- "am I learning the right things"
- "update my learning plan"
- "certifications review"
- "skills update for next quarter"
- "what should I focus on learning this quarter"

## Steps

1. Read all active and queued learning goals from `vault/learning/00_current/`.
2. Read most recent career skills gap analysis from `vault/career/00_current/` (if Career plugin installed) — extract top 3-5 priority gaps for this quarter.
3. Read vision priorities from `vault/learning/config.md` — extract any learning goals tied to life vision objectives.
4. For each active goal: assess strategic relevance, progress reality, and opportunity cost.
5. Flag goals for removal or pause based on pruning criteria (no progress 21+ days, strategic relevance dropped, achievability doubtful).
6. Cross-reference current goal list with career gap priorities — identify gaps not yet in the learning portfolio.
7. For each unaddressed career gap priority: propose a specific new learning goal (resource + timeline + weekly commitment).
8. Validate remaining active goals against SMART criteria; rewrite any that are vague.
9. Prioritize all continuing and new goals into an ordered list (top priority = highest demand career gap + shortest time to close).
10. Calculate weekly study time commitment for each goal — verify total commitment fits within configured daily study target × days/week.
11. Write quarterly learning plan to `vault/learning/00_current/YYYY-QN-learning-plan.md` with prioritized goals, weekly milestones, and career/vision connection for each.
12. Archive removed or paused goals to `vault/learning/01_prior/goals-paused.md`.
13. Call `aireadylife-learning-task-update-open-loops` with any goals flagged as at-risk or behind.

## Input

- `~/Documents/aireadylife/vault/learning/00_current/` — current active goals
- `~/Documents/aireadylife/vault/career/00_current/` — career skills gap data (if Career plugin installed)
- `~/Documents/aireadylife/vault/learning/config.md` — daily study target, weekly availability, vision priorities

## Output Format

**Quarterly Learning Plan** — saved as `vault/learning/00_current/YYYY-QN-learning-plan.md`

```
## Learning Plan — [Quarter Year]

Total weekly study capacity: X hours/week ([X min/day × X days/week])

## Active Goals (priority ordered)

### Priority 1: [Goal Name]
Type: Course / Certification / Reading goal
Resource: [Platform] — "[Exact Course/Cert Name]" — ~X hours
Career connection: Closes [skill] gap — X% demand in target job postings
Weekly commitment: X hours/week
Target completion: [date]
Weekly milestones:
  Week 1: [specific milestone]
  Week 2: [milestone]
  ...

### Priority 2: ...

## Goals Paused This Quarter
- [Goal] — Reason: [low progress / strategic relevance dropped / overambitious]
- Paused to: vault/learning/01_prior/goals-paused.md

## Goals Proposed for Next Quarter (not yet started)
- [Goal] — [Career connection] — [Proposed start: Q+1]

## Completion Targets This Quarter
- Courses completing: X
- Certifications attempting: X
- Books completing: X
```

## Configuration

Required in `vault/learning/config.md`:
- `daily_study_minutes` — target daily study time in minutes
- `study_days_per_week` — how many days per week study time is available
- `annual_book_goal` — books per year target
- `vision_learning_priorities` — list of learning goals tied to life vision (not just career)
- `active_platforms` — list of platforms actively subscribed

## Error Handling

- **Career skills gap data unavailable:** Note that goal alignment is based only on vision priorities and user-stated priorities, not career gap data. Recommend running career skills gap review if Career plugin is installed.
- **No active goals in vault:** Start fresh — propose 2-3 goals based on career gap priorities and confirm with user before writing plan.
- **Weekly study capacity insufficient for all proposed goals:** Reduce to top 2 goals that fit within capacity. Be explicit about the trade-off: "Adding goal 3 would require X hours/week — you have X available."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/learning/00_current/`, `~/Documents/aireadylife/vault/career/00_current/`, `~/Documents/aireadylife/vault/learning/config.md`
- Writes to: `~/Documents/aireadylife/vault/learning/00_current/YYYY-QN-learning-plan.md`, `~/Documents/aireadylife/vault/learning/01_prior/goals-paused.md`, `~/Documents/aireadylife/vault/learning/open-loops.md`
