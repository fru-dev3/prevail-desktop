---
name: aireadylife-tax-flow-review-deductions
type: flow
trigger: called-by-op
description: >
  Scans transaction records and vault documents in vault/tax/00_current/ for
  deductible expenses, classifies each against IRS deduction categories (home office
  simplified or actual method, business expenses, charitable contributions, medical
  expenses >7.5% AGI, vehicle business use at 70 cents/mile for 2025), verifies
  documentation reference exists for each item, computes YTD totals per category,
  and flags categories running more than 20% behind prior year same-period pace.
---

# aireadylife-tax-review-deductions

**Trigger:** Called by `aireadylife-tax-deduction-review`
**Produces:** Updated deduction totals in `vault/tax/00_current/YYYY-deductions.md`

## What It Does

Reads all transaction records and uploaded receipts from `vault/tax/00_current/` for the current tax year and classifies each item against the applicable IRS deduction categories. This flow is the intelligence layer of deduction capture — it determines what's deductible, at what amount, and whether it's properly documented.

**Home Office Deduction.** Two methods: Simplified ($5/square foot, max 300 sq ft, max deduction $1,500/year — no depreciation tracking required) or Actual Expenses (calculate the proportion of the home used exclusively for business: office sq ft ÷ total home sq ft, applied to rent/mortgage interest, utilities, renter's/homeowner's insurance). The method to apply is configured in config.md. The flow reads the home office square footage and total home square footage from config, calculates the deductible amount for the year, and logs it as a single annual deduction entry.

**Vehicle and Mileage.** Two methods: Standard Mileage Rate (2025 rate: 70.0 cents/mile for business, 14 cents/mile for charity, 21 cents/mile for medical) or Actual Cost (proportionate vehicle expenses). Reads the mileage log from `vault/tax/00_current/mileage-log.md` and computes the deductible mileage amount YTD. Flags if the mileage log has gaps (days without entries are common and do not disqualify the deduction, but contemporaneous records are required — a reconstructed log is weaker).

**Business Expenses.** Reads transaction records tagged as business and classifies by category: software and subscriptions (100% deductible if business use), equipment under $2,500 (can be expensed immediately under the de minimis safe harbor; above $2,500 must be capitalized and depreciated unless Section 179 election is made), professional services (attorney, accountant fees for business matters), professional development and continuing education, business meals (50% deductible; requires business purpose documentation: who, what business was discussed), home internet (proportional business use percentage from config).

**Charitable Contributions.** Reads charitable contribution records from `vault/tax/00_current/charitable.md`. Cash donations require a bank record or written acknowledgment for any amount; donations ≥$250 require a written acknowledgment from the organization. Non-cash donations require a receipt with fair market value; non-cash donations >$500 require Form 8283. The flow checks that each cash donation ≥$250 has an acknowledgment reference and flags those missing it as "Documentation incomplete."

**Medical Expenses.** Reads out-of-pocket medical expense records. Applies the 7.5% of AGI floor (only the amount above 7.5% × estimated AGI is deductible). Calculates whether medical deductions are likely to exceed the standard deduction threshold after adding other itemized deductions — if not, notes "Medical deductions below threshold for itemizing."

**YTD pace comparison.** Each deduction category's YTD total is compared to the same-period total from the prior year (read from `vault/tax/00_current/YYYY-1-deductions.md`). Any category running more than 20% behind is flagged as potentially underreported — either genuinely fewer expenses this year or capturing is lagging.

## Triggers

- "deduction review"
- "log a deductible expense"
- "what can I deduct"
- "check my deductions"
- "home office deduction"
- "mileage deduction"
- "charitable contribution total"
- "are my deductions documented"

## Steps

1. Read all transaction records and documents from `vault/tax/00_current/YYYY/`
2. Classify each eligible item by IRS deduction category using payee, tags, and notes
3. Apply home office calculation using config square footage and method (simplified vs. actual)
4. Read mileage log from `vault/tax/00_current/mileage-log.md` and compute 2025 mileage deduction
5. For each business expense, verify business purpose documentation exists
6. For each charitable donation ≥$250, verify written acknowledgment reference exists
7. Calculate estimated 7.5% AGI floor for medical; determine excess amount
8. Sum YTD total per deduction category
9. Read prior year same-period totals from `vault/tax/00_current/YYYY-1-deductions.md` for pace comparison
10. Flag any category more than 20% behind prior year pace; write updated deduction summary to vault

## Input

- `vault/tax/00_current/YYYY/` — transaction records and receipts for current year
- `vault/tax/00_current/mileage-log.md` — mileage records for vehicle deduction
- `vault/tax/00_current/charitable.md` — charitable contribution records
- `vault/tax/00_current/YYYY-1-deductions.md` — prior year deduction totals for pace comparison
- `vault/tax/01_prior/` — prior period records for trend comparison
- `vault/tax/config.md` — home office sq ft, deduction methods, estimated AGI

## Output Format

Markdown document at `vault/tax/00_current/YYYY-deductions.md`:
- Summary: total estimated deductions, standard deduction comparison (should you itemize?)
- Deduction table: Category | YTD Amount | Documentation Status | vs. Prior Year Same Period | Status
- Flags section: documentation gaps, pace flags, categories requiring CPA review
- Standard vs. itemized comparison: total itemized deductions vs. 2025 standard deduction ($15,000 single / $30,000 MFJ)

## Configuration

Required in `vault/tax/config.md`:
- `home_office_method` — simplified | actual
- `home_office_sqft` — dedicated office square footage
- `home_total_sqft` — total home square footage (for actual method)
- `vehicle_method` — standard_mileage | actual_cost
- `estimated_agi` — estimated gross income for the year (for medical expense floor and QBI)
- `deduction_method` — standard | itemized (user's intent)

## Error Handling

- If mileage log is missing: flag "No mileage log found — if claiming vehicle deduction, create vault/tax/00_current/mileage-log.md with daily records"
- If charitable donations have no documentation reference: mark as "Documentation missing — cannot support deduction without acknowledgment letter"
- If prior year deduction file is missing: skip pace comparison and note "No prior year data for comparison — pace comparison available next year"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/tax/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/tax/00_current/` (all deduction records)
- Reads from: `~/Documents/aireadylife/vault/tax/config.md`
- Writes to: `~/Documents/aireadylife/vault/tax/00_current/YYYY-deductions.md`
