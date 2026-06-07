---
name: aireadylife-business-task-update-open-loops
type: task
description: >
  Writes all business flags (overdue invoices, compliance deadlines, stalled proposals, expense
  anomalies) to vault/business/open-loops.md. Resolves completed items.
---

## What It Does

Maintains `~/Documents/aireadylife/vault/business/open-loops.md` as the live, always-current action list for the business domain. This file is the single place where all business flags from all review ops accumulate, and it is what the Chief of Staff reads to produce the daily business status for Ben's morning brief.

Receives a list of flags and action items from the calling op. Each flag has: a priority level (🔴 urgent / 🟡 watch / 🟢 info), a category (invoice / compliance / pipeline / expense / general), a description, a recommended action, a source op name, and the date raised. For time-sensitive items — overdue invoices, compliance deadlines within 30 days, estimated tax payments within 14 days — always writes as 🔴 regardless of what the calling op suggests, because these categories have real financial or legal consequences.

Before appending new items, scans the existing open-loops.md for any entries that are marked as resolved (checklist item ticked, explicit "resolved" note, or a status of paid/filed/complete in the vault for the referenced item) and removes them. Resolved items are moved to `vault/business/open-loops-archive.md` rather than deleted, preserving history for pattern analysis (e.g., "this client has been overdue 3 times in the past 12 months").

Deduplicates: before writing a new flag, checks whether the same item (same invoice number, same compliance obligation, same proposal name) already has an unresolved flag. If it does, updates the existing entry with the latest date rather than creating a duplicate. After writing, returns the count of open 🔴 items as a summary for the calling op to surface to the user.

## Triggers

Called internally at the end of every business op: `aireadylife-business-op-pl-review`, `aireadylife-business-op-compliance-review`, `aireadylife-business-op-pipeline-review`, `aireadylife-business-op-monthly-synthesis`, and `aireadylife-business-task-flag-overdue-invoice`.

## Steps

1. Receive flag list from calling op (each flag: priority, category, description, action, source, date)
2. Read current vault/business/open-loops.md (or create it if it does not exist)
3. For each existing entry in open-loops.md, check resolution status: if the referenced invoice is now paid in vault/business/00_current/, if the referenced compliance item has a completion date in the checklist, or if the entry is explicitly marked resolved — move to archive
4. Write resolved items to vault/business/open-loops-archive.md with resolution date and resolution note
5. For each new flag in the received list: check if an unresolved entry for the same item already exists; if yes, update the "last surfaced" date; if no, append as a new entry
6. Apply priority overrides: any invoice overdue, compliance deadline <30 days, or estimated tax payment <14 days = 🔴 regardless of calling op's suggestion
7. Sort remaining entries: 🔴 first, then 🟡, then 🟢; within each tier, sort by date raised (oldest first — longest-unresolved items should be most visible)
8. Write the cleaned, updated, sorted open-loops.md
9. Return summary: "{X} 🔴 urgent, {Y} 🟡 watch, {Z} 🟢 info items in open-loops.md"

## Input

- Flag list from calling op (passed as structured data)
- `~/Documents/aireadylife/vault/business/open-loops.md` — current file for dedup and resolution check
- `~/Documents/aireadylife/vault/business/00_current/` — to verify invoice payment status
- `~/Documents/aireadylife/vault/business/00_current/compliance-checklist.md` — to verify compliance completion status

## Output Format

`~/Documents/aireadylife/vault/business/open-loops.md` format:
```
# Business Open Loops
Last updated: {YYYY-MM-DD}
Open: {X} 🔴 | {Y} 🟡 | {Z} 🟢

---

🔴 OVERDUE INVOICE — Acme Corp | Invoice #1042
Amount: $2,500 | 38 days overdue | Late fee: ~$37.50
Action: Send Tier 1 payment reminder today
Source: business-op-pl-review | Raised: 2026-03-01

🟡 COMPLIANCE — Annual Report due in 45 days
Entity: LLC A | State: California | Due: 2026-04-15 | Fee: $800 min franchise tax
Action: File at bizfile.sos.ca.gov; pay $800 minimum franchise tax
Source: business-op-compliance-review | Raised: 2026-03-01

🟢 INFO — Q2 Estimated Tax due June 15
Estimated amount: ~$1,200 | Safe harbor calculation pending Q1 final figures
Source: business-op-monthly-synthesis | Raised: 2026-03-31
```

## Configuration

No special configuration required. Reads config.md only for priority override thresholds.

Optional in `~/Documents/aireadylife/vault/business/config.md`:
- `open_loops_max_age_days` — number of days before an unresolved 🟢 item auto-archives (default: 90)

## Error Handling

- If vault/business/open-loops.md does not exist: create it with the standard header and write the first entries.
- If open-loops-archive.md does not exist: create it when the first item is archived.
- If the received flag list is empty: scan existing entries for resolvable items only; do not write a blank update.
- If a priority override conflicts with user-provided priority (e.g., user marks a compliance deadline as 🟢): apply the override and note "Priority elevated to 🔴 per deadline proximity."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/business/open-loops.md`, `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/00_current/`
- Writes to: `~/Documents/aireadylife/vault/business/open-loops.md`, `~/Documents/aireadylife/vault/business/open-loops-archive.md`
