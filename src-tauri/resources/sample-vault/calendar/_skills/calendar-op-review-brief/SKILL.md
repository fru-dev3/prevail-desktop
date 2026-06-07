---
name: aireadylife-calendar-op-review-brief
type: op
cadence: weekly
description: >
  Weekly calendar brief. Surfaces upcoming deadlines, focus time health, and scheduling flags.
  Triggers: "calendar brief", "what's due this week", "deadline check", "focus time", "schedule review".
---

# aireadylife-calendar-review-brief

**Cadence:** Weekly (Monday morning)
**Produces:** Weekly calendar brief written to ~/Documents/aireadylife/vault/calendar/02_briefs/week-YYYY-WNN.md

## What It Does

The calendar review brief is the weekly summary document for the entire calendar domain — a single concise briefing that captures deadline status, focus time health, and scheduling quality for the week. It is designed to be read in under 3 minutes and to answer three questions: What must I do this week? Do I have time to do it? Is anything broken in my schedule that needs fixing?

The brief reads the most recent focus time audit from vault/calendar/00_current/ (or runs a quick calculation if no recent audit exists) to produce a focus health summary for the prior week. It pulls the upcoming 30-day deadline list from vault/calendar/00_current/ and shows items due within the next 14 days as an action-required section, with items 15-30 days out as a horizon section. It reads vault/calendar/open-loops.md for any persistent calendar-domain flags (recurring focus deficits, unscheduled priority items, approaching deadlines without prep plans).

If gcalendar is configured, it also performs a quick meeting audit for the coming week: total scheduled meeting hours, back-to-back clusters count, and projected qualifying focus time. This gives the user a forward-looking health score alongside the retrospective.

The output is written to vault/calendar/02_briefs/ with the ISO week number in the filename (week-YYYY-WNN.md) so weekly briefs accumulate in a sortable, searchable archive.

## Triggers

- "calendar brief"
- "what's due this week"
- "deadline check"
- "focus time"
- "schedule review"
- "calendar update"
- "weekly calendar summary"

## Steps

1. Verify vault/calendar/ exists; if missing, stop and prompt setup
2. Read most recent focus audit from vault/calendar/00_current/ (within past 8 days)
3. If no recent focus audit: run quick calculation from gcalendar data (past 7 days)
4. Read vault/calendar/00_current/ for items due within 30 days; group by urgency tier
5. Read vault/calendar/open-loops.md for persistent calendar flags
6. If gcalendar configured: read upcoming week's events; calculate projected focus time
7. Assemble brief: focus summary + deadline table (14-day + horizon) + open loops + upcoming forecast
8. Write to vault/calendar/02_briefs/week-YYYY-WNN.md
9. Return formatted brief to user

## Input

- ~/Documents/aireadylife/vault/calendar/00_current/ (most recent focus audit)
- ~/Documents/aireadylife/vault/calendar/00_current/ (deadline registry)
- `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/calendar/open-loops.md
- Google Calendar upcoming week (via gcalendar, optional)

## Output Format

```
# Calendar Brief — Week [WNN], [Year]

## Focus Health (Past Week)
Qualifying focus hours: [N]h / 8h target — [Tier: Healthy / Marginal / Deficit / Critical]
Primary issue: [if deficit, specific cause — e.g., "Wednesday all-day meeting cluster"]

## Action Required (≤14 days)
| Item                        | Domain   | Due Date   | Days Left | Status              |
|-----------------------------|----------|------------|-----------|---------------------|
| Q1 estimated payment        | tax      | Apr 15     | 2         | ⚠️ No prep found    |
| Annual report filing        | business | Apr 22     | 9         | 🟡 Prep needed      |

## Horizon (15-30 days)
| Item                        | Domain   | Due Date   | Days Left |
|-----------------------------|----------|------------|-----------|
| ESPP enrollment decision    | benefits | May 8      | 25        |

## Open Calendar Loops
- 🟡 Focus deficit 2 consecutive weeks → Recommend meeting audit this week
- 🔴 Q1 tax payment due Apr 15 — no prep logged in tax vault

## Upcoming Week Forecast (if gcalendar configured)
Meetings scheduled: [N]h | Projected focus: [N]h | Status: [Tier]
At-risk days: [days with <2h focus]
```

## Configuration

- vault/calendar/config.md with gcal credentials (optional for focus forecast)

## Error Handling

- **No focus audit in vault/calendar/00_current/ within past 8 days:** Note "Run calendar-op-focus-time-review for detailed focus analysis." Still produce deadline and open loops sections.
- **vault/calendar/00_current/ empty:** Note "No deadlines registered. Run calendar-op-deadline-alert to scan all installed plugins."
- **gcalendar not configured:** Skip upcoming week forecast section; show "Connect Google Calendar for forward-looking focus forecast."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/calendar/00_current/, ~/Documents/aireadylife/vault/calendar/00_current/, ~/Documents/aireadylife/vault/calendar/open-loops.md
- Writes to: ~/Documents/aireadylife/vault/calendar/02_briefs/week-YYYY-WNN.md
