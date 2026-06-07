---
name: aireadylife-health-task-update-open-loops
type: task
cadence: called-by-op
description: >
  The single write point for vault/health/open-loops.md. Called at the end of every
  health op and flow. Appends new flags (lab anomalies, wearable deviations, refill
  reminders, preventive care gaps) with timestamp, source op, and severity. Scans
  existing entries for items that can be auto-resolved — expired refill reminders,
  lab flags where the biomarker returned to normal, care gaps that have been completed.
  Preserves resolved items with resolution date for audit trail.
---

# aireadylife-health-update-open-loops

**Cadence:** Called at the end of every health op and flow
**Produces:** Updated `vault/health/open-loops.md` with new flags appended and resolved items closed

## What It Does

Serves as the single, authoritative write point for the health domain's open-loop tracking file. All health ops call this task at the end of their run — never writing to `open-loops.md` directly. This centralization ensures that the file's structure stays consistent, that items aren't accidentally duplicated across runs, and that the resolution logic runs uniformly regardless of which op generated a flag.

**Append logic.** Each new flag passed from the calling op is written with: timestamp (ISO date), source op name, flag type (lab anomaly / refill reminder / preventive care gap / wearable anomaly / HSA pending / other), severity (LOW / MEDIUM / HIGH / CRITICAL), a one-line summary, the full action item text, and status: OPEN.

**Deduplication.** Before writing a new flag, the task checks for an existing open entry with the same flag type and identifier (e.g., same medication name for a refill flag; same biomarker for a lab flag). If an identical flag already exists as OPEN, the timestamp is updated rather than creating a duplicate. This prevents the same medication refill from appearing 3 times across 3 monthly runs if the user hasn't acted on it.

**Auto-resolution logic.** The task scans all existing OPEN entries and applies resolution rules:
- Refill reminder flags: auto-resolve if the refill date has passed (the window closed, indicating the user presumably filled or the reminder is now moot)
- Lab flags: auto-resolve if the most recent lab panel shows the same biomarker within normal range (cross-referenced with the lab summary files in `vault/health/00_current/`)
- Preventive care gaps: auto-resolve if a completion record has been added to `vault/health/00_current/completion-log.md` with a date after the gap was flagged
- Wearable anomaly flags: auto-resolve if the metric has returned within 1 SD of the 90-day baseline for 7 consecutive days

**Resolution record.** Resolved items are marked RESOLVED with a resolution date and a one-line resolution note (e.g., "Biomarker returned to normal range per 2025-03 panel," "Refill date passed — assumed filled"). They are not deleted. This preserves a searchable audit trail of past health flags.

## Apps

None

## Vault Output

- `vault/health/open-loops.md` — updated file with new flags appended and resolved items closed
