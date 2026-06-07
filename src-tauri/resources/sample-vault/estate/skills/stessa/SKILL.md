---
name: stessa
type: app
description: >
  Accesses rental income, expense tracking, cash flow reports, and property valuations from
  Stessa via Playwright. Used by estate-agent for property-level cash flow review, Schedule E
  prep, and tax-ready reporting. Free tier supports unlimited properties. Configure in vault/estate/config.md.
---

# Stessa

**Auth:** Playwright + Chrome cookies (headless=False required)
**URL:** https://app.stessa.com
**Configuration:** Set Stessa email and Chrome profile path in `~/Documents/aireadylife/vault/estate/config.md`

## Data Available

- **Income and expense tracking per property:** All transactions categorized by IRS Schedule E line item
- **Cash flow report (monthly/YTD per property):** Gross rent, expenses by category, NOI
- **Net operating income (NOI) per property:** Gross rent minus all operating expenses
- **Tax-ready reports (Schedule E prep):** Pre-formatted income and expense summary per property, per tax year
- **Property value estimates (Stessa AVM):** Automated valuation updated monthly — useful for equity and cap rate calculations
- **Document storage:** Leases, receipts, inspection reports, insurance policies
- **Transaction categorization by IRS category:** Automatically maps income/expenses to Schedule E line items
- **1099 generation:** Available for vendor payments if applicable

## Configuration

Add to `~/Documents/aireadylife/vault/estate/config.md`:
```
stessa_email: YOUR_STESSA_EMAIL
stessa_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

## Key Workflows

**Monthly cash flow pull:** Reports → Cash Flow → select property and date range → Export CSV or view on screen. Data maps directly to the estate cash flow analysis: gross rent, vacancy, operating expenses by category, NOI.

**Schedule E prep (annual):** Reports → Tax Package → select year → generates PDF with all income and expense totals per property in Schedule E format. This is the primary year-end export to hand to your CPA.

**Property value (for cap rate calculation):** Dashboard → each property card shows Stessa AVM estimate. Use as the denominator in cap rate calculation: annual NOI ÷ Stessa AVM = cap rate. More conservative than Zestimate for established properties.

**Receipt storage:** Upload receipt images to each transaction. Stessa stores them linked to the transaction, making audit trails complete.

## Notes

- Requires headless=False for Playwright sessions — Stessa uses session cookies and some dynamic rendering
- Free tier supports unlimited properties with full income/expense tracking (no paywall for core features)
- Premium tier (Stessa Pro) adds smart receipts, automated bank feeds, and lender reporting
- CSV export available for all reports — import into the vault for local analysis

## Used By

- `aireadylife-estate-cash-flow-review` — pull property-level income and expense report for the current month
- `aireadylife-estate-portfolio-review` — pull cross-property NOI summary and Stessa AVM for equity calculations

## Vault Output

`~/Documents/aireadylife/vault/estate/00_current/`
