---
name: aireadylife-calendar-op-weekly-agenda
type: op
cadence: weekly
description: >
  Monday morning weekly agenda builder; collects all cross-domain deadlines and
  priorities for the coming week, then suggests focus time blocks based on urgency
  and effort. Triggers: "weekly agenda", "what's this week", "week ahead", "monday preview".
---

# aireadylife-calendar-weekly-agenda

**Cadence:** Weekly (Monday morning)
**Produces:** Prioritized week-ahead brief in ~/Documents/aireadylife/vault/calendar/00_current/YYYY-MM-DD-week-agenda.md

## What It Does

The weekly agenda op runs every Monday before anything else competes for attention. It is the single most important calendar skill because it designs the week — not just documents it. By the time it completes, the user has a clear picture of what must be done this week, when to do the hard work, and what to expect in terms of time available vs. time committed.

The op begins by calling `calendar-flow-collect-deadlines` to extract all items with due dates in the next 7 days from every installed plugin vault's open-loops.md. The deadline scan also picks up any hard-deadline records stored in vault/calendar/00_current/ from prior deadline-planning sessions. Each item is tagged as urgent (≤7 days), upcoming (8-30 days), or horizon (31-60 days) — but for the weekly agenda, only the urgent and upcoming buckets appear in the deadline table.

Next, it reads the Google Calendar (via the gcalendar skill if configured) for the upcoming week's events. From this it calculates: total meeting hours per day, back-to-back meeting clusters (gaps <30 min), and the longest available uninterrupted block per day. Days with at least one 90+ minute free block are flagged as best for deep work. Days with back-to-back meeting clusters covering most of the morning or afternoon are flagged as focus-hostile.

The op then passes all inputs to `calendar-flow-build-agenda`, which ranks every item and produces the structured agenda document: a deadline table, a priority list (3-5 items requiring deep work), a focus block placement proposal (which specific days and time slots to use for the highest-effort priority items), and a deferred items section for anything on the radar but not requiring action this week.

Finally, it calls `calendar-task-update-open-loops` to ensure any newly surfaced items — deadlines discovered this run that weren't previously in the calendar vault — are added to vault/calendar/open-loops.md before the week starts.

## Triggers

- "weekly agenda"
- "what's this week"
- "week ahead"
- "monday preview"
- "set up my week"
- "build my week"
- "calendar this week"

## Steps

1. Verify vault/calendar/config.md exists; if missing, stop and prompt setup
2. Call `calendar-flow-collect-deadlines` to scan all plugin open-loops.md for items due in the next 60 days
3. Separate results by urgency: urgent (≤7 days), upcoming (8-30 days), horizon (31-60 days)
4. Read Google Calendar events for the coming week via `gcalendar` (if configured); calculate meeting load per day
5. Identify 90+ minute free blocks per day; flag focus-hostile days (back-to-back meetings, <2 hours total free)
6. Read high-priority (🔴/🟡) open loops from all installed plugin vaults for priority section
7. Pass all inputs to `calendar-flow-build-agenda` for ranked document assembly
8. Receive formatted agenda document from flow; review for completeness
9. Call `calendar-task-update-open-loops` to add any newly discovered items to open-loops.md
10. Write agenda to vault/calendar/00_current/YYYY-MM-DD-week-agenda.md
11. Return formatted agenda to user as chat output

## Input

- ~/Documents/aireadylife/vault/*/open-loops.md (all installed plugins)
- ~/Documents/aireadylife/vault/calendar/00_current/ (prior deadline records)
- `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records for trend comparison
- Google Calendar events for the coming week (via gcalendar skill, if configured)
- ~/Documents/aireadylife/vault/calendar/config.md

## Output Format

```
# Week of [Month DD, YYYY] — Agenda

## Monday Intent
[One sentence: what is this week fundamentally about?]

## This Week's Deadlines
| Day       | Domain    | Item                              | Due Date   | Priority |
|-----------|-----------|-----------------------------------|------------|----------|
| Monday    | tax       | Q1 estimated payment due          | Apr 15     | 🔴       |
| Wednesday | benefits  | Enrollment change window closes   | Apr 16     | 🟡       |

## Top Priorities (Require Deep Work Blocks)
1. [Item] — [Domain] — Est. effort: [N hours] — Best slot: [Day, time]
2. [Item] — [Domain] — Est. effort: [N hours] — Best slot: [Day, time]
3. [Item] — [Domain] — Est. effort: [N hours] — Best slot: [Day, time]

## Focus Block Calendar
| Day       | Best Focus Window  | Length | Assigned To          |
|-----------|--------------------|--------|----------------------|
| Tuesday   | 09:00–11:30        | 2.5h   | [Priority #1]        |
| Thursday  | 13:30–16:00        | 2.5h   | [Priority #2]        |
| Wednesday | —                  | —      | Focus-hostile (4 meetings)

## Deferred (On Radar, Not This Week)
- [Item] — [Domain] — [Next review date]

## Friday Review Placeholder
[Empty — fill in Friday to capture wins and carryovers]
```

## Configuration

Required in vault/calendar/config.md:
- `gcal_primary_calendar_id` — for Google Calendar integration
- `gcal_work_calendar_id` — optional second calendar
- `focus_block_minimum_minutes` — default 90; minimum block length to qualify as focus time

## Error Handling

- **gcalendar not configured:** Produce agenda without focus block analysis; note "Connect Google Calendar in config.md to enable focus time recommendations."
- **No deadlines found this week:** Show deadline table with "No deadlines this week" note; still populate priorities section from domain open loops.
- **No cross-domain open loops found:** Note "No active flags across installed plugins" in priorities section; still produce the agenda skeleton.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/*/open-loops.md, ~/Documents/aireadylife/vault/calendar/00_current/
- Writes to: ~/Documents/aireadylife/vault/calendar/00_current/YYYY-MM-DD-week-agenda.md, ~/Documents/aireadylife/vault/calendar/open-loops.md
