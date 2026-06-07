---
name: prevail-chief-op-daily-brief
type: op
cadence: daily
description: >
  Morning briefing for the day ahead. Pulls today's calendar events, the
  top 3 open loops across every life domain, any decisions pending input,
  weather forecast, and overnight changes in tracked metrics (PR queue,
  inbox, stock movers). Produces a 5-minute read-before-coffee summary.
  Triggers: "daily brief", "morning brief", "what's my day look like",
  "what should I know this morning", "good morning brief".
---

# chief-op-daily-brief

**Cadence:** Daily (06:30 local)
**Produces:** `vault/chief/00_current/daily-brief-YYYY-MM-DD.md`; delivers a copy to Telegram if the daemon is running.

## What It Does

Reads from every domain's `state.md` + `open-loops.md` and assembles ONE
markdown page that answers: *what do I need to know before the day
starts?*

Sections (in this order, top→bottom by reader priority):

1. **One-line headline** — the single most important thing today
2. **Calendar** — today's events with time + location + attendees
3. **Top 3 priorities** — from `chief-flow-cross-domain-priorities` output
4. **Pending decisions** — from `chief-flow-decision-tracker` output (any past
   their decision-by date go to the top, red-flagged)
5. **Overnight metrics** — PR queue Δ, unread email count, stock movers
   if `wealth` connector is configured
6. **Weather + commute** — if location is known

## How to run

`/skill chief-op-daily-brief` in the chief chat, or wait for the daemon's
06:30 trigger. Or schedule it: `prevail briefing add --cron "30 6 * * *"
--domain chief --prompt "run the daily brief skill"`.

## Inputs

- Every domain's `state.md` + `open-loops.md`
- `vault/calendar/00_current/today.md` if Google Calendar connector is wired
- `vault/wealth/data/` if Plaid connector has synced

## Outputs

- `vault/chief/00_current/daily-brief-YYYY-MM-DD.md` (replace each morning)
- One bullet appended to `vault/chief/_log/YYYY-MM-DD.md` noting the brief ran
