---
name: aireadylife-tax-flow-build-estimate
type: flow
trigger: called-by-op
description: >
  Projects the current quarter's estimated federal tax payment by aggregating YTD
  income across all sources (W-2 wages, 1099-NEC, rental, capital gains, dividends,
  business income), subtracting YTD withholding and prior estimated payments, and
  running both the safe harbor method (110% of prior year liability if AGI >$150k)
  and the actual current-year liability method. Returns the lower of the two as the
  recommended payment. Includes underpayment penalty risk if no payment is made.
---

# aireadylife-tax-build-estimate

**Trigger:** Called by `aireadylife-tax-quarterly-estimate`
**Produces:** Estimated tax calculation at `vault/tax/00_current/YYYY-QN-estimate.md`

## What It Does

Reads YTD income and withholding data from across the tax vault and produces a current-quarter estimated tax calculation using both IRS-recognized methods, returning whichever produces the lower required payment to avoid underpayment penalties.

**Income aggregation.** The flow calls `aireadylife-tax-extract-income-ytd` to get a structured breakdown of all YTD income: W-2 wages (gross, year-to-date, from pay stubs in `vault/tax/00_current/`), self-employment / 1099-NEC income (from freelance/consulting records), rental income net of deductible expenses (from estate or business records), short-term capital gains (from brokerage records — held ≤1 year, taxed as ordinary income), long-term capital gains (held >1 year, taxed at preferential rates of 0%/15%/20%), qualified dividends (taxed at long-term capital gains rates), ordinary dividends (taxed as ordinary income), and other income.

**Withholding and prior payments.** YTD federal withholding from W-2 pay stubs. Any prior quarterly estimated payments already made this year (from `vault/tax/00_current/`). Both are subtracted from the required payment before arriving at the amount due.

**Method A: Safe Harbor.** Prior year total tax liability ÷ 4 = quarterly safe harbor payment. If prior year AGI exceeded $150,000, use 110% of prior year tax ÷ 4. Example: prior year tax = $22,000, AGI >$150k → quarterly safe harbor = $22,000 × 1.10 ÷ 4 = $6,050 per quarter. Subtract YTD withholding and prior quarterly payments already made to get the remaining balance due.

**Method B: Current Year Actual.** Annualize YTD income by multiplying by (12 ÷ months completed). Apply standard deduction or estimated itemized deductions from config. Calculate estimated federal income tax using current year tax brackets. For self-employment income, add 15.3% SE tax (12.4% Social Security on first $176,100, 2.9% Medicare — no cap) and subtract half the SE tax as a deduction. Subtract qualified business income deduction (QBI, up to 20% of qualified business income) if applicable. The result is the estimated annual tax liability; divide by 4 and subtract withholding and prior payments.

**Recommended payment.** Return the lower of Method A and Method B as the recommended quarterly payment. Show both calculations side by side for transparency. Include a note: "Penalty risk if no payment is made: approximately [calculated penalty using IRS underpayment rate × remaining balance]."

## Triggers

- "estimated tax"
- "quarterly payment due"
- "what do I owe this quarter"
- "calculate estimated tax"
- "Q1/Q2/Q3/Q4 estimate"
- "how much should I pay in estimated tax"
- "safe harbor calculation"
- "avoid underpayment penalty"

## Steps

1. Call `aireadylife-tax-extract-income-ytd` to get structured YTD income by source type
2. Read YTD withholding total from pay stub records in `vault/tax/00_current/`
3. Read prior quarterly estimated payments already made this year from `vault/tax/00_current/`
4. Calculate Method A (Safe Harbor): prior year liability from config × (1.0 or 1.1) ÷ 4, minus withholding and prior payments
5. Annualize YTD income (total × 12 ÷ months elapsed)
6. Apply estimated deductions (standard deduction or configured itemized estimate) to annualized income
7. Calculate Method B (Actual): estimate full-year federal income tax + SE tax if applicable − QBI deduction if applicable; divide by 4, subtract withholding and prior payments
8. Compare both methods; select the lower as the recommended payment
9. Calculate underpayment penalty risk if no payment is made (IRS rate × underpayment amount × days/365)
10. Write complete calculation to `vault/tax/00_current/YYYY-QN-estimate.md` with both methods shown

## Input

- `vault/tax/00_current/` — W-2 pay stubs and 1099 documents for YTD income
- `vault/tax/00_current/` — prior quarterly payments this year
- `vault/tax/01_prior/` — prior period records for trend comparison
- `vault/tax/config.md` — prior year tax liability, filing status, deduction method, SE income flag, QBI eligibility
- Income records from `vault/wealth/` or `vault/business/` if cross-plugin sharing is configured

## Output Format

Markdown document at `vault/tax/00_current/YYYY-QN-estimate.md`:
- Header: quarter, due date, run date
- YTD Income table: Source | YTD Amount | Notes
- YTD Withholding: total federal withheld + prior quarterly payments
- Method A (Safe Harbor): prior year liability, multiplier, quarterly amount, net due
- Method B (Actual): annualized income, estimated deductions, estimated tax, quarterly amount, net due
- Recommended Payment: [lower of A/B] — due by [date] via [IRS Direct Pay or EFTPS]
- Underpayment penalty estimate if no payment made

## Configuration

Required in `vault/tax/config.md`:
- `prior_year_tax_liability` — total federal tax from last year's return (Form 1040, line 24)
- `prior_year_agi` — AGI from last year's return (to determine 110% multiplier)
- `filing_status` — for tax bracket application
- `deduction_method` — standard | itemized (estimated itemized amount if itemizing)
- `se_income` — true | false (triggers SE tax calculation)
- `qbi_eligible` — true | false (triggers 20% QBI deduction)

## Error Handling

- If prior year tax liability is not in config: prompt "Prior year tax liability is required for the safe harbor calculation. Find it on your prior year Form 1040, line 24, and add it to vault/tax/config.md."
- If YTD income records are sparse (less than 2 months of data): note that the annualization may be inaccurate; recommend using Method A (safe harbor) for more reliability
- If the recommended payment is $0 or negative (withholding exceeds liability): report "Withholding appears sufficient — no estimated payment required this quarter" and explain why

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/tax/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/tax/00_current/` (income records)
- Reads from: `~/Documents/aireadylife/vault/tax/00_current/` (prior payments)
- Reads from: `~/Documents/aireadylife/vault/tax/config.md`
- Writes to: `~/Documents/aireadylife/vault/tax/00_current/YYYY-QN-estimate.md`
