---
name: aireadylife-learning-op-progress-review
type: op
cadence: monthly
description: >
  Monthly learning progress review checking all active courses and certifications for completion pace vs. target date, reading list progress vs. annual book goal, and monthly goal achievement vs. plan. Flags any item where completion percentage is more than 15 percentage points behind time-elapsed percentage. Triggers: "learning review", "course progress", "reading list review", "learning goals", "am I on track with learning", "check my courses".
---

## What It Does

Runs monthly on the 1st (typically triggered by the monthly sync) to evaluate whether every active learning item is on pace to complete by its target date. The key insight is that pace analysis requires both a completion percentage and a time context — a course at 50% complete is on track if 50% of the target time has elapsed, and falling behind if 80% of the time has elapsed.

**Pace calculation:** For each active course, certification, and book in `vault/learning/00_current/`: computes (completion_pct) vs. (days_elapsed_since_start ÷ total_days_to_target_date) = time_elapsed_pct. The pace deficit is (completion_pct − time_elapsed_pct). Items where completion % is more than 15 percentage points behind time_elapsed % are flagged as falling behind. Items within ±15 points are "on pace." Items more than 15 points ahead are "ahead of schedule."

**Recovery calculation:** For each flagged item, computes the daily or weekly pace needed to finish on time from today: (remaining content ÷ remaining days) = required daily pace. Expresses this in the units most relevant to the item type — minutes/day for a time-estimated course, pages/day for a book, modules/week for a certification course. This is the only number that makes "falling behind" actionable.

**Monthly goal assessment:** Reads monthly milestone targets from the active quarterly plan in `vault/learning/00_current/`. Calculates: (milestones hit this month ÷ total milestones planned for this month) = monthly achievement rate. If achievement rate is below 70%, flags the month as under-plan and identifies which items are causing the shortfall.

**Reading list analysis:** Counts books completed in the current month and YTD. Calculates current reading pace (books completed ÷ months elapsed). Projects year-end total at current pace and compares to annual goal. If projected total is below goal, calculates additional books/month needed for recovery.

**Certification exam readiness:** For each certification with an exam date set: (study hours logged ÷ estimated total study hours needed) = readiness %. Flags certifications where readiness % is significantly below time_elapsed % — meaning study pace is insufficient to be ready by exam date.

## Triggers

- "learning review"
- "course progress"
- "reading list review"
- "am I on track with my learning"
- "check my courses"
- "learning goals status"
- "am I behind on any courses"

## Steps

1. Read all active learning items from `vault/learning/00_current/` — courses, certification study plans, and books in progress.
2. For each item: calculate completion_pct and time_elapsed_pct. Compute pace deficit.
3. Classify each item: ahead (>15 pts ahead), on-pace (±15 pts), or behind (>15 pts behind).
4. For each "behind" item: calculate required daily/weekly pace to complete on time from today.
5. Call `aireadylife-learning-task-flag-falling-behind` for each behind item with full pace data.
6. Read active quarterly plan from `vault/learning/00_current/` — extract monthly milestone targets.
7. Compare milestones hit this month vs. planned. Calculate monthly achievement rate.
8. Call `aireadylife-learning-flow-build-reading-summary` — get reading pace and annual goal projection.
9. Read certification study hours from `vault/learning/00_current/certs/` — calculate exam readiness %.
10. Write progress review to `vault/learning/00_current/progress-YYYY-MM.md`.
11. Call `aireadylife-learning-task-update-open-loops` with all flagged items.

## Input

- `~/Documents/aireadylife/vault/learning/00_current/` — active courses, certs, books with start date and target date
- `~/Documents/aireadylife/vault/learning/00_current/` — monthly milestone targets
- `~/Documents/aireadylife/vault/learning/00_current/` — study hours logs for certifications
- `~/Documents/aireadylife/vault/learning/01_prior/` — prior period records for trend comparison

## Output Format

**Progress Review** — saved as `vault/learning/00_current/progress-YYYY-MM.md`

```
## Learning Progress Review — [Month Year]

### Course Progress
| Course | Platform | Target Date | Complete | Time Elapsed | Pace | Status |
|--------|---------|------------|---------|-------------|------|--------|
| [Course A] | Coursera | [date] | X% | X% | -Xpts | Behind |
| [Course B] | Udemy | [date] | X% | X% | +Xpts | On Pace |
| [Course C] | OReilly | [date] | X% | X% | +Xpts | Ahead |

Behind items — recovery plans:
  [Course A]: Need X minutes/day for X more days to finish on time

### Certification Readiness
[Cert Name] — Exam: [date] — Study hours logged: X of X — Readiness: X% — [On track / Behind]

### Reading Progress
Books completed this month: X | YTD: X of X annual goal (X%)
Current book: [title] — X% complete
Pace: X books/month — Projected year-end: X — [On track / Behind by X books]
Reading needed to recover: X additional books/month for remainder of year

### Monthly Goal Achievement
Milestones planned: X | Hit: X | Achievement rate: X%
Shortfall items: [item, item]

### Summary
On track: X / X active learning items
Flagged for attention: X
```

## Configuration

Required in `vault/learning/config.md`: `annual_book_goal`, `daily_study_minutes`.
Each active learning item in `vault/learning/00_current/` needs: `start_date`, `target_completion_date`, `total_units` (hours or modules or pages), `completed_units` (updated by sync).

## Error Handling

- **No active learning items:** Report empty progress table — not an error. Note that active items must be registered in `vault/learning/00_current/` for progress tracking.
- **Start date or target date missing for an item:** Cannot calculate pace without dates. Skip pace analysis for that item; flag as "dates missing."
- **Progress data is stale (monthly sync not run yet):** Note that data may be stale; recommend running monthly sync before progress review for accuracy.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/learning/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/learning/00_current/`, `~/Documents/aireadylife/vault/learning/00_current/`, `~/Documents/aireadylife/vault/learning/00_current/`
- Writes to: `~/Documents/aireadylife/vault/learning/00_current/progress-YYYY-MM.md`, `~/Documents/aireadylife/vault/learning/open-loops.md`
