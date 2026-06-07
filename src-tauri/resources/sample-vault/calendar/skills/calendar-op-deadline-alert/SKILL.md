---
name: aireadylife-calendar-op-deadline-alert
type: op
cadence: weekly
description: >
  Weekly deadline alert. Flags all obligations due within 30 days across all installed plugins.
  Triggers: "deadline alert", "what's due", "upcoming deadlines", "30-day deadlines".
---

# aireadylife-calendar-deadline-alert

**Cadence:** Weekly (Monday)
**Produces:** 30-day deadline alert report written to ~/Documents/aireadylife/vault/calendar/00_current/alert-YYYY-MM-DD.md

## What It Does

The deadline alert op is the cross-domain early warning system — a weekly scan that surfaces every time-bound obligation across all installed plugins and organizes them by urgency. Its purpose is to ensure no deadline arrives without advance notice and no preparation window is wasted.

The op calls `calendar-flow-collect-deadlines` to scan the open-loops.md from every installed plugin vault (tax, benefits, estate, insurance, career, vision, social, explore, records, etc.) and extract all items that contain an explicit due date. Dates are parsed from both ISO format (YYYY-MM-DD) and natural language phrases ("by end of April," "this Friday," "April 15"). Items beyond 60 days are excluded to keep the report actionable.

**Urgency categorization:** Items are sorted into three urgency tiers:
- **Urgent (0-7 days):** Requires immediate action or preparation start. These are 🔴 items. Any urgent item that has no logged preparation activity in the source domain's vault is additionally flagged as "no prep started" — a critical signal that the window for comfortable preparation has closed.
- **Soon (8-14 days):** Must be scheduled and started this week. These are 🟡 items. The report includes a recommended preparation start date for each (typically 3-5 days before the deadline depending on effort estimate).
- **Upcoming (15-30 days):** On radar; plan ahead. These are 🟢 items that need to be captured in the weekly agenda's deferred section so they transition to "soon" without being forgotten.

**Preparation check:** For each urgent and soon-tier item, the op reads the source domain's vault for evidence of preparation activity — milestones logged, sub-tasks completed, documents filed, payments made. If an item is in the urgent tier (≤7 days) with no preparation evidence logged anywhere in its source domain, it is flagged with "Action required today — no preparation found." This is the most important signal in the entire report.

**Hard vs. soft deadline annotation:** Hard deadlines (IRS dates, legal filings, contract renewals, insurance enrollment windows) are annotated as hard in the report. The op knows the common hard deadline calendar for domains: April 15 (federal tax), state tax filing dates (varies), quarterly IRS estimated tax dates (April 15, June 15, September 15, January 15), Medicare enrollment windows (3 months before to 3 months after birthday month for Part B), LLC annual report deadlines (varies by state), benefit open enrollment (typically November for employer plans). Any item matching these patterns gets automatic hard-deadline annotation.

## Triggers

- "deadline alert"
- "what's due"
- "upcoming deadlines"
- "30-day deadlines"
- "what do I owe"
- "deadline check"

## Steps

1. Verify vault/calendar/config.md exists; if missing, stop and prompt setup
2. Call `calendar-flow-collect-deadlines` to extract all dated items from every installed plugin vault
3. Filter to items due within 60 days; exclude items beyond 60 days
4. Categorize by tier: urgent (≤7), soon (8-14), upcoming (15-30)
5. For urgent and soon items: check source domain vault for preparation activity evidence
6. Flag urgent items with no preparation as "Action required today — no prep found"
7. Annotate known hard deadlines (tax dates, legal filings, enrollment windows)
8. For each soon/upcoming item: calculate recommended preparation start date
9. Write deadline items missing from vault/calendar/00_current/ via `calendar-task-add-deadline`
10. Write full alert report to vault/calendar/00_current/alert-YYYY-MM-DD.md
11. Call `calendar-task-update-open-loops` to write any new 🔴 items to calendar open-loops.md
12. Return formatted deadline alert to user as chat output

## Input

- ~/Documents/aireadylife/vault/*/open-loops.md (all installed plugins)
- ~/Documents/aireadylife/vault/calendar/00_current/ (existing deadline records)
- `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/calendar/config.md

## Output Format

```
# 30-Day Deadline Alert — [Date]

## 🔴 Urgent (0-7 days)
| Item                           | Domain   | Due Date   | Days Left | Prep Status         |
|--------------------------------|----------|------------|-----------|---------------------|
| Q1 estimated tax payment       | tax      | Apr 15     | 2         | ⚠️ No prep found    |
| Insurance renewal confirmation | insurance| Apr 18     | 5         | ✅ Renewal submitted |

## 🟡 Soon (8-14 days)
| Item                           | Domain   | Due Date   | Days Left | Start Prep By  |
|--------------------------------|----------|------------|-----------|----------------|
| Annual LLC report filing       | business | Apr 22     | 9         | Apr 17         |

## 🟢 Upcoming (15-30 days)
| Item                          | Domain  | Due Date   | Days Left |
|-------------------------------|---------|------------|-----------|
| ESPP enrollment decision      | benefits| May 8      | 25        |
| Lease renewal review          | estate  | May 10     | 27        |
```

## Configuration

Required in vault/calendar/config.md:
- `installed_plugins` — for plugin discovery (or auto-discovered)

## Error Handling

- **No dated items found in any plugin:** Return "No dated deadlines found across installed plugins. If you have upcoming obligations, add due dates to relevant open loop items."
- **Date parsing fails (ambiguous natural language):** Treat as undated; note "Undated items excluded from deadline alert — add explicit dates."
- **Source domain vault missing for preparation check:** Skip preparation check for that item; note "Preparation status unknown — source vault not accessible."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/calendar/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/*/open-loops.md, ~/Documents/aireadylife/vault/calendar/00_current/
- Writes to: ~/Documents/aireadylife/vault/calendar/00_current/alert-YYYY-MM-DD.md, ~/Documents/aireadylife/vault/calendar/open-loops.md
