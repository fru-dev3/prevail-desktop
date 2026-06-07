---
name: gcalendar
type: app
description: >
  Reads and creates calendar events via the Google Calendar API. Used by calendar-agent for
  weekly agenda generation, focus time block analysis, multi-calendar event aggregation, and
  deadline event creation. Supports multiple calendars (personal, work, shared). Configure
  OAuth credentials and calendar IDs in vault/calendar/config.md.
---

# Google Calendar — Calendar Plugin

**Auth:** OAuth2 via Google Calendar API
**URL:** https://calendar.google.com
**Configuration:** Set credentials and calendar IDs in `vault/calendar/config.md`

## What It Does

Provides the calendar-agent with live event data across all configured calendars. This is the
primary input for focus time analysis — the agent reads the actual schedule to calculate how many
qualifying deep-work blocks (90+ continuous minutes) occurred in the past week and are available
in the upcoming week. It also supports writing focus block events and deadline reminder events
directly to the calendar as part of the weekly agenda flow.

## Data Available

- Events in a date range across multiple calendars (title, start time, end time, description, location, attendees)
- Free/busy windows for scheduling focus blocks — identify gaps 90+ minutes long with no events
- Event recurrence information (weekly standups, monthly reviews, recurring commitments)
- All-day events (holidays, deadlines, OOO blocks)
- Multi-calendar aggregation: personal + work + shared calendars merged into one timeline view
- Event creation: create single or recurring events with title, time, description, and color
- Event update and deletion: modify or remove events created by the agent

## Configuration

Add to `vault/calendar/config.md`:
```
gcal_credentials: ~/Documents/aireadylife/vault/calendar/00_current/gcal-oauth.json
gcal_primary_calendar_id: YOUR_EMAIL@gmail.com
gcal_work_calendar_id: YOUR_WORK_EMAIL@company.com
gcal_focus_calendar_id: YOUR_EMAIL@gmail.com   # calendar where focus blocks are written
gcal_color_focus: 9        # Blueberry — used for focus block events
gcal_color_deadline: 11    # Tomato — used for deadline reminder events
```

**OAuth2 setup:** Create a project in Google Cloud Console → enable Google Calendar API → create
OAuth2 credentials → download JSON to `vault/calendar/00_current/gcal-oauth.json`.
Scope needed: `https://www.googleapis.com/auth/calendar` (full read/write).

## Key API

```
GET  https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events
     ?timeMin={RFC3339}&timeMax={RFC3339}&singleEvents=true&orderBy=startTime
     &fields=items(id,summary,start,end,description,location,attendees,recurrence,colorId)
POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events
     Body: {summary, start: {dateTime, timeZone}, end: {dateTime, timeZone}, description, colorId}
GET  https://www.googleapis.com/calendar/v3/freeBusy
     Body: {timeMin, timeMax, items: [{id: calendarId}]}
PATCH https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}
DELETE https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}
Authorization: Bearer {oauth_token}
```

## Focus Time Analysis

When running focus time analysis (`calendar-flow-analyze-focus-time`), read events from all
configured calendars merged and sorted by start time. For each day:
1. Build a timeline of all events (start, end, duration, type)
2. Identify gaps of 90+ minutes with no scheduled events — these are qualifying focus windows
3. For each qualifying gap that falls within working hours (configurable; default 8am–6pm), count
   it as a focus block opportunity. If the day's calendar shows a gap was available but the agent
   cannot confirm it was used for deep work, note it as "available" (not "used")
4. Confirmed focus blocks come from: (a) events titled "Focus Time", "Deep Work", or similar
   that the agent or user created, or (b) user-reported focus time logged to the vault

## Event Classification

Classify each event by type to support focus time and schedule quality analysis:
- **Meeting**: 2+ attendees, or title contains "meeting / call / sync / standup / 1:1 / interview"
- **Focus block**: Created by calendar-agent, or title contains "focus / deep work / writing / coding"
- **Admin**: Title contains "review / plan / prep / admin / email" — 1 person, ≤30 minutes
- **Personal**: On personal calendar, or title contains "appt / doctor / gym / lunch / travel"
- **All-day / deadline**: All-day event — treated as a deadline marker or OOO day

## Focus Block Event Creation

When creating focus blocks as part of weekly agenda:
- Title: `Focus: {topic or domain}` — e.g., "Focus: Project work" or "Focus: Deep work"
- Color: Blueberry (colorId: 9) — visually distinct from meetings
- Description: Include the vault open-loop or OKR it addresses if known
- Duration: Minimum 90 minutes; prefer 2-3 hour blocks
- Placement: Mornings preferred (before 12pm) — protect from afternoon meeting creep
- Do not create focus blocks that overlap with existing events

## Used By

- `calendar-op-weekly-agenda` — read next 7 days of events across all calendars; create focus block events; write agenda to vault
- `calendar-op-focus-time-review` — read past 7 days of events to calculate qualifying focus blocks; compare against 8-hour weekly target
- `calendar-op-deadline-planning` — create deadline reminder events on the calendar for hard deadlines flagged in the vault
- `calendar-flow-analyze-focus-time` — merge multi-calendar event data for focus time calculation
- `calendar-flow-build-agenda` — use free/busy data to place focus blocks in the weekly schedule

## Vault Output

`~/Documents/aireadylife/vault/calendar/00_current/` — event summaries written after weekly reads
`~/Documents/aireadylife/vault/calendar/00_current/` — focus time audit records written by focus-time-review
