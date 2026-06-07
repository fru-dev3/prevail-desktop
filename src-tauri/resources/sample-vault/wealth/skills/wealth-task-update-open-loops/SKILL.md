---
name: aireadylife-wealth-task-update-open-loops
type: task
cadence: called-by-op
description: >
  The single write point for vault/wealth/open-loops.md. Called at the end of every
  wealth op. Appends new flags (budget overages, rebalancing alerts, savings milestones,
  debt events, 401k warnings, unexplained account movements) with timestamp, source op,
  and severity. Scans existing OPEN entries for items that can be auto-resolved —
  corrected allocation drift, categories back under budget, debts paid off. Preserves
  resolved items with resolution date for audit trail.
---

# aireadylife-wealth-update-open-loops

**Cadence:** Called at the end of every wealth op
**Produces:** Updated `vault/wealth/open-loops.md` with new flags appended and resolved items closed

## What It Does

Serves as the single, authoritative write point for the wealth domain's open-loop tracking file. Every wealth op calls this task at the end of its run — never writing to `open-loops.md` directly — ensuring consistent structure, deduplication, and resolution logic across all wealth operations.

**Append logic.** Each new flag received from the calling op is written as a structured entry: ISO timestamp, source op name, flag type (budget-variance / rebalancing / savings-milestone / unexplained-movement / debt-event / 401k-pace / emergency-fund / other), severity (LOW / MEDIUM / HIGH / CRITICAL / MILESTONE), one-line summary, full action item text, due date if applicable, and status: OPEN (or MILESTONE for positive events).

**Deduplication.** Before writing a new flag, the task checks for an existing OPEN entry with the same flag type and identifier (e.g., same budget category for a variance flag; same asset class for a rebalancing flag). If an identical flag already exists as OPEN, the timestamp is refreshed and any new data (updated overage amount, updated drift percentage) is merged into the existing entry rather than creating a duplicate. This prevents the same rebalancing recommendation from appearing 3 times across 3 monthly reviews if the user hasn't acted on it.

**Auto-resolution rules.** The task scans all OPEN entries and applies resolution logic:
- Budget variance flags: auto-resolve if the flagged category came in under budget this month (the pattern has broken)
- Rebalancing flags: auto-resolve if the flagged asset class is now within 3% of target (drift corrected, either via market movement or user action)
- Unexplained movement flags: auto-resolve if the user has added an annotation to the account file explaining the movement
- 401k pace flags: auto-resolve if the contribution rate has been updated in config and the new pace will hit the limit
- Emergency fund flags: auto-resolve if the liquid balance now covers 3+ months of essential expenses
- Debt milestone flags: auto-resolve after 30 days (they are informational; no action required)
- Savings milestone flags: auto-resolve after 7 days (acknowledged)

**Resolution record.** Resolved items are marked RESOLVED with a resolution date and note. They are not deleted. The `open-loops.md` file is the audit trail for all wealth flags — resolved items preserve the history of what was flagged and when it was addressed.

## Apps

None

## Vault Output

- `vault/wealth/open-loops.md` — updated with new flags appended and resolved items closed
