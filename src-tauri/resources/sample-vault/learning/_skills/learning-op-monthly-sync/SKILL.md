---
name: aireadylife-learning-op-monthly-sync
type: op
cadence: monthly
description: >
  Full learning data sync on the 1st of each month. Refreshes course progress from all configured platforms, updates reading list status with current book progress and recent completions, recalculates certification exam timeline based on current study pace, reviews monthly learning goals vs. actuals, and identifies courses at risk of missing target completion dates. Triggers: "learning monthly sync", "sync learning data", "refresh learning vault", "update learning progress".
---

## What It Does

Full monthly sync that refreshes the learning vault across all data sources. Runs on the 1st of each month, touching four layers: platform progress, reading status, certification timeline, and goal actuals — then caps with a learning review brief. This is the maintenance op that keeps the vault data current so the weekly briefs and quarterly goal reviews are based on actual progress, not stale numbers.

**Platform progress refresh:** Connects to each configured learning platform (Coursera, LinkedIn Learning, Udemy, Pluralsight, A Cloud Guru, O'Reilly, Educative) via Playwright and pulls current completion status for each enrolled course. For each course: total modules or hours, completed modules or hours, completion percentage, last activity date, and any assignment or quiz deadlines. Saves updated progress to `vault/learning/00_current/` with a sync timestamp. Calculates whether each course is ahead of or behind its target completion pace using: (completion %) vs. (days elapsed since start ÷ total days to target completion date).

**Reading list sync:** Updates the reading list status in `vault/learning/00_current/` based on Goodreads RSS (if synced) or manual progress entries. Records: current book title, percentage complete (pages read ÷ total pages), books completed YTD (count and titles), and current reading pace (books/month). Compares YTD completion to annual reading goal pace.

**Certification timeline update:** For each active certification goal in `vault/learning/00_current/certs.md`: calculates study hours logged to date, remaining hours needed to reach exam-ready (based on estimated total study hours minus hours logged), and the daily study commitment needed to reach readiness by the scheduled exam date (if set). Flags certifications where the current pace will not reach readiness before exam date.

**Monthly goal vs. actual review:** Reads the monthly learning targets from `vault/learning/00_current/` (how many hours, which milestones, what completion targets) and compares against actual progress logged in the sync. Calculates the achievement rate (actual hours ÷ target hours, milestones hit ÷ milestones planned).

Ends by triggering `aireadylife-learning-op-review-brief` with the freshly synced data to produce the weekly brief for the new month.

## Triggers

- "learning monthly sync"
- "sync learning data"
- "refresh learning vault"
- "update learning progress"
- "run learning sync"

## Steps

1. Read `vault/learning/config.md` — confirm active platforms, Chrome profile paths, annual book goal, and daily study target.
2. For each configured platform: connect via Playwright (headless=False), navigate to enrolled/in-progress courses, extract completion percentages and last activity dates.
3. Update `vault/learning/00_current/` with current progress data for each course, noting sync timestamp.
4. Check Goodreads RSS or `vault/learning/00_current/current-reading.md` for reading progress — update current book percentage and add any recently completed books.
5. Count books completed YTD — compare to annual goal pace (goal ÷ 12 × months_elapsed).
6. Read certification goals from `vault/learning/00_current/certs.md` — for each: calculate hours logged, hours remaining, and required daily pace to reach exam date.
7. Read monthly milestone targets from `vault/learning/00_current/` — compare to actual progress.
8. Identify all active learning items where completion % is behind time-elapsed %: calculate the deficit and flag to `aireadylife-learning-task-flag-falling-behind`.
9. Update `vault/learning/00_current/status.md` with sync timestamp and summary statistics.
10. Call `aireadylife-learning-op-review-brief` to produce the monthly brief.
11. Call `aireadylife-learning-task-update-open-loops` with all flags from this sync.

## Input

- `~/Documents/aireadylife/vault/learning/config.md` — platform list, Chrome profiles, annual goal settings
- Learning platforms via Playwright (Coursera, Udemy, LinkedIn Learning, etc.)
- Goodreads RSS or `~/Documents/aireadylife/vault/learning/00_current/current-reading.md`
- `~/Documents/aireadylife/vault/learning/00_current/certs.md` — certification goals and exam dates
- `~/Documents/aireadylife/vault/learning/01_prior/` — prior period records for trend comparison

## Output Format

**Sync Summary** — written to `vault/learning/00_current/status.md`

```
## Learning Sync — [Month Year]
Sync completed: [timestamp]

Courses: X active courses updated across X platforms
  Ahead of pace: X courses
  On pace: X courses
  Behind pace: X courses — flagged for review

Reading: X books completed YTD of X annual goal (X%)
  Current book: [title] — X% complete
  Monthly pace: X books/month — [on track / behind]

Certifications: X active cert goals
  Exam-ready by target date: X
  At risk: X — [cert name] needs X more hours/day to reach exam date

Monthly goals: [X% of milestones hit]

Brief: Generated at vault/learning/02_briefs/[file]
```

## Configuration

Required in `vault/learning/config.md`:
- `active_platforms` — list with platform name and Chrome profile path
- `annual_book_goal` — target books per year
- `daily_study_minutes` — daily study target in minutes

## Error Handling

- **Platform login expired:** Note which platform sync failed; proceed with all others. Prompt user to re-authenticate in Chrome.
- **Coursera has no active enrollments:** Report zero active courses on that platform.
- **Goodreads RSS not configured:** Fall back to reading progress from `vault/learning/00_current/current-reading.md` (manual updates).
- **No certification goals configured:** Skip certification timeline section with note.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/learning/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/learning/config.md`, `~/Documents/aireadylife/vault/learning/00_current/certs.md`, `~/Documents/aireadylife/vault/learning/00_current/`
- Writes to: `~/Documents/aireadylife/vault/learning/00_current/`, `~/Documents/aireadylife/vault/learning/00_current/`, `~/Documents/aireadylife/vault/learning/00_current/status.md`, `~/Documents/aireadylife/vault/learning/open-loops.md`
