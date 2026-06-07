---
name: aireadylife-tax-op-quarterly-estimate
type: op
cadence: quarterly
description: >
  Calculates the current quarter's estimated federal tax payment. Aggregates YTD income
  from all sources, subtracts YTD withholding and prior estimated payments, and runs
  both the safe harbor method (110% of prior year liability if AGI >$150k) and the
  actual current-year method. Returns the lower of the two as the recommended payment.
  Quantifies underpayment penalty risk if no payment is made. Triggers: "estimated
  tax", "quarterly payment due", "what do I owe this quarter", "calculate Q1/Q2/Q3/Q4
  estimate", "safe harbor payment".
---

# aireadylife-tax-quarterly-estimate

**Cadence:** Quarterly (due dates: April 15, June 15, September 15, January 15)
**Produces:** Estimated tax calculation at `vault/tax/00_current/YYYY-QN-estimate.md`; deadline flag in `vault/tax/open-loops.md`

## What It Does

Runs in the 2–4 weeks before each quarterly estimated tax deadline to determine whether a payment is needed and exactly how much to pay. The op is designed to give a definitive answer — not a range — by running both recognized IRS methods and returning the lower result.

The op calls `aireadylife-tax-build-estimate` to produce the full calculation. The calculation logic applies the key IRS rules:

**Safe harbor method.** The most reliable method when prior year income is known: pay 100% of prior year tax liability (or 110% if prior year AGI exceeded $150,000) divided by 4 per quarter. This method entirely eliminates underpayment penalties regardless of what the actual current-year tax turns out to be. Example: prior year tax = $28,000, prior year AGI = $190,000 → safe harbor = $28,000 × 1.10 ÷ 4 = $7,700/quarter. If two quarterly payments have already been made, the safe harbor balance for Q3 = ($7,700 × 3) − payments made. This is the calculation the op performs: cumulative safe harbor requirement through this quarter, minus cumulative payments already made.

**Actual method.** Projects full-year tax from YTD income, annualizes it, divides by 4. More complex but can produce a lower payment when income is declining or front-loaded. The op uses YTD income data from `aireadylife-tax-extract-income-ytd` and applies the current year's tax brackets and standard or itemized deductions.

**Self-employment tax.** If SE income is present, the op adds 15.3% SE tax (12.4% Social Security on first $176,100 of net SE income + 2.9% Medicare with no cap; plus 0.9% Additional Medicare on net SE income above $200,000 single / $250,000 MFJ) and subtracts half the SE tax as a deduction from AGI.

**QBI deduction.** If the user qualifies for the Section 199A QBI deduction (up to 20% of qualified business income), it is applied in the actual method calculation. Eligibility and limitations (W-2 wage and capital limitation for higher-income taxpayers) are checked against the config-configured estimate.

**Underpayment penalty.** If the recommended payment is not made, the op calculates the estimated underpayment penalty using the IRS underpayment rate (federal short-term rate + 3%; currently approximately 8%) applied to the shortfall for the days in the quarter.

The op flags the payment with the due date and specific payment method: IRS Direct Pay for immediate one-time payments (irs.gov/payments, select "Estimated Tax"), EFTPS for scheduled payments, or state portal for state estimated payments.

## Calls

- **Flows:** `aireadylife-tax-build-estimate`
- **Tasks:** `aireadylife-tax-flag-approaching-deadline`, `aireadylife-tax-update-open-loops`

## Apps

- `irs` — optional; verify prior payments on IRS transcript and confirm payment received

## Vault Output

- `vault/tax/00_current/YYYY-QN-estimate.md` — full estimated tax calculation with both methods
- `vault/tax/open-loops.md` — payment due flag with amount, deadline, and method

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/tax/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/tax/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/tax/02_briefs/` — prior briefs for period-over-period context
