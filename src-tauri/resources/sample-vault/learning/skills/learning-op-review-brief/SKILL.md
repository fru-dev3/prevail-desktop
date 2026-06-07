---
name: aireadylife-learning-op-review-brief
type: op
cadence: weekly
description: >
  Weekly learning brief compiling active course progress with pace status, current book chapter and reading pace vs. annual goal, certification exam countdown and readiness percentage, weekly study hours logged, and 1-3 specific learning actions for the coming week. Produced every Monday. Triggers: "learning brief", "learning review", "how is my learning", "study update", "learning status", "course update".
---

## What It Does

Generates the weekly learning brief — a 3-minute read that gives you a complete view of your learning progress and tells you exactly what to do this week to stay on track. The brief runs weekly because learning pace issues compound quickly: a course that is 10% behind this week is 40% behind in a month if the pace doesn't change. Weekly visibility enables weekly corrections.

The brief has five sections. Active courses: each course with completion percentage, target date, pace status (ahead/on-track/behind), and for behind items, the specific daily pace needed to recover. Current book: title, percentage complete, current reading pace, and projected completion date. Certification status: if an exam date is set, the countdown in days, the current readiness percentage (study hours completed ÷ total estimated), and the weekly study target to reach exam readiness on time. Study hours: weekly hours logged vs. the configured weekly study target. Next actions: exactly 1-3 specific, calendar-bindable actions for the coming week — not "study more" but "complete modules 4-6 of Course A by Wednesday and finish Part II of current book by Sunday."

The brief is designed for a Monday morning read. It anchors the week's learning intentions concretely and ensures that the user's configured study time is allocated to the highest-priority items, not whatever seems appealing on the day.

## Triggers

- "learning brief"
- "learning review"
- "how is my learning going"
- "study update"
- "learning status"
- "course update"
- "what should I study this week"

## Steps

1. Check data freshness — most recent progress data in `vault/learning/00_current/status.md` — note if stale (> 7 days).
2. Read all active learning items from `vault/learning/00_current/` — extract completion %, target date, start date, platform.
3. Calculate pace status for each item: completion % vs. time elapsed %; classify ahead/on-track/behind.
4. For behind items: calculate required daily pace to finish on time from today.
5. Read current book progress from `vault/learning/00_current/current-reading.md` — extract title, % complete, estimated remaining pages.
6. Calculate reading pace from completion history — project current book completion date at current pace.
7. Read certification data from `vault/learning/00_current/certs.md` — for any cert with exam date set, calculate days-to-exam and readiness %.
8. Read weekly study hours logged from `vault/learning/00_current/study-log.md` for the current week — compare to configured weekly target.
9. Read open loops from `vault/learning/open-loops.md` — extract highest-priority items.
10. Synthesize 1-3 next actions for the coming week, prioritized by what most advances the top-priority learning goals.
11. Write weekly brief to `vault/learning/02_briefs/YYYY-MM-DD-learning-brief.md`.
12. Call `aireadylife-learning-task-update-open-loops` with any new flags.

## Input

- `~/Documents/aireadylife/vault/learning/00_current/` — active items, status, certs, study log
- `~/Documents/aireadylife/vault/learning/00_current/current-reading.md` — current book data
- `~/Documents/aireadylife/vault/learning/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/learning/open-loops.md` — outstanding flags

## Output Format

**Weekly Learning Brief** — saved as `vault/learning/02_briefs/YYYY-MM-DD-learning-brief.md`

```
# Learning Brief — [Date] (Week of [Mon–Sun])

## Active Courses
| Course | Platform | % Complete | Target | Pace | Status |
|--------|---------|-----------|--------|------|--------|
| [Course A] | Coursera | X% | [date] | -Xpts | BEHIND — need X min/day |
| [Course B] | Udemy | X% | [date] | +Xpts | On Track |

## Current Reading
[Book Title] by [Author]
Progress: X% (page X of X)
Reading pace: ~X pages/day — completion: [projected date]
YTD books: X of X annual goal ([on track / behind by X books])

## Certification Countdown
[Cert Name] — Exam in X days ([date])
Readiness: X% (X of X estimated study hours)
Weekly study needed: X hours/week to reach exam-ready

## Study Hours This Week
Logged: X hours | Target: X hours/week ([X% of target])

## This Week's Actions
1. [Specific action by specific day]
2. [Specific action by specific day]
3. [Specific action by specific day]

## Open Items
- [flag with action if needed]
```

## Configuration

Required in `vault/learning/config.md`:
- `daily_study_minutes` — for weekly target calculation
- `study_days_per_week` — for weekly total target
- `annual_book_goal` — for reading goal tracking
- `brief_day` — day of week for brief generation (default: Monday)

Study log at `vault/learning/00_current/study-log.md` with daily entries: date, hours logged, items worked on.

## Error Handling

- **No active learning items:** Brief reports empty portfolio. Suggest running quarterly goal review to set up the quarter's learning plan.
- **Study log empty for the week:** Report weekly hours as 0; do not fabricate data.
- **No certification exam date set:** Report certification status as "Exam not scheduled — set a target date to enable countdown and readiness tracking."
- **Data more than 7 days old:** Generate brief with note that data may not reflect the most recent session; recommend running monthly sync.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/learning/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/learning/00_current/`, `~/Documents/aireadylife/vault/learning/00_current/`, `~/Documents/aireadylife/vault/learning/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/learning/02_briefs/YYYY-MM-DD-learning-brief.md`, `~/Documents/aireadylife/vault/learning/open-loops.md`
