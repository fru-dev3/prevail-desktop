---
name: aireadylife-calendar-op-deadline-planning
type: op
cadence: on-demand
description: >
  On-demand deadline planner; given a deadline date and task scope, works backward
  from the due date to create a preparation schedule with milestones, effort estimates,
  and calendar placement recommendations.
  Triggers: "plan deadline", "work backward from deadline", "deadline prep".
---

# aireadylife-calendar-deadline-planning

**Cadence:** On-demand (any time the user provides a new deadline to plan for)
**Produces:** Milestone preparation schedule in ~/Documents/aireadylife/vault/calendar/00_current/YYYY-MM-DD-{slug}.md

## What It Does

Deadline planning is the reverse-engineering op — the user provides a due date and a description of what needs to be done, and this op builds a detailed backward-mapped preparation schedule from that deadline to today. Its purpose is to make the abstract concrete: "the deadline is 18 days away" becomes "you need to start the research phase by Thursday, draft by next Tuesday, finalize by the Friday before the deadline."

**Effort classification:** The op first classifies the task by effort tier based on the user's description. Tier 1 (Light, 1-3 hours): simple tasks like making a payment, filing a short form, scheduling an appointment. Tier 2 (Moderate, 4-8 hours): tasks like completing a benefits enrollment review, gathering documents for a filing, researching a decision. Tier 3 (Heavy, 8-20 hours): complex tasks like preparing a tax return, executing an estate plan update, completing a financial review. Tier 4 (Major, 20+ hours): projects like purchasing a property, launching a business entity, completing a major legal filing.

**Milestone generation:** Based on effort tier and the number of days until the deadline, the op generates specific named milestones between now and the due date. Standard milestone types: Research/Gather (collect inputs, documents, information), Draft/Prepare (create the deliverable), Review/Verify (confirm accuracy, catch errors), Finalize/Submit (complete and submit). Each milestone gets an assigned date, effort estimate in hours, and a dependency relationship (finalize cannot happen before review, review cannot happen before draft, etc.).

**Runway assessment:** The op compares the total effort estimate against the number of available non-meeting hours between now and the deadline (pulling from Google Calendar if configured). If the effort required exceeds the realistically available focused hours, it flags this clearly: "This task requires approximately 6 hours of focused work. Based on your calendar, you have 5.5 hours of available focus windows before the deadline. This is tight — here are the specific slots to block immediately."

**Integration with weekly agenda:** After generating the milestone schedule, the op calls `calendar-task-add-deadline` to register the main deadline in vault/calendar/00_current/ so it surfaces automatically in every subsequent weekly agenda scan and deadline alert. The milestone dates are also written as sub-items so future agenda builds can show milestone preparation dates, not just the final due date.

## Triggers

- "plan deadline"
- "work backward from deadline"
- "deadline prep"
- "create a prep schedule"
- "help me plan for [task] by [date]"
- "how do I prepare for [deadline]"

## Steps

1. Receive deadline date and task description from user
2. Calculate days remaining from today to deadline
3. Classify task by effort tier (Light / Moderate / Heavy / Major) based on description
4. Assign total effort estimate in hours for the effort tier
5. If gcalendar configured: read calendar for available focus windows between now and deadline
6. Compare effort estimate to available focused hours; flag if runway is insufficient
7. Generate milestone schedule with named phases, dates, effort estimates, and dependencies
8. Assign each milestone to a specific recommended calendar date and time slot (if calendar data available)
9. Call `calendar-task-add-deadline` to register the deadline in vault/calendar/00_current/
10. Write milestone schedule to vault/calendar/00_current/YYYY-MM-DD-{slug}.md
11. Write deadline item to vault/calendar/open-loops.md via `calendar-task-update-open-loops`
12. Return formatted preparation schedule to user

## Input

- User-provided: deadline date, task description
- Google Calendar (via gcalendar, optional): available focus windows between now and deadline
- ~/Documents/aireadylife/vault/calendar/config.md
- `vault/calendar/01_prior/` — prior period records for trend comparison

## Output Format

```
# Deadline Plan: [Task Name]
**Due:** [Month DD, YYYY] ([N] days remaining)
**Effort tier:** [Tier] — estimated [N] hours total

## Runway Assessment
Available focused hours before deadline: [N]h ([sufficient/tight/insufficient])
[If tight/insufficient: "Recommended: block these specific slots immediately — [list]"]

## Milestone Schedule
| Phase           | Date      | Effort | Action                              |
|-----------------|-----------|--------|-------------------------------------|
| Research/Gather | [Date]    | [N]h   | [Specific action for this task]     |
| Draft/Prepare   | [Date]    | [N]h   | [Specific action for this task]     |
| Review/Verify   | [Date]    | [N]h   | [Specific action for this task]     |
| Finalize/Submit | [Date]    | [N]h   | [Specific action for this task]     |
| Buffer          | [Date-1]  | —      | Final check; submit on deadline day |

## Calendar Placement (if gcalendar configured)
- [Date, time slot]: [Phase — N hours]
- [Date, time slot]: [Phase — N hours]

## Vault Record
Deadline registered at: vault/calendar/00_current/[YYYY-MM-DD-slug].md
Will surface in: weekly agenda, 30-day deadline alert
```

## Configuration

Required in vault/calendar/config.md:
- `gcal_primary_calendar_id` — optional; enables runway calculation with actual calendar data
- `focus_block_minimum_minutes` — default 90; defines qualifying focus window for runway calculation

## Error Handling

- **No deadline date provided:** Ask: "What is the due date for this task?"
- **No task description provided:** Ask: "What needs to be done before the deadline?"
- **Deadline is in the past:** Note "This deadline has already passed. Log completion or update the date."
- **Deadline within 48 hours:** Mark as critical. Generate condensed 1-2 milestone plan with immediate action emphasis. Note remaining window explicitly.
- **gcalendar not configured:** Skip runway calculation; still produce the milestone schedule without calendar placement.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records
- Reads from: Google Calendar (optional, via gcalendar), ~/Documents/aireadylife/vault/calendar/config.md
- Writes to: ~/Documents/aireadylife/vault/calendar/00_current/YYYY-MM-DD-{slug}.md, ~/Documents/aireadylife/vault/calendar/open-loops.md
