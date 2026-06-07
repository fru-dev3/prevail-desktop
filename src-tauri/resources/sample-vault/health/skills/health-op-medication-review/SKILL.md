---
name: aireadylife-health-op-medication-review
type: op
cadence: monthly
description: >
  Monthly medication review. Reads the active prescription list in vault/health/
  05_medications/, calculates days remaining before each refill window opens (applying
  7-day buffers for 90-day supplies and 3-day buffers for 30-day supplies), flags
  medications due within 30 days, checks each against the IRS HSA-eligible expense
  list, and logs all findings to open-loops.md. Triggers: "medication review",
  "check my refills", "monthly med check", "am I running out of anything".
---

# aireadylife-health-medication-review

**Cadence:** Monthly (1st of month)
**Produces:** Refill reminders in `vault/health/open-loops.md`; updated medication records in `vault/health/00_current/`

## What It Does

Runs on the first of each month to ensure no prescription lapses due to a missed refill. It reads the full active medication list from `vault/health/00_current/medications.md` — which includes each drug's name, dosage, fill date, days supply, pharmacy, estimated out-of-pocket cost per fill, HSA eligibility, auto-refill enrollment status, and controlled substance classification.

The op calls `aireadylife-health-check-refill-dates` to calculate the projected refill window for each prescription. The early-fill buffer logic is: for a 90-day supply, the refill window opens 7 days before the supply expires (standard for mail-order and specialty pharmacy programs); for a 30-day supply, the buffer is 3 days. Medications with auto-refill enrolled are still flagged but tagged with "auto-refill enrolled — no action required" so the user has visibility without needing to act.

For each medication flagged as due within 30 days, `aireadylife-health-flag-upcoming-refill` is called to write a structured reminder to `open-loops.md` with urgency tiered by days remaining: HIGH if ≤7 days, MEDIUM if 8–21 days, LOW if 22–30 days.

The op also performs an HSA reimbursement audit: for each medication marked HSA-eligible that was purchased in the prior month, it checks whether a reimbursement record exists in `vault/health/00_current/hsa-log.md`. Any eligible purchase not yet submitted for reimbursement is flagged as "HSA reimbursement pending" with the medication name, purchase date, and estimated amount. This catches tax-advantaged spending that would otherwise go unclaimed.

Finally, the op checks for any medications where the prescribing provider is no longer listed as an active provider in config.md — a signal that a prescription may need to be transferred or renewed with a current provider.

## Calls

- **Flows:** `aireadylife-health-check-refill-dates`
- **Tasks:** `aireadylife-health-flag-upcoming-refill`, `aireadylife-health-update-open-loops`

## Apps

None (reads from vault; does not auto-order refills)

## Vault Output

- `vault/health/00_current/medications.md` — updated last-reviewed date
- `vault/health/open-loops.md` — refill reminders and HSA pending flags

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/health/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/health/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/health/02_briefs/` — prior briefs for period-over-period context
