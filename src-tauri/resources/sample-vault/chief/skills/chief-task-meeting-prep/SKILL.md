---
name: prevail-chief-task-meeting-prep
type: task
cadence: on-demand
description: >
  Drafts a one-page meeting prep brief for an upcoming meeting. Pulls
  context from prior meetings with the same attendees, your last update
  to them, the relevant domain's state.md, and any open loops involving
  them. Output is a structured brief: context · objective · agenda ·
  asks · what could go wrong. Triggers: "meeting prep for X", "prep
  for tomorrow's 9am", "what should I know about this meeting".
---

# chief-task-meeting-prep

**Cadence:** On-demand (typically 30-60 min before the meeting)
**Produces:** `vault/chief/00_current/meeting-prep-<slug>.md`

## What It Does

User asks for prep on a specific calendar event. Skill reads:

1. The event from Google Calendar (title, attendees, time, location, agenda
   if present)
2. Prior meetings with the same attendees (search `vault/*/state.md` and
   `_log/` for their names)
3. The relevant domain's current state — if attendee `cc@anthropic.com`
   maps to a contract review in `career/`, pull that
4. Any open loops mentioning the same people or topics

Output structure (max 1 printed page):

```markdown
# <meeting title> — <date time>

## Attendees
- Name (role) — last interacted YYYY-MM-DD, you owe them: <thing>

## Context (3 sentences)
What this meeting is about. What was decided last time. What changed.

## Your objective
The one outcome you want.

## Agenda (proposed)
1. ...
2. ...

## Specific asks
- ...

## What could derail this
- ...

## Open loops they're tracking with you
- [career] follow up on offer terms
- [business] LLC operating agreement Q
```

## Inputs

- Specific calendar event (user supplies title, time, or "next meeting")
- All domain `state.md` files (for name/topic search)
- All `_log/YYYY-MM-DD.md` files for prior interactions
- `vault/chief/00_current/stakeholder-map.md` for attendee context

## Outputs

- `vault/chief/00_current/meeting-prep-<slug>.md` (overwrites on re-run)
