---
name: aireadylife-home-op-monthly-sync
type: op
cadence: monthly
description: >
  Full monthly home sync on the 1st of each month. Updates open maintenance item statuses,
  reviews monthly home expenses, checks seasonal task completion, flags upcoming lease or
  insurance renewals, and triggers the home review brief.
  Triggers: "home monthly sync", "sync home data", "monthly home review".
---

# aireadylife-home-monthly-sync

**Cadence:** Monthly (1st of month)
**Produces:** Updated maintenance status, monthly expense summary, seasonal task check, and a home review brief

## What It Does

The monthly sync is the primary recurring operation that keeps the home vault current and the maintenance schedule visible. It runs on the 1st of each month and coordinates three parallel updates: maintenance status, expense review, and seasonal task check. The result is a fully refreshed vault snapshot and a ready-to-read review brief for the month ahead.

The maintenance status update reads all open maintenance items from the vault and checks for any status changes since the last sync: items that have been completed (and need to be marked resolved), vendor appointments that have been scheduled (and need a target date), or newly urgent items that have escalated in severity. If the user logged any maintenance task completions during the prior month using the flag or log tasks, those are reconciled here against the open items list.

The expense review pulls all expenses logged during the prior month and runs the expense summary flow to produce the monthly category breakdown, budget comparison, and utility trends. The headline number — total monthly home spend — is always surfaced in the monthly brief so the user maintains awareness of home operating costs as a single figure.

The seasonal task check evaluates where the home stands on the seasonal maintenance calendar for the current month. In January: are there winter maintenance items that need attention (frozen pipe risk check, heating system running correctly, weatherstripping holding)? In April: AC tune-up scheduled, gutters cleaned, roof checked? In October: furnace inspection booked, gutters scheduled for fall cleaning, sprinkler blow-out completed? Any seasonal task due within 30 days that has no completion record is flagged and escalated to the home review brief.

The sync also checks for any time-sensitive renewals: if the home is a rental, lease renewal window within 90 days. Renter's or homeowner's insurance renewal within 60 days. Home warranty renewal within 30 days. Any mortgage-related anniversary triggers (ARM adjustment anniversary, PMI removal eligibility if equity has reached 20%). All renewal flags are surfaced in the brief and written to open-loops.md.

## Triggers

- "Run the home monthly sync"
- "Monthly home update"
- "Sync home data"
- "Home check-in for the month"

## Steps

1. Check `~/Documents/aireadylife/vault/home/config.md` — confirm required fields are present; prompt for missing data
2. Read all open maintenance items from `~/Documents/aireadylife/vault/home/00_current/`; check for completed or escalated items
3. Call `aireadylife-home-expense-review` to produce the monthly expense summary
4. Evaluate seasonal maintenance calendar for current month; identify tasks due with no completion record
5. Check renewal dates: insurance (60-day flag), lease if renting (90-day flag), home warranty (30-day flag)
6. Check if mortgage has any milestone approaching: ARM adjustment, 20% equity PMI removal eligibility
7. Update open-loops.md: add new flags, resolve completed items
8. Write sync completion record to `~/Documents/aireadylife/vault/home/00_current/last-sync.md`
9. Trigger `aireadylife-home-review-brief` to compile all results
10. Present sync summary with count of items updated, expenses reviewed, and seasonal tasks flagged

## Input

- `~/Documents/aireadylife/vault/home/config.md`
- `~/Documents/aireadylife/vault/home/00_current/`
- `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expenses.md`
- `~/Documents/aireadylife/vault/home/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/home/open-loops.md`

## Output Format

**Monthly Sync Summary — [Month Year]**
- Maintenance: X open items (Y completed since last sync, Z newly escalated)
- Expenses: Total $X (vs. budget: +/-$X)
- Seasonal tasks: X due this month, Y already completed, Z flagged
- Renewal alerts: [list any within threshold]
- Brief ready: link to `vault/home/02_briefs/YYYY-MM-home-brief.md`

## Configuration

Required in `~/Documents/aireadylife/vault/home/config.md`:
- `home_type` — "own" or "rent"
- `insurance_renewal_date` — annual renewal date
- `lease_end_date` — if renting
- Annual budget fields for expense review

## Error Handling

- If vault missing: direct to frudev.gumroad.com/l/aireadylife-home
- If config.md is missing: halt monthly sync; prompt user to complete setup
- If expense records not yet logged for the month: run expense review with $0 totals; note expenses can be added retroactively

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/home/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/home/config.md`, `01_maintenance/`, `02_expenses/`, `open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/home/00_current/last-sync.md`
- Writes to: `~/Documents/aireadylife/vault/home/02_briefs/YYYY-MM-home-brief.md`
- Writes to: `~/Documents/aireadylife/vault/home/open-loops.md`
