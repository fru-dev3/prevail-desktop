---
name: aireadylife-tax-task-log-deductible-expense
type: task
cadence: as-received
description: >
  Records a deductible expense to vault/tax/00_current/ with all metadata required
  to support the deduction at filing: date, vendor/payee, amount, deduction category
  (home office, vehicle/mileage, business expense, charitable, medical), IRS basis for
  deductibility, supporting document reference, business purpose note (for meals/travel),
  and tax year. Enforces documentation reference before marking fully documented.
  Can be called by the deduction review op or triggered directly when a deductible
  purchase is made in real time.
---

# aireadylife-tax-log-deductible-expense

**Cadence:** As-received (called by deduction review op or triggered directly by user)
**Produces:** New deduction entry in `vault/tax/00_current/YYYY/deduction-log.md`

## What It Does

Records a single deductible expense to the vault's deductions log with all the fields needed to support the deduction if examined by the IRS. This task is the write end of the deduction capture pipeline — `aireadylife-tax-review-deductions` identifies deductible items; this task logs them.

**Required fields per entry:**
- **Date** — the date the expense was incurred (not the date it was logged)
- **Vendor/payee** — merchant or organization name
- **Amount** — exact dollar amount
- **Deduction category** — one of: home-office, vehicle-mileage, business-expense, charitable, medical, other
- **Sub-category** — for business expenses: software | equipment | professional-services | meals | professional-development | internet; for charitable: cash | non-cash | qcd; for vehicle: business | charity | medical
- **IRS basis** — brief citation: e.g., "IRC §162 ordinary and necessary business expense," "IRC §170 charitable contribution," "IRS Pub 502 medical expense," "Rev. Proc. 2024-28 standard mileage rate"
- **Document reference** — filename of the receipt, invoice, or acknowledgment letter stored in `vault/tax/00_current/YYYY/receipts/`; if not yet available, marked "pending"
- **Business purpose** — required for meals (who attended, what business was discussed) and vehicle use (business destination and purpose); N/A for other categories
- **Documentation status** — DOCUMENTED (reference present) or PENDING (reference missing)
- **Tax year** — the year the deduction applies to (usually current year; sometimes prior year for IRA contributions)

**Real-time logging.** This task is designed to be called immediately at the point of purchase — when a user buys business software, makes a donation, or drives to a business meeting. Real-time logging produces the best documentation: the business purpose is fresh, the receipt is immediately at hand, and the date is accurate. The task does not require the deduction review op to trigger it.

**Documentation pending flow.** When a document reference is not yet available (common for charitable acknowledgment letters, which arrive weeks after the donation), the entry is logged as "Documentation pending" with the expected document type. The deduction review op flags all pending items monthly until the documentation is confirmed.

**Business meal specifics.** For business meals, the task enforces the documentation the IRS requires: who attended (names and business relationships), what business was discussed (one sentence), the business connection. Without these, the meal deduction is unsupportable in an audit. The task prompts for these if they're not provided when the entry is created.

**Mileage shortcut.** For mileage entries, the task captures: date, business destination, business purpose, miles driven, and the 2025 standard mileage rate (70 cents/mile). If the user runs this task multiple times for vehicle trips, the task appends to the mileage log at `vault/tax/00_current/mileage-log.md` with one entry per trip — this is the contemporaneous mileage log required by the IRS.

## Apps

None

## Vault Output

- `vault/tax/00_current/YYYY/deduction-log.md` — new entry appended to the YTD deduction log
- `vault/tax/00_current/mileage-log.md` — updated with new trip entry (for mileage entries)
