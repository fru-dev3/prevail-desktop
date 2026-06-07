---
name: aireadylife-tax-task-flag-approaching-deadline
type: task
cadence: called-by-op
description: >
  Writes a deadline alert to vault/tax/open-loops.md when a tax deadline is within
  30 days. Each entry includes: deadline type, exact due date, entity name (personal
  or business entity), estimated payment or fee amount, specific payment method and
  portal URL, urgency tier (CRITICAL ≤7 days, HIGH 8–14 days, MEDIUM 15–30 days),
  and a link to the source calculation or calendar entry in vault. Called by
  deadline-watch and quarterly-estimate ops.
---

# aireadylife-tax-flag-approaching-deadline

**Cadence:** Called by quarterly estimate and deadline watch ops
**Produces:** Deadline alert entries in `vault/tax/open-loops.md`

## What It Does

Called whenever a tax deadline is identified as falling within 30 days. Writes a structured, immediately actionable deadline alert to `vault/tax/open-loops.md` that tells the user exactly what to do, by when, and how — not just that something is due.

Each flag entry contains:
- **Deadline type** — Estimated Tax Payment (federal Q1/Q2/Q3/Q4), Federal Return Due, Extension Due, S-Corp Return, LLC Annual Report, Franchise Tax, Form 941, Registered Agent Renewal, State Return, State Estimated Payment
- **Entity** — Personal (individual return), or the specific entity name (e.g., "Fru Dev LLC," "FW Productions Inc.")
- **Exact due date** — ISO format (YYYY-MM-DD)
- **Days remaining** — computed from today to due date
- **Amount** — the estimated or required payment amount; or "N/A" for non-payment filings; or "TBD — run quarterly estimate" if not yet calculated
- **Payment/filing method** — specific and actionable:
  - Federal estimated tax: "IRS Direct Pay at irs.gov/payments → Estimated Tax → 1040-ES" or "EFTPS at eftps.gov → click Make a Payment → select 1040ES"
  - State estimated tax: state-specific URL from the embedded state portal reference
  - LLC annual report: state SOS portal URL
  - Registered agent: registered agent company renewal portal
  - Form 941: "File via your payroll provider's tax filing module or directly at irs.gov"
- **Urgency tier** — CRITICAL (≤7 days), HIGH (8–14 days), MEDIUM (15–30 days)
- **Source reference** — link to the calculation file in vault that produced the amount (e.g., `vault/tax/00_current/2025-Q3-estimate.md`)
- **Extension note** — if the user has already filed an extension for this deadline, the flag is annotated "Extension filed — payment deadline unchanged" to clarify that filing extensions don't extend the payment due date

**EFTPS enrollment warning.** If the payment amount exceeds $1,000 and the user hasn't previously used EFTPS (flagged in config.md), the alert adds: "Note: EFTPS enrollment takes 5–7 business days. For immediate payment, use IRS Direct Pay instead. Consider enrolling in EFTPS for future quarters."

**Auto-resolution.** Deadline alerts are auto-resolved by `aireadylife-tax-update-open-loops` once the due date has passed, with a status update of RESOLVED and a resolution note of "Deadline passed — confirm payment was made and record in vault/tax/00_current/payment-log.md."

## Apps

None

## Vault Output

- `vault/tax/open-loops.md` — deadline alert entry appended
