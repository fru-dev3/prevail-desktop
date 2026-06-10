# AI Ready Life: Tax — Config

> Fill in your details. Skills read this file to personalize their output.
> Leave a field blank rather than guessing — the agent will flag it.

## Identity
name: Alex Rivera
spouse_name: Jordan Rivera
filing_status: Married filing jointly
state_of_residence: Texas
ssn_last4: 4188
spouse_ssn_last4: 7702

## Employment
employer_name: TechFlow Inc
w2_withholding_ytd: 21800
federal_withholding_extra_per_paycheck: 0
pay_frequency: semi-monthly

## CPA / Tax Advisor
cpa_name: Maria Gonzalez
cpa_email: maria@austincpagroup.com
cpa_phone: (512) 555-0148
cpa_firm: Austin CPA Group
tax_return_storage_location: home safe + Austin CPA Group client portal

## Business Entities
# One per line: entity name | type (LLC/S-corp/sole-prop) | EIN last4 | state
entity_names:
  - Alex Rivera Consulting LLC | single-member LLC (Schedule C) | 6043 | TX

## Estimated Tax Payments
# Quarterly estimated taxes (if self-employed or entity income)
estimated_tax_payment_method: IRS Direct Pay
bank_for_eftps: Chase checking ...4471
irs_direct_pay_enrolled: yes
state_estimated_tax_method: none (Texas has no state income tax)

## Prior Year Reference
prior_year_federal_agi: 248300
prior_year_federal_tax_owed: 38600
prior_year_state_tax_owed: 0
prior_year_return_filed_date: 2026-03-28

## Key Documents Expected This Year
# Comma-separated: W-2, 1099-INT, 1099-DIV, 1099-B, 1099-NEC, K-1, etc.
expected_tax_documents: W-2 (Alex), W-2 (Jordan), 1099-NEC (Acme/Bluepeak/Hopeline), 1099-INT, 1099-DIV, 1098 mortgage interest (Austin + Phoenix), property tax statements

## Deductions
home_office_sqft: 130
home_total_sqft: 1850
hsda_contribution_annual: 4150
charitable_donation_ytd: 900
student_loan_interest_ytd: 0
mileage_tracked: yes (consulting client visits)

## State
state_income_tax_rate: 0% (Texas)
state_filing_deadline: none (no state income tax return)
