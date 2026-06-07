---
name: aireadylife-calendar-task-add-deadline
type: task
cadence: as-received
description: >
  Records a new deadline to vault/calendar/00_current/ with item description,
  due date, domain, effort estimate, priority, and linked open loop. Called whenever
  a new deadline is identified during any op run or directly on-demand.
---

# aireadylife-calendar-add-deadline

**Cadence:** As-received (triggered whenever a new deadline is identified)
**Produces:** New deadline record in ~/Documents/aireadylife/vault/calendar/00_current/YYYY-MM-DD-{slug}.md

## What It Does

This task creates a canonical deadline record in vault/calendar/00_current/ for any new time-bound obligation identified anywhere in the AI Ready Life system. Its purpose is to ensure that once a deadline is known, it is registered in the cross-domain deadline registry and will surface automatically in every subsequent weekly agenda scan and deadline alert — no matter where it originated.

The task checks first for a duplicate: if vault/calendar/00_current/ already contains a file with the same due date and a matching domain + item slug, it updates the existing file rather than creating a second record. This prevents duplicate entries from accumulating when the same deadline is discovered through multiple scan paths.

Each deadline record captures seven fields. Item name: a short human-readable title. Description: a full statement of what must be done, what the obligation is, and what constitutes completion. Due date: in ISO format YYYY-MM-DD. Source domain: the plugin or life area the deadline belongs to (tax, benefits, estate, insurance, career, business, etc.). Effort estimate: the approximate hours required to complete the task — estimated from the item description if not provided (Light: 1-3h, Moderate: 4-8h, Heavy: 8-20h). Priority: P1 (🔴 hard deadline or critical consequence), P2 (🟡 important soft deadline), P3 (🟢 on-radar monitoring item). Open loop reference: the specific open-loops.md file and item where this deadline originated, for traceability.

Deadline files are named with the due date as a prefix (YYYY-MM-DD-{domain}-{slug}.md) so they sort chronologically in the vault directory — the nearest upcoming deadline always appears first alphabetically, making the deadline directory itself a useful scan target.

After creating or updating the deadline record, the task also appends a corresponding entry to vault/calendar/open-loops.md if one does not already exist, so the item surfaces in cross-domain chief scans.

## Steps

1. Receive: item name, description, due date, source domain, effort estimate (or infer), priority
2. Generate slug from item name (lowercase, hyphens, max 35 chars)
3. Check vault/calendar/00_current/ for existing file matching YYYY-MM-DD-{domain}-{slug}
4. If exists: update the existing file with any new information; note update date
5. If not exists: create new file YYYY-MM-DD-{domain}-{slug}.md with full structured record
6. Verify vault/calendar/open-loops.md has a corresponding entry; add if missing
7. Return confirmation with file path to calling op

## Input

- Item data passed by calling op (item name, description, due date, domain, effort estimate, priority)
- ~/Documents/aireadylife/vault/calendar/00_current/ (for deduplication check)
- ~/Documents/aireadylife/vault/calendar/open-loops.md

## Output Format

Deadline file: ~/Documents/aireadylife/vault/calendar/00_current/YYYY-MM-DD-{domain}-{slug}.md

```markdown
---
item: Q1 Estimated Tax Payment
domain: tax
due_date: 2026-04-15
priority: P1
effort_estimate: 1h
hard_deadline: true
source_open_loop: ~/Documents/aireadylife/vault/tax/open-loops.md
date_registered: 2026-04-10
date_last_updated: 2026-04-10
resolution_status: open
---

## Q1 Estimated Tax Payment

**Due:** April 15, 2026
**Source:** tax
**Effort:** ~1 hour
**Priority:** P1 (🔴 hard deadline)

Make the Q1 federal estimated tax payment. Verify payment amount from vault/tax/ prior-year safe harbor calculation. Submit via IRS Direct Pay or mail check with Form 1040-ES voucher. Log confirmation in vault/tax/payments.md.
```

## Configuration

No configuration required. Domain and due date are passed by calling op.

## Error Handling

- **Due date missing:** Do not create the record. Return: "Deadline date required — provide an explicit due date."
- **00_deadlines/ directory missing:** Create the directory before writing.
- **Effort estimate not provided:** Infer from item description: tasks described as "review," "check," "confirm," or "pay" → 1-3h Light. Tasks described as "prepare," "gather documents," "draft," "analyze" → 4-8h Moderate. Tasks described as "file," "complete," "execute," or project-scale work → 8+ hours Heavy.

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/calendar/00_current/ (deduplication check), ~/Documents/aireadylife/vault/calendar/open-loops.md
- Writes to: ~/Documents/aireadylife/vault/calendar/00_current/YYYY-MM-DD-{domain}-{slug}.md, ~/Documents/aireadylife/vault/calendar/open-loops.md
