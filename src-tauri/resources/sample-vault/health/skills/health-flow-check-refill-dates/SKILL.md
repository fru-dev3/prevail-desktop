---
name: aireadylife-health-flow-check-refill-dates
type: flow
trigger: called-by-op
description: >
  Scans the active medication list in vault/health/00_current/ and computes the
  projected refill date for each prescription based on fill date and days supply.
  Applies early-fill buffers (7 days for 90-day supplies, 3 days for 30-day supplies)
  and flags any medication whose refill window opens within 30 days. Returns the
  flagged list with pharmacy, estimated cost, and HSA eligibility for each item.
---

# aireadylife-health-check-refill-dates

**Trigger:** Called by `aireadylife-health-medication-review`
**Produces:** Flagged refill list passed to `aireadylife-health-flag-upcoming-refill`

## What It Does

Reads the active medication list from `vault/health/00_current/medications.md` — which stores each prescription's name, dosage, fill date, days supply, dispensing pharmacy (name and phone), estimated out-of-pocket cost per fill, and HSA eligibility flag. For each entry, the projected refill date is computed as: fill date + days supply − early-fill buffer. The early-fill buffer is 7 days for prescriptions with a 90-day supply (common with mail-order pharmacy and specialty drugs) and 3 days for 30-day supplies. This buffer ensures the refill reminder fires with enough lead time to call the pharmacy, request a mail-order refill, or transfer a prescription without a gap in the supply.

Any medication whose refill window opens within 30 days of today is flagged. The output is a structured list — not written to the vault directly — returned to the calling op (`aireadylife-health-medication-review`) which then passes each flagged item to `aireadylife-health-flag-upcoming-refill` for logging. This two-step design keeps the flag-writing logic separate from the date-calculation logic, so each piece can be tested independently.

For medications with automatic refills enrolled (pharmacy auto-refill programs), the flag is still generated but tagged with "auto-refill enrolled" so the user knows no action is required. For controlled substances (Schedule II–V), which typically cannot be auto-refilled or early-filled, the flag is tagged "controlled — contact provider for new Rx if needed."

HSA eligibility is checked against the IRS Publication 502 category list: all prescription medications are HSA-eligible by default unless flagged otherwise in config. Over-the-counter medications are flagged as "OTC — check plan terms" since eligibility varies by plan.

## Triggers

- "check my refills"
- "what medications are due"
- "medication refill review"
- "which prescriptions need to be filled"
- "refill check"
- "am I running out of any meds"
- "prescription status"

## Steps

1. Read `vault/health/00_current/medications.md` and parse the active medication list
2. For each active medication, read: name, dosage, fill date, days supply, pharmacy, estimated cost, HSA eligibility, auto-refill status, and controlled substance flag
3. Calculate projected refill date: fill date + days supply − early-fill buffer (7 days if supply=90, 3 days if supply=30, 0 days if supply=other)
4. Compute days until refill window opens: (projected refill date − today)
5. Flag any medication with days-until-refill ≤ 30
6. For each flagged medication, attach: pharmacy name and phone, estimated cost, HSA eligibility, auto-refill status, controlled status
7. Sort flagged list by urgency (fewest days remaining first)
8. Return structured flagged list to `aireadylife-health-medication-review` for downstream processing

## Input

- `vault/health/00_current/medications.md` — active medication list with fill metadata
- `vault/health/01_prior/` — prior period records for trend comparison
- `vault/health/config.md` — any pharmacy-specific buffer overrides

## Output Format

Structured list (returned in memory to calling op, not written to vault):
- Each entry: medication name | dosage | days until refill | refill date | pharmacy | estimated cost | HSA eligible | auto-refill | urgency tier
- Urgency tiers: HIGH (≤7 days), MEDIUM (8–21 days), LOW (22–30 days)
- Controlled substance flag appended where applicable

## Configuration

Required fields in `vault/health/config.md`:
- `medications_file` — path override if medication file is not at default location
- `refill_buffer_90day` — days before expiry to trigger refill reminder for 90-day supplies (default: 7)
- `refill_buffer_30day` — days before expiry to trigger refill reminder for 30-day supplies (default: 3)

## Error Handling

- If medication file is missing: report "No active medication list found. Create vault/health/00_current/medications.md from the vault template."
- If a medication entry is missing the fill date or days supply: flag that entry as "incomplete — cannot calculate refill date" and ask user to update it
- If fill date is in the future (data entry error): flag as "invalid fill date" and skip refill calculation for that entry

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/health/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/health/00_current/medications.md`
- Reads from: `~/Documents/aireadylife/vault/health/config.md`
- Writes to: None (returns data to calling op)
