---
name: aireadylife-records-op-monthly-sync
type: op
cadence: monthly
description: >
  Full records data sync on the 1st of each month. Recalculates days-to-expiration for all
  tracked documents, flags documents newly entering the 90-day alert window, reviews subscriptions
  for price changes and usage, checks legal document currency, and triggers the review brief.
  Triggers: "records monthly sync", "sync records", "refresh records vault".
---

# aireadylife-records-monthly-sync

**Cadence:** Monthly (1st of month)
**Produces:** Records vault refreshed with updated expiration countdowns, subscription review, and a records review brief

## What It Does

The monthly sync keeps the records vault current and ensures that time-sensitive items — an approaching passport expiration, a subscription renewal charging tomorrow — surface before they become problems rather than after.

The sync runs three updates in sequence. First, document expiration countdown: every document in the vault with an expiration date has its days-until-expiration recalculated as of the sync date. This incremental update means the document audit report from last quarter's quarterly audit is never stale by more than 30 days — monthly recalculation catches documents that have newly entered their alert window (passport moving inside 12 months, Global Entry moving inside 6 months, license moving inside 90 days). Any document newly entering its alert window triggers a flag to open-loops.md and a note in the review brief.

Second, subscription review: the sync checks all active subscriptions for three events since the last sync. Price changes: if a subscription's logged price differs from any recent billing event the user has noted, the discrepancy is flagged. Annual renewals approaching: any subscription renewing within the next 30 days is surfaced with the renewal date and cost for a keep/cancel decision — preventing accidental auto-renewal of services the user intended to cancel. Unused subscriptions: any subscription with no usage logged in 60+ days is flagged for cancellation consideration. The sync also calculates the total monthly subscription cost across all active services as a headline figure.

Third, legal document currency check: each month, the sync checks whether any life events noted in config.md have occurred since the last legal document review date. If a child was born, a marriage occurred, or a significant asset change happened since the will or POA was last reviewed, a flag is added to open-loops.md. This monthly touchpoint ensures that legal document gaps from life changes don't sit unaddressed for years.

After these three updates, the sync triggers the records review brief.

## Triggers

- "Run the records monthly sync"
- "Sync my records"
- "Monthly records update"
- "Refresh the records vault"

## Steps

1. Confirm vault and config.md are present; halt if missing
2. Read all documents with expiration dates from `~/Documents/aireadylife/vault/records/00_current/` and `01_legal/`
3. Recalculate days-until-expiration for each document; apply alert thresholds
4. Flag any document newly entering its alert window since last sync
5. Read subscription registry from `~/Documents/aireadylife/vault/records/00_current/subscriptions.md`
6. Check for annual renewals within next 30 days; flag with renewal date and cost
7. Check for subscriptions unused for 60+ days; flag for cancellation consideration
8. Check subscription prices against logged amounts; flag any discrepancy
9. Read legal document review dates from `01_legal/`; check against life events in config.md
10. Call `aireadylife-records-update-open-loops` with all new flags; resolve any items from prior sync that are no longer relevant
11. Write sync completion record to `~/Documents/aireadylife/vault/records/00_current/last-sync.md`
12. Trigger `aireadylife-records-review-brief` to compile all results
13. Present sync summary with counts of documents updated, documents flagged, subscriptions reviewed

## Input

- `~/Documents/aireadylife/vault/records/config.md`
- `~/Documents/aireadylife/vault/records/00_current/`
- `~/Documents/aireadylife/vault/records/00_current/`
- `~/Documents/aireadylife/vault/records/00_current/subscriptions.md`
- `~/Documents/aireadylife/vault/records/01_prior/` — prior period records for trend comparison

## Output Format

**Monthly Sync Summary — [Month Year]**
- Documents reviewed: X total (Y newly entering alert window)
- Subscriptions reviewed: X active (Y renewals within 30 days, Z low-usage flagged, total $X/mo)
- Legal documents: X reviewed (Y flagged for review)
- Open loops: X added, Y resolved
- Brief ready: link to `vault/records/02_briefs/YYYY-MM-records-brief.md`

## Configuration

Required in `~/Documents/aireadylife/vault/records/config.md`:
- `household_members`
- `recent_life_events`
- `expiration_alert_threshold` (default: 365 days for passport; 180 days for Global Entry; 90 days for DL)

## Error Handling

- If vault missing: direct to frudev.gumroad.com/l/aireadylife-records
- If config.md is incomplete: run with available data; prompt for missing fields
- If subscription registry is empty: skip subscription review; note how to add subscriptions

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/records/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/records/config.md`, `00_identity/`, `01_legal/`, `02_subscriptions/`
- Writes to: `~/Documents/aireadylife/vault/records/00_current/last-sync.md`
- Writes to: `~/Documents/aireadylife/vault/records/02_briefs/YYYY-MM-records-brief.md`
- Writes to: `~/Documents/aireadylife/vault/records/open-loops.md`
