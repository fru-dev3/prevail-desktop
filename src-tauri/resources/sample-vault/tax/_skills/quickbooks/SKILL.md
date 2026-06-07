---
name: quickbooks
type: app
description: >
  Pulls Profit & Loss reports, Balance Sheet, and transaction-level expense data from
  QuickBooks Online via Playwright with Intuit account authentication. Used by the tax
  agent to identify deductible business expenses by category, extract net business
  income for self-employment tax calculation, and produce the business income summary
  for the accountant package. Also used by the business agent for P&L tracking.
  Configure Intuit email and Chrome profile in vault/tax/config.md.
---

# QuickBooks

**Auth:** Intuit account login via Playwright + Chrome cookies (headless=False required)
**URL:** https://app.qbo.intuit.com
**Configuration:** Set Intuit email, company ID, and Chrome profile in `vault/tax/config.md`

## Data Available

| Report | Navigation Path | Tax Use |
|--------|----------------|---------|
| Profit & Loss (YTD) | Reports → Profit and Loss → set date range to YTD | Net business income for SE tax and estimated payment |
| Profit & Loss (monthly) | Reports → Profit and Loss → set date range to current month | Monthly deduction review |
| Balance Sheet | Reports → Balance Sheet | Depreciation tracking, loan balances |
| Transaction List | Reports → Transaction List by Date → export CSV | Line-item deduction categorization |
| Expense by Vendor | Reports → Expenses by Vendor Summary | Identify large vendors for 1099-NEC thresholds |
| Bank Reconciliation | Banking → Reconcile | Confirm all expenses are captured |

## Configuration

Add to `vault/tax/config.md`:
```
quickbooks_email: YOUR_INTUIT_EMAIL
quickbooks_company_id: YOUR_COMPANY_ID
quickbooks_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

Find company ID in QBO: Settings → Account and Settings → Billing & Subscription (shown in URL as `/app/homepage/orgs/{COMPANY_ID}`)

## Key Reports for Tax Use

**For estimated tax calculation:**
- Run P&L YTD → export as CSV → read net income (revenue minus all expenses) → this is the input for SE income in the quarterly estimate

**For deduction review:**
- Run Transaction List by Date → filter to current month → export CSV → each expense line maps to a deduction category

**1099-NEC threshold tracking:**
- Run Expenses by Vendor → any vendor paid ≥$600 as a non-employee may require a 1099-NEC from the business (if the business is the payer, not the recipient)

## Notes

- Requires headless=False for Intuit session management
- QBO sessions expire after 60 days of inactivity; re-authenticate when needed
- If the company uses QuickBooks Desktop (not Online), exports must be done manually as PDF or IIF

## Used By

- `aireadylife-tax-deduction-review` — pull categorized business expenses for deduction analysis
- `aireadylife-tax-build-estimate` — read net SE income for quarterly tax calculation
- `aireadylife-business-pl-review` — pull P&L for business performance review (if business plugin installed)

## Vault Output

- `vault/tax/00_current/YYYY/qbo-transactions-YYYY-MM.csv` — monthly transaction export
- `vault/tax/00_current/YYYY/qbo-pl-ytd.csv` — YTD P&L export for estimated tax
