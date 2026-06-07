---
name: aireadylife-calendar-op-focus-time-review
type: op
cadence: weekly
description: >
  Weekly focus time audit; analyzes meeting load vs. deep work blocks across the
  current and upcoming week, flags weeks falling below 8 hours of uninterrupted
  focus time, and recommends specific calendar changes to protect deep work.
  Triggers: "focus review", "meeting overload", "deep work time", "calendar audit".
---

# aireadylife-calendar-focus-time-review

**Cadence:** Weekly (Friday or Sunday)
**Produces:** Focus-time audit report in ~/Documents/aireadylife/vault/calendar/00_current/YYYY-MM-DD-focus-audit.md

## What It Does

The focus time review is a weekly calendar health check with a single core question: did this week's calendar support the kind of cognitive work that actually moves your life forward? It looks at both the past week (retrospective) and the upcoming week (forward-looking) to give the user both a score and a warning.

The op calls `calendar-flow-analyze-focus-time` to do the detailed computation. The flow reads calendar event data and calculates, for each day: total meeting time (scheduled events with participants), gap time between meetings (the fragmented blocks that feel like they should count but often don't), and qualifying focus time (uninterrupted blocks of 90 minutes or longer). Blocks under 90 minutes are not counted as qualifying focus time — they are too short to sustain deep cognitive work on complex tasks.

**Focus scoring:** Weekly qualifying focus hours are measured against a target of 8 hours per week. The score tiers are: Healthy (8+ hours), Marginal (6-7.9 hours), Deficit (4-5.9 hours, 🟡 flag), Critical Deficit (<4 hours, 🔴 flag). When a week falls below 6 hours, the op identifies the primary cause:
- **Meeting-dense mornings:** Meetings before 10:00 AM consume the highest-quality cognitive time of the day for most people. Even if total meeting hours are manageable, early meetings fragment the most valuable focus window.
- **Back-to-back clusters:** Three or more consecutive meetings with gaps under 30 minutes prevent any meaningful context-switch recovery, let alone deep work entry.
- **Short-filler meetings:** 15-30 minute meetings scattered throughout the afternoon create a fragmented schedule where no block meets the 90-minute threshold even though large portions of the afternoon appear "free" on the calendar.
- **Meeting-heavy days with no recovery days:** When Monday through Thursday are meeting-intensive, there's no day left to do the week's real work.

**Forward-looking recommendations:** The review also calculates the upcoming week's focus time forecast based on currently scheduled events. If next week is already projected to fall below 6 hours, the op issues pre-emptive recommendations: specific meetings to try to reschedule or decline, mornings to protect from any new meeting requests, and which existing gaps are large enough to be turned into protected focus blocks.

Updates vault/calendar/open-loops.md if a recurring deficit pattern is detected (focus hours below 6 for 2+ consecutive weeks) — this creates a visible cross-domain flag that surfaces in Chief briefs.

## Triggers

- "focus review"
- "meeting overload"
- "deep work time"
- "calendar audit"
- "focus time check"
- "how's my calendar"
- "protect my focus"

## Steps

1. Verify vault/calendar/config.md exists and gcalendar is configured
2. Call `calendar-flow-analyze-focus-time` with past 7 days and upcoming 7 days as date ranges
3. Receive per-day breakdown: total meeting hours, gap time, qualifying focus time (90+ min blocks)
4. Sum qualifying focus hours for the past week; compare to 8-hour target
5. Assign score tier: Healthy / Marginal / Deficit / Critical Deficit
6. Identify primary cause of any deficit (meeting-dense mornings / back-to-back clusters / short fillers / no recovery days)
7. Calculate upcoming week's projected focus time based on already-scheduled events
8. Generate specific recommendations: meetings to reschedule, mornings to protect, blocks to add to calendar
9. If 2+ consecutive weeks below 6 hours: write recurring deficit flag to vault/calendar/open-loops.md via `calendar-task-update-open-loops`
10. Write full focus audit report to vault/calendar/00_current/YYYY-MM-DD-focus-audit.md
11. Return audit summary to user as chat output

## Input

- Google Calendar events for past 7 days and upcoming 7 days (via gcalendar skill)
- ~/Documents/aireadylife/vault/calendar/00_current/ (prior focus audit files for trend comparison)
- `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/calendar/config.md

## Output Format

```
# Focus Time Audit — Week of [Month DD, YYYY]

## Past Week: [Retrospective]
| Day       | Meeting Hours | Focus Hours (90+ min blocks) | Longest Block | Score         |
|-----------|--------------|------------------------------|---------------|---------------|
| Monday    | 4.0h         | 2.0h (1 block: 2h)          | 120 min       | Marginal      |
| Tuesday   | 2.0h         | 4.5h (2 blocks: 2.5h, 2h)  | 150 min       | Healthy       |
| Wednesday | 6.5h         | 0h (no 90-min blocks)       | 45 min        | Focus-hostile |
| Thursday  | 3.0h         | 3.0h (2 blocks)             | 100 min       | Healthy       |
| Friday    | 1.0h         | 2.0h (1 block)              | 120 min       | Healthy       |
| **TOTAL** | 16.5h        | **11.5h**                   | —             | ✅ Healthy     |

**Primary issue this week:** Wednesday lost all focus time to back-to-back meetings 09:00–15:30.

## Upcoming Week: [Forward Forecast]
Projected qualifying focus: [N hours] — [Tier]
At-risk days: [Day] — [reason]

## Recommendations
- Move Wednesday's 10:00 standup to Tuesday batch (saves 1.5h focus on Wednesday)
- Block Thursday 09:00–11:30 as "Focus — No Meetings" before anyone schedules there
- Decline or reschedule [meeting name] — 30 min filler meeting breaking the 13:00–16:00 block on Friday

## Trend
| Week        | Focus Hours | Tier     |
|-------------|-------------|----------|
| Apr 7-11    | 11.5h       | Healthy  |
| Mar 31–Apr 4| 5.5h        | Deficit  |
| Mar 24-28   | 7.0h        | Marginal |
```

## Configuration

Required in vault/calendar/config.md:
- `gcal_primary_calendar_id` — required for focus time calculation
- `focus_block_minimum_minutes` — default 90; adjustable
- `weekly_focus_target_hours` — default 8; adjustable to user's goals

## Error Handling

- **gcalendar not configured:** Cannot run. "Google Calendar integration required for focus time review. Configure in vault/calendar/config.md."
- **Past week has no calendar data:** Note "No calendar data found for the past week" in retrospective section; still produce the forward forecast if upcoming events are available.
- **No 90-min blocks found for the week:** Flag as Critical Deficit; list all existing gaps with their lengths to show what's available.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records
- Reads from: Google Calendar (via gcalendar), ~/Documents/aireadylife/vault/calendar/00_current/
- Writes to: ~/Documents/aireadylife/vault/calendar/00_current/YYYY-MM-DD-focus-audit.md, ~/Documents/aireadylife/vault/calendar/open-loops.md
