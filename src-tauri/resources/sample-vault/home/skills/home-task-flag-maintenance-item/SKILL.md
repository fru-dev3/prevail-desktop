---
name: aireadylife-home-task-flag-maintenance-item
type: task
description: >
  Writes a maintenance flag to open-loops.md and creates a maintenance item record in
  vault/home/00_current/. Captures task description, location, urgency, last-serviced
  date, vendor, estimated cost, and target completion date. Used for both reactive repairs
  and proactive scheduled maintenance.
---

# aireadylife-home-flag-maintenance-item

**Trigger:** Called by home seasonal and review flows, or directly when the user reports a home issue
**Produces:** Maintenance item in `~/Documents/aireadylife/vault/home/00_current/` and flag in `~/Documents/aireadylife/vault/home/open-loops.md`

## What It Does

This task creates a structured maintenance record whenever a home issue is identified — whether reported by the user ("the garbage disposal stopped working"), discovered during a seasonal checklist review ("no record of gutter cleaning this fall"), or surfaced by the weekly review ("furnace inspection overdue"). It ensures every maintenance task, whether reactive or proactive, is captured, tracked, and visible until completed.

Each maintenance item record captures the complete context needed to manage the task from identification to completion. The task description uses a standard format: "{what is the issue} — {specific location in the home}" (e.g., "HVAC filter replacement — main unit, basement utility room" or "Slow drain — master bathroom sink"). This format enables filtering by location when multiple items exist across different areas.

The urgency classification drives how prominently the item appears in reviews and how quickly it escalates. Three levels are used:

- **Routine:** Scheduled preventive maintenance or cosmetic issue with no functional impact. Examples: HVAC filter replacement, caulk touch-up, deck stain check. Target completion: within 30 days. No immediate consequence to deferring a few weeks.
- **Urgent:** Functional issue affecting usability but not a safety emergency. Examples: garbage disposal not working, one bathroom drain slow, window won't lock, garage door slow to close. Target completion: within 14 days. Deferring more than 2 weeks allows the issue to worsen and may create secondary problems.
- **Emergency:** Safety risk or significant property damage in progress. Examples: active roof leak, no heat in winter, sewage backup, electrical burning smell, broken exterior lock, burst pipe. Target completion: 24–72 hours. Do not defer. For genuine emergencies, recommend calling a contractor immediately rather than waiting for the next review.

The last-serviced date is the most recent date the system or area involved was serviced, maintained, or inspected. This provides context for how recently the area was attended to — a slow drain in a bathroom that was last inspected 6 months ago may simply need a cleaning, while the same symptom in a bathroom not touched in 5 years may indicate a deeper plumbing issue.

Vendor info is pulled from config.md if a preferred vendor is assigned for the relevant service category. If none exists, this field is left blank with a note to use Angi or Thumbtack to find a rated local contractor.

## Steps

1. Collect task description, location, urgency from user or calling flow
2. Look up vendor in config.md for the relevant service category; populate if found
3. Set target completion date: routine = today + 30 days; urgent = today + 14 days; emergency = today + 3 days
4. Record last-serviced date if known (from maintenance history or user input)
5. Set estimated cost range from knowledge base or user-provided vendor quote
6. Write detailed item file to `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-DD-{issue-slug}.md`
7. Write condensed flag to `~/Documents/aireadylife/vault/home/open-loops.md`
8. If urgency is emergency: surface immediately in response with strong recommendation to call a contractor today

## Input

User or calling flow provides: task description, location, urgency, last-serviced date (if known), vendor (if known), estimated cost (if known)

## Output Format

**Maintenance item file:**
```markdown
# Maintenance: {Description}
**Location:** {specific location in home}
**Date Flagged:** YYYY-MM-DD
**Urgency:** {routine / urgent / emergency}
**Last Serviced:** YYYY-MM-DD or "unknown"
**Target Completion:** YYYY-MM-DD
**Status:** open

## Vendor
- Name: {vendor or "not assigned"}
- Phone/Email: {contact or "find via Angi/Thumbtack"}
- Quoted: {amount or "not yet"}

**Estimated Cost:** ${low}–${high}

## Notes
{Any additional context about the issue}
```

**Open loop flag:**
```
## [MAINTENANCE] — {Description} — {Urgency}
Date: YYYY-MM-DD | Due: YYYY-MM-DD | Est: $X | Status: open
```

## Configuration

Required in `~/Documents/aireadylife/vault/home/config.md`:
- Vendor assignments for auto-population: `hvac_vendor`, `plumber_vendor`, `electrician_vendor`, `gutter_vendor`, `pest_vendor`, `general_handyman`

## Error Handling

- If urgency cannot be determined: default to "urgent" and ask user to confirm
- If vendor for the service type is not in config: populate "not assigned — search Angi or Thumbtack for {service type} near {zip code}"
- If estimated cost is unknown: log $0 with note "Cost unknown — get vendor quote before scheduling"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/home/config.md` (vendor assignments)
- Writes to: `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-DD-{issue-slug}.md`
- Writes to: `~/Documents/aireadylife/vault/home/open-loops.md`
