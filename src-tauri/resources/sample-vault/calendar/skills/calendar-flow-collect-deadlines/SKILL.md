---
name: aireadylife-calendar-flow-collect-deadlines
type: flow
trigger: called-by-op
description: >
  Scans all installed plugin open-loops.md files and extracts items with explicit
  due dates within the next 60 days, sorted chronologically with urgent items
  (due within 7 days) flagged separately.
---

# aireadylife-calendar-collect-deadlines

**Trigger:** Called by `aireadylife-calendar-op-deadline-alert`, `aireadylife-calendar-op-weekly-agenda`, `aireadylife-calendar-op-deadline-planning`
**Produces:** Sorted list of cross-domain deadline items with urgency flags passed to the calling op

## What It Does

This flow is the deadline aggregation engine. It discovers all installed plugins by scanning ~/Documents/aireadylife/vault/ for subdirectories with an open-loops.md file, then reads each file and extracts every item that contains an explicit due date.

**Date extraction:** The flow parses due dates from two formats. ISO format (YYYY-MM-DD) is the primary format — if an open-loops item contains a date in this format, it is extracted as the due date. Natural language date phrases are also parsed: "by end of April" → last day of April, "this Friday" → the next upcoming Friday, "April 15" → April 15 of the current or next year (whichever is upcoming), "next quarter" → first day of next quarter. If a date phrase is ambiguous or cannot be parsed with confidence, the item is excluded from the deadline list and noted in the result as "unparseable date — excluded."

**60-day window:** Items with due dates beyond 60 days from today are excluded from the output to keep the result focused and actionable. Items at exactly 60 days are included. The 60-day limit can be overridden by the calling op if a longer horizon is needed (for example, the annual review op might request a 90-day window).

**Urgency tagging:** Each extracted item is tagged by urgency tier. Urgent: due in 0-7 days (surfaces immediately, no matter what else is in the list). Upcoming: 8-30 days (needs to be scheduled soon). Horizon: 31-60 days (on the radar; don't need action this week but should not disappear). Urgent items are returned first in the result list regardless of sort order, and the calling op is responsible for displaying them prominently.

**Hard deadline annotation:** The flow recognizes a set of known hard deadline patterns and annotates matching items automatically. Known hard deadlines include: April 15 (federal tax filing, Q1 estimated tax), June 15 (Q2 estimated tax), September 15 (Q3 estimated tax), January 15 (Q4 estimated tax), October 15 (federal tax extension deadline), state-specific tax filing dates (where the source domain's vault contains state information), and common insurance enrollment windows. Items matching these patterns receive a `hard_deadline: true` annotation so downstream ops can display them with the appropriate urgency emphasis.

## Steps

1. Scan ~/Documents/aireadylife/vault/ for subdirectories with open-loops.md files
2. For each discovered plugin: read open-loops.md; identify all items with a date field or date phrase
3. Parse ISO dates; parse natural language date phrases to ISO format
4. Exclude items with unparseable dates (note in result metadata)
5. Exclude items with due dates beyond 60 days (or calling op's specified window)
6. Tag each item: urgent (≤7 days), upcoming (8-30), horizon (31-60)
7. Annotate known hard deadlines (tax dates, enrollment windows)
8. Attach source domain label to each item
9. Sort: urgent items first (sorted by date), then upcoming (sorted by date), then horizon
10. Return sorted list with all metadata to calling op

## Input

- ~/Documents/aireadylife/vault/*/open-loops.md (all installed plugins)
- `vault/calendar/01_prior/` — prior period records for trend comparison

## Output Format

Returns structured list to calling op:
```
[
  { domain: "tax", item: "Q1 estimated payment", due_date: "2026-04-15", urgency: "urgent", hard_deadline: true, priority: "🔴" },
  { domain: "business", item: "LLC annual report", due_date: "2026-04-22", urgency: "upcoming", hard_deadline: false, priority: "🟡" },
  { domain: "benefits", item: "ESPP enrollment decision", due_date: "2026-05-08", urgency: "horizon", hard_deadline: false, priority: "🟢" },
  ...
  { metadata: { excluded_unparseable: 2, excluded_beyond_60_days: 1 } }
]
```

## Configuration

Optional override via calling op:
- `window_days` — extend beyond default 60-day window (e.g., 90 for annual review)
- `include_completed` — default false; set to true to include completed items for historical reporting

## Error Handling

- **No plugins have dated items:** Return empty list with note "No dated deadline items found across installed plugins."
- **open-loops.md missing for a plugin:** Skip that plugin; note in metadata.
- **Date parsing fails for an item:** Exclude item; increment `excluded_unparseable` count in metadata.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/*/open-loops.md
- Writes to: ~/Documents/aireadylife/vault/calendar/00_current/ (via calling op, not directly)
