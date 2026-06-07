---
name: aireadylife-home-task-update-open-loops
type: task
description: >
  Writes all home flags (overdue maintenance, budget overruns, expiring warranties, renewal
  deadlines) to open-loops.md and resolves completed items. Maintains the home domain's
  canonical action list readable by calendar and morning brief routing.
---

# aireadylife-home-update-open-loops

**Trigger:** Called by home ops and flows at the end of every run
**Produces:** Updated `~/Documents/aireadylife/vault/home/open-loops.md` with current action items

## What It Does

This task maintains the home domain's open-loops file as the single list of outstanding home action items. Every home op writes its flags here; this file is the persistent watchlist that keeps maintenance tasks, budget overruns, and renewal deadlines visible between weekly and monthly reviews.

Flags written to open-loops.md fall into the following categories, each with urgency classification:

**Critical:** Emergency maintenance item (safety risk) with no vendor action logged within 72 hours. No heat in winter. Active roof leak. Electrical hazard.

**High:** Urgent maintenance item (functional issue) overdue more than 7 days. Home insurance renewal within 14 days without renewal confirmed. Significant budget overrun (>40% over budget in any single category). Lease expiration within 14 days (if renting) without renewal signed.

**Medium:** Routine maintenance item overdue by more than 15 days. Seasonal task due within 7 days with no appointment or completion record. Budget overrun (>20% over budget) in any category. Insurance renewal within 30–60 days. Vendor follow-up stale for 7+ days. Appliance or HVAC warranty expiring within 60 days.

**Monitor:** Home value not updated in 12+ months. Upcoming seasonal maintenance period approaching (30 days before the new season starts). Repair cost accumulation on a single system approaching 50% of replacement cost.

Each flag entry includes: the category, a short title, the full description with financial context (cost estimate, risk if unaddressed), a recommended action with enough detail to execute, and an action-by date. The action-by date is calibrated to the urgency: critical items have today or tomorrow as action-by; medium items have a date within 2 weeks.

On every run, the task evaluates existing open items against current vault data. Resolved conditions: a maintenance item marked completed in the maintenance folder, a budget overage that corrected itself in the next month's data, an insurance renewal that was confirmed paid. Resolved items are moved to `~/Documents/aireadylife/vault/home/open-loops-archive.md`.

The open-loops file format uses consistent section headers so the calendar agent can parse action-by dates and surface them in the weekly calendar brief.

## Steps

1. Receive flag data from calling op (category, title, description, financial context, action, urgency, action-by date)
2. Read existing `~/Documents/aireadylife/vault/home/open-loops.md`; check for duplicate flags
3. If duplicate: update timestamp and context rather than creating a duplicate entry
4. If new: append structured flag entry with all fields
5. Scan existing open items against current vault data for resolved conditions
6. Move resolved items to `~/Documents/aireadylife/vault/home/open-loops-archive.md` with resolution date and outcome
7. Return summary to calling op: total open items by urgency

## Input

- Flag data from calling op
- `~/Documents/aireadylife/vault/home/open-loops.md` — existing flags
- `~/Documents/aireadylife/vault/home/00_current/` — for maintenance flag resolution check
- `~/Documents/aireadylife/vault/home/00_current/` — for budget flag resolution check

## Output Format

Each entry in open-loops.md:
```markdown
## [CATEGORY] — [Short Title] — [URGENCY]
**Date:** YYYY-MM-DD
**Description:** {full description with financial context}
**Action:** {recommended action}
**Action by:** YYYY-MM-DD
**Status:** open
```

Summary to calling op: "X items in open loops (Y critical, Z high, W medium, V monitor)"

## Configuration

No additional configuration required.

## Error Handling

- If open-loops.md does not exist: create it with the first entry
- If open-loops-archive.md does not exist: create it when the first item is resolved

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/home/open-loops.md`
- Reads from: `~/Documents/aireadylife/vault/home/00_current/`, `02_expenses/`
- Writes to: `~/Documents/aireadylife/vault/home/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/home/open-loops-archive.md`
