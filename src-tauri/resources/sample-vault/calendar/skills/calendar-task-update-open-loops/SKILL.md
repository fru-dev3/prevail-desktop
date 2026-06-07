---
name: aireadylife-calendar-task-update-open-loops
type: task
description: >
  Writes calendar flags (upcoming deadline clusters, focus time deficits, unscheduled
  high-priority items) to vault/calendar/open-loops.md and resolves completed items.
---

# aireadylife-calendar-update-open-loops

**Produces:** Updated ~/Documents/aireadylife/vault/calendar/open-loops.md with new flags added and resolved items marked complete

## What It Does

This task is the maintenance operator for vault/calendar/open-loops.md — the canonical source of truth for calendar-domain flags that surfaces in every Chief brief cycle. It handles both writing new flags and resolving completed ones, keeping the file accurate and clean rather than letting it accumulate stale entries.

**New flags written:** When called by any calendar op, this task appends flags for: (1) deadline clusters — multiple items due within the same 3-day window that together require more focused hours than the calendar provides in that window; (2) focus time deficits — weeks where qualifying focus time falls below 6 hours (🟡) or below 4 hours (🔴); (3) unscheduled high-priority items — items from the current week's agenda that have no focus block slot assigned despite requiring deep work; (4) overdue preparation starts — items from the deadline registry where the recommended preparation start date has passed without evidence of action.

**Resolution logic:** On every call, the task also scans all existing open-loop items in the file for resolution conditions. An item is marked resolved (checked checkbox: `- [x]`) when: the deadline has passed AND the source domain shows a completion record, OR the focus time deficit week has ended and the user confirmed the work was completed despite the deficit, OR the high-priority item was logged as completed in its source domain, OR the user explicitly marks the item as done in conversation. The task does not resolve items automatically without evidence — it checks the source domain's vault for confirmation before marking complete.

**File format discipline:** The file uses a consistent checkbox format throughout: `- [ ]` for unresolved items and `- [x]` for resolved items. Each item includes a priority emoji (🔴/🟡/🟢), the item description, the domain tag, relevant dates (flagged date, due date), and any escalation notes. Resolved items are moved to the bottom of the file rather than deleted, so the file's history is preserved. Items resolved more than 90 days ago are archived to vault/calendar/open-loops-archive.md to keep the active file manageable.

## Steps

1. Receive new flags list from calling op (deadline clusters, deficits, unscheduled priorities)
2. For each new flag: check if an existing unresolved entry matches the same item
3. If match found: update existing entry with escalation note; do not duplicate
4. If no match: append new flag entry at the top of the unresolved section
5. Scan all existing unresolved entries for resolution conditions
6. For each resolvable entry: verify completion in source domain vault
7. If completion confirmed: mark as `- [x]`; move to resolved section at bottom of file
8. Archive entries resolved 90+ days ago to vault/calendar/open-loops-archive.md
9. Write updated file back to vault/calendar/open-loops.md

## Input

- New flag data from calling op
- ~/Documents/aireadylife/vault/calendar/open-loops.md (current state)
- Source domain vaults (for resolution verification)

## Output Format

File structure of vault/calendar/open-loops.md:
```markdown
# Calendar — Open Loops

_Last updated: YYYY-MM-DD_

## Active
- [ ] 🔴 **tax — Q1 estimated payment** — Due: Apr 15 (2 days) — No prep found — flagged 2026-04-13
- [ ] 🟡 **Focus deficit — Week of Apr 7** — 5.5h qualifying focus (target 8h) — flagged 2026-04-11
- [ ] 🟡 **Unscheduled: estate planning review** — No focus block assigned this week — flagged 2026-04-13

## Resolved
- [x] 🟡 **benefits — HSA contribution review** — Resolved 2026-04-08 (deduction increased)
```

## Configuration

No configuration required.

## Error Handling

- **open-loops.md missing:** Create new file with standard header before writing.
- **Source domain vault inaccessible for resolution check:** Leave item as unresolved; do not guess at completion status.
- **File grows beyond 50 active items:** Flag: "Calendar open loops growing — consider running deadline-planning op to process and close items."

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/calendar/open-loops.md, source domain vaults (for resolution verification)
- Writes to: ~/Documents/aireadylife/vault/calendar/open-loops.md, ~/Documents/aireadylife/vault/calendar/open-loops-archive.md
