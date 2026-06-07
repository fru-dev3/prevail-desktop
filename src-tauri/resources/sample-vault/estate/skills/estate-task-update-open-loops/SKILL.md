---
name: aireadylife-estate-task-update-open-loops
type: task
description: >
  Writes estate flags (overdue maintenance, lease expirations, cash flow anomalies, vacancy risks,
  property tax deadlines, CapEx approaching) to open-loops.md and resolves completed items.
  Maintains the canonical estate action list readable by calendar and wealth plugins.
---

# aireadylife-estate-update-open-loops

**Produces:** Updated `~/Documents/aireadylife/vault/estate/open-loops.md` with new flags appended and resolved items archived

## What It Does

This task maintains the canonical open-loops file for the estate domain — the single active watchlist for everything that requires landlord attention. It receives flag data from every estate op and flow, writes structured entries to the open-loops file, and on each run cleans up any items that have been resolved.

Flags written to open-loops.md fall into the following categories, each with a defined urgency level:

**Critical:** Emergency maintenance (safety or habitability issue) with no vendor action within 24 hours. Lease expiring within 14 days with no signed renewal or move-out notice. Property tax payment due within 7 days and not yet logged as paid.

**High:** Urgent maintenance (functional issue) with no resolution after 10 days. Lease expiring within 30 days without renewal decision. Negative net cash flow on any property for the current month. Security deposit discrepancy discovered. Tenant with 2+ late payments in past 3 months.

**Medium:** Routine maintenance overdue by 14+ days. Lease expiring within 31–90 days — outreach needed. Expense ratio above 50% on any property. Vendor follow-up stale for 14+ days. CapEx item within 3 years of end of useful life. Insurance renewal within 60 days.

**Monitor:** Property value not updated in 12+ months. Quarterly portfolio review due (reminder). Annual depreciation not yet logged for current tax year.

Each flag entry in open-loops.md contains: the property address, flag category, specific issue description, financial impact or risk (dollar amount or legal risk), recommended action, action-by date, and the date flagged. Urgency is labeled in the header for easy scanning.

On every run, the task also evaluates existing open loop items against current vault data. An item is resolved when the underlying condition is no longer present: maintenance item marked completed in the maintenance folder, lease renewal signed and logged, payment received and recorded, tax payment logged. Resolved items are moved to `~/Documents/aireadylife/vault/estate/open-loops-archive.md` with the resolution date and outcome noted. This archive is the historical record of every property issue that was flagged and resolved.

The open-loops.md file is read by the calendar agent during cross-domain scans — estate items with explicit action-by dates automatically surface in weekly calendar agendas when that integration is active.

## Steps

1. Receive flag data from calling op (property, flag category, issue description, financial impact, recommended action, urgency, action-by date)
2. Read existing `~/Documents/aireadylife/vault/estate/open-loops.md` to check for duplicate flags of the same issue at the same property
3. If duplicate: update timestamp and context rather than creating a second entry
4. If new: append structured flag entry with all required fields
5. Scan all existing open items against current vault data (maintenance folder, tenant records, payment logs) to identify resolved conditions
6. Move resolved items to `~/Documents/aireadylife/vault/estate/open-loops-archive.md` with resolution date and outcome
7. Return summary to calling op: total open items by urgency (X critical, Y high, Z medium, W monitor)

## Input

- Flag data passed by calling op
- `~/Documents/aireadylife/vault/estate/open-loops.md` — existing flags
- `~/Documents/aireadylife/vault/estate/00_current/` — for resolution check on maintenance flags
- `~/Documents/aireadylife/vault/estate/00_current/` — for resolution check on tenant/lease flags
- `~/Documents/aireadylife/vault/estate/00_current/` — for resolution check on cash flow flags

## Output Format

Each entry in open-loops.md:
```markdown
## [CATEGORY] — [Property Short Name] — [Issue Title] — [URGENCY]
**Date flagged:** YYYY-MM-DD
**Property:** {full address}
**Issue:** {description}
**Financial impact:** {$ amount or legal risk}
**Action:** {recommended action}
**Action by:** YYYY-MM-DD
**Status:** open
```

Archive entry:
```markdown
## [RESOLVED] — [original title]
**Resolved:** YYYY-MM-DD | **Outcome:** {what was done}
```

## Configuration

No additional configuration required beyond vault existing.

## Error Handling

- If open-loops.md does not exist: create it and add the first entry
- If open-loops-archive.md does not exist: create it when the first item is resolved
- If a flag is passed with incomplete data: write what is available; mark missing fields as "unknown"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/estate/open-loops.md`
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`, `01_tenants/`, `03_cashflow/`
- Writes to: `~/Documents/aireadylife/vault/estate/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/estate/open-loops-archive.md`
