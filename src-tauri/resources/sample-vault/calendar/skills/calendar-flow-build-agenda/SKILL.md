---
name: aireadylife-calendar-flow-build-agenda
type: flow
trigger: called-by-op
description: >
  Builds a week-ahead agenda combining cross-domain deadlines, calendar events,
  and priority open loops — then suggests 2-3 focus blocks for deep work items.
---

# aireadylife-calendar-build-agenda

**Trigger:** Called by `aireadylife-calendar-op-weekly-agenda`
**Produces:** Structured week-ahead agenda document written to ~/Documents/aireadylife/vault/calendar/00_current/YYYY-MM-DD-week-agenda.md

## What It Does

This flow receives pre-collected inputs from the calling op — deadline items, calendar event data, and high-priority open loops — and assembles them into a complete, ranked weekly agenda document. It is a formatting and prioritization engine, not a data-collection layer.

**Ranking algorithm:** All items requiring action this week are ranked using four priority levels. Level 1: items due this week with hard deadlines (tax filings, enrollment windows, legal filings) — must be done, no flexibility. Level 2: items due this week with soft deadlines (monthly reviews, personal milestones, project deadlines) — important, plan them early in the week. Level 3: items due next week that require preparation this week (research phase, gathering documents, drafting) — must start this week even though the deadline is next week. Level 4: items with no immediate deadline that are blocking other work or that have been on the open loops list for 3+ weeks — make progress this week.

**Focus block placement:** The flow identifies the 2-3 items from Levels 1-3 that require the most uninterrupted cognitive time (based on effort estimates in the source domain open-loops items or inferred from the item type). For each identified deep-work item, it selects the most suitable available calendar slot from the focus time analysis data provided by the calling op. Slot selection criteria: prefer days with 90+ minute available blocks, prefer morning slots over afternoon for complex analytical work, prefer days with fewer total meetings. The result is a Focus Block Calendar table in the agenda document — not a commitment, but a concrete time-allocation proposal for the user to act on.

**Deferred section:** Items that were found in the domain open-loops scan but don't need attention this week are listed in a deferred section with a "next review date" annotation. This ensures they don't disappear — they're acknowledged and scheduled for future review rather than silently dropped.

**Monday intent:** The flow synthesizes a one-sentence "Monday Intent" — a plain-language statement of what this week is fundamentally about given the top priorities and deadline demands. Example: "This week is about clearing the Q1 tax obligation and protecting Thursday morning for the estate planning review."

## Steps

1. Receive: deadline items (sorted by urgency), calendar event data, high-priority open loops from calling op
2. Classify items into Level 1-4 priority ranking
3. Select Levels 1-4 items for the active agenda section; defer any items not requiring action this week
4. Identify 2-3 deepest-work items requiring 90+ minute focus blocks
5. Match deep-work items to available focus slots from calendar data (prefer morning, 90+ min, low-meeting days)
6. Write Monday Intent sentence synthesizing the week's primary theme
7. Assemble agenda: Monday Intent → Deadline table → Priority list (with effort estimates) → Focus Block Calendar → Deferred items → Friday Review placeholder
8. Return formatted document to calling op for vault write

## Input

- Deadline items list (from calendar-flow-collect-deadlines, via calling op)
- Calendar event data and available focus slots (from calendar-flow-analyze-focus-time, via calling op)
- High-priority open loops from all installed plugins (via calling op)
- `vault/calendar/01_prior/` — prior period records for trend comparison

## Output Format

```
# Week of [Month DD, YYYY] — Agenda

## Monday Intent
[One clear sentence about the week's primary theme and purpose]

## This Week's Deadlines
| Day       | Domain    | Item                           | Due Date | Level | Est. Effort |
|-----------|-----------|--------------------------------|----------|-------|-------------|
| Monday    | tax       | Q1 estimated payment           | Apr 15   | 1     | 1h          |
| Wednesday | business  | LLC report filing              | Apr 22   | 2     | 3h          |

## Top Priorities (Require Action This Week)
1. **[Item]** — [Domain] — Level [N] — Est. [N]h — [Why this week]
2. **[Item]** — [Domain] — Level [N] — Est. [N]h — [Why this week]
3. **[Item]** — [Domain] — Level [N] — Est. [N]h — [Why this week]

## Focus Block Calendar (Proposed)
| Day       | Time Window        | Length | Assigned To         |
|-----------|--------------------|--------|---------------------|
| Tuesday   | 09:00–11:30        | 2.5h   | [Priority #1]       |
| Thursday  | 13:30–16:00        | 2.5h   | [Priority #2]       |

## Deferred (On Radar — Not This Week)
- [Item] — [Domain] — Next review: [Date]
- [Item] — [Domain] — Next review: [Date]

## Friday Review
[Leave blank — fill in Friday to capture wins and carryovers]
```

## Configuration

- `focus_block_minimum_minutes` from vault/calendar/config.md — default 90
- `work_start_time`, `work_end_time` — for slot selection boundaries

## Error Handling

- **No focus slot data available (gcalendar not configured):** Produce agenda without Focus Block Calendar; note "Configure Google Calendar to get focus block placement recommendations."
- **Fewer than 3 Level 1-3 items:** Promote the highest Level 4 items to fill the priorities section.
- **All items are deferred (no urgent or important work this week):** Note "No urgent or important items this week — this is a maintenance week. Use the time for backlog clearance or vision planning."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records
- Reads from: inputs passed by calling op (no direct vault reads)
- Writes to: ~/Documents/aireadylife/vault/calendar/00_current/YYYY-MM-DD-week-agenda.md (via calling op)
