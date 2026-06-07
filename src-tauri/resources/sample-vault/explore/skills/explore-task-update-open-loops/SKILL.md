---
name: aireadylife-explore-task-update-open-loops
type: task
description: >
  Writes all explore flags (expiring documents, unbooked trip items, budget overruns) to
  vault/explore/open-loops.md and resolves completed items.
---

# aireadylife-explore-update-open-loops

**Trigger:** Called by explore ops and flows
**Produces:** Updated ~/Documents/aireadylife/vault/explore/open-loops.md with current action items

## What It Does

This task maintains vault/explore/open-loops.md as the canonical explore domain action list. It handles both writing new flags and resolving completed ones, keeping the file clean and actionable rather than accumulating stale entries.

**New flags written:** Three types of flags are written by this task. (1) Document expiration flags: written when any travel document enters its alert window (delegated to explore-task-flag-expiring-document for creation, but this task manages the file's overall state). (2) Booking gap flags: written when a trip has departure within 60 days and one or more critical booking categories (flights, accommodation, insurance) are still unbooked. Format: "🟡 Book travel insurance for [destination] — departure [N] days." (3) Budget overrun flags: written when a trip's actual spend has exceeded the estimated budget for any category by 15% or more: "🟡 [Destination] accommodation over budget — est. $1,200, currently $1,600."

**Resolution logic:** On every call, the task scans existing open-loop items for resolution conditions. Document flag resolution: the document record in vault/explore/00_current/ has been updated with a new expiry date beyond the alert window — confirmed renewal. Booking gap resolution: the trip record in vault/explore/00_current/ now shows the booking as completed (confirmation number added). Budget overrun resolution: the trip record shows actual cost has been updated and the overrun has been addressed. Items are marked resolved with a checked checkbox and a resolution note.

**Priority ordering:** The file is ordered with 🔴 items first (critical document issues, trips within 30 days with missing critical bookings), then 🟡 items (important but not immediate), then 🟢 items (on-radar monitoring). Within each tier, items are sorted by urgency date (nearest date first).

**Archive management:** Items resolved more than 60 days ago are moved to vault/explore/open-loops-archive.md to keep the active file manageable.

## Steps

1. Receive new flags from calling op (document flags, booking gaps, budget overruns)
2. For each new flag: check for existing unresolved entry matching the same document/booking/trip
3. If match: update existing entry with current days-remaining or status; add timestamp; do not duplicate
4. If no match: append new flag in appropriate priority position
5. Scan all existing active flags for resolution conditions
6. For document flags: read vault/explore/00_current/ for updated expiry date; resolve if renewed
7. For booking gaps: read vault/explore/00_current/ for updated booking status; resolve if booked
8. For budget overruns: read vault/explore/00_current/ for updated actuals; resolve if addressed
9. Mark confirmed resolved items with `- [x]`; add resolution note and date
10. Archive items resolved 60+ days ago to vault/explore/open-loops-archive.md
11. Write updated file

## Input

- New flags from calling op
- ~/Documents/aireadylife/vault/explore/open-loops.md (current state)
- ~/Documents/aireadylife/vault/explore/00_current/ (for document renewal verification)
- ~/Documents/aireadylife/vault/explore/00_current/ (for booking completion verification)

## Output Format

vault/explore/open-loops.md structure:
```markdown
# Explore — Open Loops

_Last updated: YYYY-MM-DD_

## Active
- [ ] 🔴 **Renew Global Entry — [Name]** — Expires Mar 1, 2026 (52 days) — Submit NOW at cbp.gov/ttp
- [ ] 🟡 **Book Kyoto accommodation — [Destination] trip** — Departure Nov 15 (216 days) — Need nights Nov 20-25
- [ ] 🟡 **Purchase travel insurance — [Destination] trip** — Departure Nov 15 (216 days) — Required for international travel
- [ ] 🟢 **Renew US Passport — [Name]** — Expires Feb 14, 2027 — Renew by Aug 2026

## Resolved
- [x] **Booked outbound flights — [Destination]** — Resolved 2026-04-10 (Conf: ABC123)
```

## Configuration

No configuration required.

## Error Handling

- **open-loops.md missing:** Create with standard header before writing.
- **Resolution evidence ambiguous:** Leave flag active; note "Mark resolved manually when confirmed."
- **File exceeds 25 active items:** Flag: "Explore open loops building up — schedule a document check or trip planning review to process items."

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/explore/open-loops.md, ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/00_current/
- Writes to: ~/Documents/aireadylife/vault/explore/open-loops.md, ~/Documents/aireadylife/vault/explore/open-loops-archive.md
