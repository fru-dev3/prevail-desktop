---
name: quickbooks
type: app
description: >
  Pulls P&L, balance sheet, and transaction data from QuickBooks Online for
  business performance tracking and financial reporting. Used by business-agent
  for monthly P&L review. Configure in vault/business/config.md.
---

# QuickBooks

**Auth:** Intuit account login (Playwright + Chrome cookies)
**URL:** https://app.qbo.intuit.com
**Configuration:** Set your Intuit account credentials in `vault/business/config.md`

## Data Available

- Profit & Loss report (monthly, quarterly, YTD)
- Balance Sheet (assets, liabilities, equity snapshot)
- Transaction list by category (CSV export)
- Revenue by customer or product/service
- Expense breakdown by vendor and category
- Accounts receivable aging report
- Bank feed reconciliation status

## Configuration

Add to `vault/business/config.md`:
```
quickbooks_email: YOUR_INTUIT_EMAIL
quickbooks_company_id: YOUR_COMPANY_ID
quickbooks_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

## Key Reports

- Reports → Profit and Loss → set date range → export CSV
- Reports → Balance Sheet → export CSV
- Reports → Transaction List by Date → export CSV

## Used By

- `aireadylife-business-pl-review` — generate monthly P&L and flag variances
- `aireadylife-business-build-pl-summary` — produce formatted P&L summary report

## Vault Output

`vault/business/financials/`
