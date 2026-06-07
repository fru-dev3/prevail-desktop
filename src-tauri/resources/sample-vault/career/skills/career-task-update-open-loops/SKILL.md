---
name: aireadylife-career-task-update-open-loops
type: task
cadence: called-by-op
description: >
  Maintains vault/career/open-loops.md as the canonical list of outstanding career action items. Appends new flags from any career op run (comp gaps, follow-up reminders, stalled pipeline alerts, skills development priorities, outreach deadlines). Resolves and removes items that are no longer applicable. Called at the end of every career op.
---

## What It Does

The open-loops file is the career domain's single source of truth for what needs attention. Every op in the career domain writes its output flags here through this task. The daily brief system reads this file to surface career items to the user. Without this file staying current and clean, alerts pile up as noise and important items get buried.

**What gets appended:** Comp gap flags from the quarterly comp review (with severity and action plan), follow-up reminders from the pipeline review (company, role, contact, follow-up date), stalled opportunity decisions from the pipeline review (assertive follow-up / deprioritize / archive), skills development priorities from the quarterly skills gap review (skill name, demand %, recommended resource), outreach deadlines from the network review (contact name, message drafted, follow-up window), market alerts from the monthly market scan (notable company hiring surge, hiring freeze, comp range shift), and offer deadlines from any active offer in the pipeline.

**Flag structure:** Every flag entry has: a type label (COMP GAP / FOLLOW-UP / STALLED / SKILLS PRIORITY / OUTREACH / MARKET ALERT / OFFER DEADLINE), a severity or urgency level (urgent / watch / info), the specific action needed (not a vague description), a due date or action-by date, and a source op that generated the flag. This structure lets the daily brief system sort flags by urgency and lets the user make decisions without digging through multiple files.

**Resolution logic:** Before appending new flags, scans existing entries for items that should be resolved. Resolution conditions: a follow-up flag is resolved when a response from the company is logged in the pipeline entry; a comp gap flag is resolved when the vault shows a compensation change that closes the gap; a skills priority flag is resolved when the skill reaches working proficiency in the inventory; an outreach flag is resolved when the contact record shows the message was sent and either a response was received or the 14-day follow-up window has passed without response (the relationship re-engagement attempt is complete regardless of response). Resolved items are moved to a `[Resolved]` section at the bottom of the file or optionally archived to `vault/career/01_prior/open-loops-archive.md`.

**Priority ordering:** The file is organized by urgency: urgent items (offer deadlines, follow-ups due today) at the top, watch items (comp gaps, stalled opportunities) in the middle, info items (skills priorities, market alerts) at the bottom within each section.

## Steps

1. Receive list of new flags from calling op with type, severity, action, due date, and source.
2. Read current `vault/career/open-loops.md`.
3. Scan existing entries — identify items to resolve based on current vault state.
4. Move resolved items to `[Resolved]` section with resolution date and how it was resolved.
5. Append new flags in correct urgency section (urgent / watch / info).
6. Check for duplicates — if a flag of the same type and subject already exists, update rather than duplicate.
7. Re-sort file by urgency: offer deadlines → follow-up due today → comp gaps → stalled → skills → outreach → market alerts.
8. Write updated file back to `vault/career/open-loops.md`.
9. Return summary of changes: X new flags added, X items resolved, X items updated.

## Input

- Flags passed by calling op (new items to add)
- `~/Documents/aireadylife/vault/career/open-loops.md` — current state
- `~/Documents/aireadylife/vault/career/00_current/` — for follow-up resolution checks

## Output Format

`vault/career/open-loops.md` structure:

```
# Career Open Loops — Updated [YYYY-MM-DD]

## Urgent
- [OFFER DEADLINE] [Company] — [Role] — Expires [date] — Decide by [date]
- [FOLLOW-UP] [Company] — [Role] — Due [date] — [contact] — [message angle]

## Watch
- [COMP GAP] [Severity] — TC is $X below market P50 — Action: [plan]
- [STALLED] [Company] — [Role] — At [stage] for X days — Decision needed

## Info
- [SKILLS PRIORITY] [Skill] — X% demand — Resource: [course/platform]
- [MARKET ALERT] [Signal] — [implication]

## Resolved (last 30 days)
- [item] — Resolved [date] — [how]
```

## Configuration

No configuration required. File auto-created on first run if it does not exist.

## Error Handling

- **open-loops.md does not exist:** Create it with standard structure on first write.
- **Flag type not recognized:** Log with type "MISC" and note that the calling op sent an unrecognized flag type.
- **Resolution logic cannot determine status:** Leave item as open rather than incorrectly resolving it. Flag ambiguous items with a "Verify resolution" note.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/open-loops.md`, `~/Documents/aireadylife/vault/career/00_current/`
- Writes to: `~/Documents/aireadylife/vault/career/open-loops.md`
