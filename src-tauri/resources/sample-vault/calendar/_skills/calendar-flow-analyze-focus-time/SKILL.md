---
name: aireadylife-calendar-flow-analyze-focus-time
type: flow
trigger: called-by-op
description: >
  Analyzes the ratio of meetings vs. unblocked focus time across the past week
  and upcoming week, comparing against a 10-hour focus goal and identifying
  which days have the best and worst deep work conditions.
---

# aireadylife-calendar-analyze-focus-time

**Trigger:** Called by `aireadylife-calendar-op-focus-time-review`
**Produces:** Detailed focus time analysis with per-day scores, meeting totals, and deficit diagnosis returned to calling op

## What It Does

This flow performs the raw mathematical analysis of time allocation that powers the focus time review op. It reads calendar event data for a specified date range and produces a detailed breakdown of where time went — specifically, how much time was available for sustained cognitive work versus consumed by meetings and fragmentation.

**Meeting classification:** All calendar events with at least one attendee other than the user are classified as meetings. Events with only the user (solo blocks, commute blocks, lunch holds) are classified as non-meeting time and treated as potentially available for focus — unless the event is titled or labeled as a non-work activity. Travel events are classified separately and not counted as either meeting or focus time.

**Qualifying focus time calculation:** The core measurement is the length of every uninterrupted block of time between meetings (or between start-of-day and first meeting, and between last meeting and end-of-day). The start-of-day and end-of-day bounds default to 08:00 and 18:00 unless the user has set different working hours in vault/calendar/config.md. A block qualifies as focus time only if it is 90 minutes or longer — shorter blocks are counted as "gap time" (not meeting time but not qualifying focus time). The 90-minute threshold is based on cognitive research showing that most complex knowledge tasks require at least 60-90 minutes to reach productive depth, so sub-90-minute blocks tend not to produce the same quality output.

**Per-day focus quality score:** Each day receives a focus quality score from 1-10 based on three factors: longest single uninterrupted block (weight: 50%), total qualifying focus hours (weight: 30%), and number of context switches between meetings and focus blocks (weight: 20%, where more switches = lower score). A day with one 4-hour block scores higher than a day with four 60-minute blocks, even if total free time is similar, because the 4-hour block allows deeper work entry.

**Deficit diagnosis:** When weekly qualifying focus time falls below the target (default 8 hours), the flow identifies the primary structural cause by analyzing which specific pattern consumed the most potential focus time: meeting-dense mornings (events before 10:00 AM), back-to-back clusters (consecutive meeting blocks with <30 min gaps), short-filler meetings (<30 min each) that fragment afternoons, or no recovery days (every workday has high meeting density). The diagnosis is returned as a plain-language finding with the specific meetings or patterns identified, not as a generic "too many meetings" observation.

## Steps

1. Receive date range (past week + upcoming week) from calling op
2. Read all calendar events in the date range via gcalendar skill
3. Classify each event: meeting, non-meeting solo block, travel, non-work
4. For each workday: calculate start-of-day and end-of-day bounds (from config or default 08:00-18:00)
5. Identify all continuous free blocks (gaps between meetings within work hours)
6. Classify each block: qualifying focus (≥90 min) or gap time (<90 min)
7. Calculate per-day: total meeting time, gap time, qualifying focus time, longest single block, context switches
8. Calculate per-day focus quality score (longest block 50% + qualifying hours 30% + context switches 20%)
9. Sum weekly qualifying focus hours; compare to target (default 8h)
10. If below target: identify primary structural cause from pattern analysis
11. For upcoming week: repeat steps 3-8 on already-scheduled events; calculate projected qualifying focus time
12. Return full analysis to calling op

## Input

- Google Calendar events for specified date range (via gcalendar skill)
- ~/Documents/aireadylife/vault/calendar/config.md (working hours, focus block minimum)
- `vault/calendar/01_prior/` — prior period records for trend comparison

## Output Format

Returns structured data to calling op:
```
{
  past_week: {
    days: [
      { date: "2026-04-07", meeting_hours: 4.0, gap_hours: 1.5, focus_hours: 2.5, longest_block_min: 150, context_switches: 3, quality_score: 7.2 },
      ...
    ],
    total_meeting_hours: 18.5,
    total_focus_hours: 11.5,
    target_hours: 8.0,
    score_tier: "Healthy",
    deficit: false
  },
  upcoming_week: {
    days: [...],
    projected_focus_hours: 6.0,
    score_tier: "Deficit",
    at_risk_days: ["Wednesday", "Thursday"],
    diagnosis: "Wednesday has 4 consecutive meetings 09:00–13:30 leaving only 2 afternoon slots under 90 minutes."
  }
}
```

## Configuration

In vault/calendar/config.md:
- `work_start_time` — default 08:00
- `work_end_time` — default 18:00
- `focus_block_minimum_minutes` — default 90
- `weekly_focus_target_hours` — default 8

## Error Handling

- **gcalendar not configured:** Cannot run. Return error to calling op: "gcalendar integration required."
- **No events found for a day:** Treat the entire workday as qualifying focus time (a meeting-free day is the best possible focus day).
- **Events missing start/end times:** Skip those events in calculation; note count in metadata.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records
- Reads from: Google Calendar (via gcalendar), ~/Documents/aireadylife/vault/calendar/config.md
- Writes to: none (returns data to calling op)
