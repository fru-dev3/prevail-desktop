---
name: aireadylife-calendar-task-flag-approaching-deadline
type: task
description: >
  Writes a deadline alert to vault/calendar/open-loops.md when a cross-domain item
  is due within 7 days with no preparation activity started. Includes item, domain,
  due date, effort estimate, and recommended prep start date.
---

# aireadylife-calendar-flag-approaching-deadline

**Produces:** New urgent flag entry in ~/Documents/aireadylife/vault/calendar/open-loops.md

## What It Does

This task fires when `calendar-flow-collect-deadlines` identifies an item tagged as urgent (due within 7 days) and no preparation activity can be found in the source domain's vault for that item. It is the last-line warning system — by the time this fires, the comfortable preparation window has closed and the user needs to know immediately.

The task checks the source domain's vault for evidence of preparation before writing the flag. Preparation evidence includes: a milestone logged in vault/vision/00_current/milestones.md tied to this item, a payment confirmation in vault/tax/payments.md, a filed document in the source domain's vault, or an open-loop item in the source domain that has been marked as in-progress (partially checked or annotated with a progress date). If any such evidence is found, the task does not write a flag — the preparation is underway.

If no preparation evidence is found, the task writes a structured urgent flag to vault/calendar/open-loops.md with: the item name and full description, the source domain, the exact due date, the number of days remaining, the effort estimate (from the deadline record if available, or inferred), a calculated recommended preparation start date (today if the effort estimate fits in the remaining days; "already behind schedule" if it doesn't), and the specific preparation steps required for this type of task.

**Deduplication:** Before writing, the task checks vault/calendar/open-loops.md for an existing unresolved flag for the same domain + item combination. If an existing flag is found and preparation has still not started, the task updates the existing flag with an escalated urgency note ("N days until deadline — still no preparation found, escalation") rather than creating a duplicate entry. Each escalation is timestamped.

The flag is written with `urgency: critical` so it surfaces at the top of any agenda build and as a 🔴 item in the Chief brief.

## Steps

1. Receive: item name, source domain, due date, effort estimate from calling flow
2. Check source domain vault for preparation evidence (milestone, payment, filed document, in-progress annotation)
3. If preparation evidence found: do not write flag; return "preparation in progress" to calling flow
4. Check vault/calendar/open-loops.md for existing unresolved flag for same domain + item
5. Calculate days remaining; compare to effort estimate to determine if preparation is still feasible on schedule
6. If existing flag: update with escalated urgency note and today's date; do not create duplicate
7. If no existing flag: write new critical flag with full structured content
8. Return confirmation of flag written (or updated) to calling flow

## Input

- Item data from calling flow (item name, domain, due date, effort estimate)
- Source domain vault (for preparation evidence check)
- ~/Documents/aireadylife/vault/calendar/open-loops.md (for deduplication)

## Output Format

Entry appended to vault/calendar/open-loops.md:
```markdown
- [ ] 🔴 **[Domain] — [Item name]** — Due: [Date] ([N] days remaining)
  - urgency: critical
  - effort_estimate: [N]h
  - recommended_start: [Date or "Already behind schedule"]
  - prep_steps: [Specific steps for this type of task]
  - source_domain: [domain]
  - flagged_date: [YYYY-MM-DD]
  - escalation_history:
    - [YYYY-MM-DD]: First flagged — N days to deadline, no prep found
    - [YYYY-MM-DD]: Escalation — N days to deadline, still no prep found
```

## Configuration

No configuration required.

## Error Handling

- **Source domain vault missing:** Cannot check for preparation evidence. Still write the flag with a note "Preparation status unknown — source vault not accessible." Never suppress a deadline flag because the source domain is inaccessible.
- **Effort estimate not available:** Write flag without the recommended start date; include "Estimate effort and start immediately."
- **open-loops.md missing:** Create the file before writing.

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/{domain}/ (preparation evidence check), ~/Documents/aireadylife/vault/calendar/open-loops.md
- Writes to: ~/Documents/aireadylife/vault/calendar/open-loops.md
