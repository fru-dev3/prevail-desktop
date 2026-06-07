---
name: aireadylife-social-task-update-open-loops
type: task
description: >
  Writes all social flags (overdue relationships, upcoming birthdays, promised follow-ups) to
  vault/social/open-loops.md and resolves completed items.
---

# aireadylife-social-update-open-loops

**Trigger:** Called by social ops and flows
**Produces:** Updated ~/Documents/aireadylife/vault/social/open-loops.md with current relationship action items

## What It Does

This task maintains vault/social/open-loops.md — the canonical list of relationship actions that need to happen. It handles both writing new flags and resolving completed ones, ensuring the file remains a clean, accurate, and actionable list rather than accumulating stale entries that undermine trust in the system.

**New flags written:** Three types of flags are managed by this task. (1) Overdue contact flags: written (or updated) when the relationship health flow identifies a contact who has crossed the overdue threshold for their tier — these are the most important flags in the social domain and get 🔴 (Tier 1 overdue) or 🟡 (Tier 2 and Tier 3 overdue) priority. (2) Birthday and milestone flags: written 7 days before the event (🟡) and 2 days before (🔴). These flags ensure the birthday alert surfaces in Chief morning briefs during the critical window. (3) Follow-up promise flags: written when social-task-log-interaction records a follow-up commitment. These appear as 🟡 items until the follow-up is logged as completed in the interaction log.

**Resolution logic:** On every call, the task scans all active open-loop items for resolution conditions. Overdue contact flag resolution: a new interaction has been logged in vault/social/00_current/ for that contact since the flag was written — the relationship is no longer overdue. Birthday flag resolution: the birthday date has passed (the window has closed — either the outreach happened or it didn't; either way, the flag is no longer actionable). Follow-up flag resolution: the interaction log for that contact has been updated with a "Follow-up status: Completed" entry for the specific promise. Each resolved item is marked `- [x]` with the resolution date and method.

**Priority ordering:** The file maintains the standard priority order: 🔴 items first (Tier 1 overdue contacts, birthdays within 2 days, overdue follow-up promises), then 🟡 items (Tier 2 overdue, birthdays in 3-7 days, active follow-up promises), then 🟢 items (Tier 3 overdue, birthday watch items 8-14 days out). Within each tier, items are sorted by urgency date.

**Archive management:** Resolved items older than 60 days are moved to vault/social/open-loops-archive.md to keep the active file manageable.

## Steps

1. Receive new flags from calling op (overdue contacts, birthday alerts, follow-up promises)
2. For each new flag: check for existing unresolved entry matching the same contact/event
3. If match: update escalation timestamp and days-since count; do not duplicate
4. If no match: append new flag in appropriate priority position
5. Scan all existing active flags for resolution conditions
6. For overdue contact flags: check vault/social/00_current/ for new interaction since flag date
7. For birthday flags: check whether the birthday date has passed
8. For follow-up flags: check interaction log for "Follow-up status: Completed" entry
9. Mark confirmed resolved items as `- [x]`; add resolution note and date
10. Move items resolved 60+ days ago to vault/social/open-loops-archive.md
11. Write updated file

## Input

- New flags from calling op
- ~/Documents/aireadylife/vault/social/open-loops.md (current state)
- ~/Documents/aireadylife/vault/social/00_current/ (for overdue and follow-up resolution checks)

## Output Format

vault/social/open-loops.md structure:
```markdown
# Social — Open Loops

_Last updated: YYYY-MM-DD_
_Read by: Chief plugin (morning brief), social-op-review-brief, social-op-relationship-review_

## Active
- [ ] 🔴 **Reach out to [Name]** — T1 Inner Circle — 122 days overdue — Phone call
  [reconnect context from last interaction]
  _flagged: 2026-04-13, escalation: 2 updates_

- [ ] 🔴 **Birthday: [Name]** — Apr 18 (in 5 days) — T1 — 45 days since contact
  Suggested: Phone call | Context: [relevant context]

- [ ] 🟡 **Reach out to [Name]** — T2 Close — 95 days overdue — Text or email
  [reconnect context]

- [ ] 🟡 **Follow-up: Send article on [topic] to [Name]** — Promised Apr 10
  [original context note]

- [ ] 🟢 **Birthday: [Name]** — Apr 26 (in 13 days) — T3 — Plan LinkedIn message

## Resolved
- [x] **Reach out to [Name]** — Resolved Apr 12 (called, caught up for 30 min)
- [x] **Birthday: [Name]** — Apr 7 — Resolved Apr 7 (sent birthday text)
```

## Configuration

No configuration required.

## Error Handling

- **open-loops.md missing:** Create with standard header before writing.
- **Resolution evidence ambiguous:** Leave flag active; note "Mark resolved manually after outreach."
- **File grows beyond 30 active items:** Flag: "Social open loops growing — schedule a monthly sync to process overdue contacts and close follow-up promises."

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/social/open-loops.md, ~/Documents/aireadylife/vault/social/00_current/
- Writes to: ~/Documents/aireadylife/vault/social/open-loops.md, ~/Documents/aireadylife/vault/social/open-loops-archive.md
