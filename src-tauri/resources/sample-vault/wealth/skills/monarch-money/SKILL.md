---
name: monarch-money
type: app
description: >
  Pulls transaction history, spending by category, budget vs. actual, net worth
  snapshot, and recurring transaction data from Monarch Money via Playwright or CSV
  export. Monarch aggregates all linked bank, credit card, brokerage, and loan
  accounts in one place. Used by the wealth agent for cash flow analysis, budget
  tracking, and cross-institution net worth. Configure email and Chrome profile in
  vault/wealth/config.md.
---

# Monarch Money

**Auth:** Playwright + Chrome cookies, or manual CSV export
**URL:** https://www.monarchmoney.com
**Configuration:** Set credentials and Chrome profile in `vault/wealth/config.md`

## Data Available

| Data Type | Access Method | Notes |
|-----------|--------------|-------|
| Transaction history | CSV export or scrape | All accounts: date, amount, merchant, category, account |
| Spending by category | CSV export or scrape | Month-to-date and historical by category |
| Budget vs. actual | Scrape dashboard | Per category: budget, spent, remaining |
| Net worth snapshot | Scrape dashboard | Assets and liabilities as of today across all linked accounts |
| Account balances | Scrape | All linked institutions: bank, brokerage, loans |
| Recurring transactions | Scrape | Auto-detected subscriptions and recurring charges |
| Cash flow history | CSV export | Monthly income and expense totals by category, historical |

## Configuration

Add to `vault/wealth/config.md`:
```
monarch_email: YOUR_EMAIL
monarch_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
monarch_export_path: ~/Documents/aireadylife/vault/wealth/00_current/imports/
```

## CSV Export (Recommended for Transaction History)

Settings → Export → Transactions → set date range → Download CSV

The CSV contains: Date, Merchant, Category, Account, Amount, Notes, Tags.

Save to `vault/wealth/00_current/imports/YYYY-MM-transactions.csv` before running the cash flow review.

## Monarch-Specific Notes

- Monarch is the recommended primary transaction source — it normalizes categories across all linked institutions
- Category assignments may need manual correction for some merchants (Monarch allows training)
- Net worth from Monarch can be used as a cross-check against the vault's own net worth calculation
- Monarch's "Cash Flow" report is the easiest way to get a monthly income vs. expense total; export it as CSV

## Used By

- `aireadylife-wealth-cash-flow-review` — primary source for monthly transaction data and budget vs. actual
- `aireadylife-wealth-build-cash-flow-summary` — read categorized transactions to build the cash flow summary
- `aireadylife-wealth-net-worth-review` — optional cross-check against Monarch's aggregated net worth

## Vault Output

- `vault/wealth/00_current/imports/YYYY-MM-transactions.csv` — imported transaction file
- `vault/wealth/00_current/YYYY-MM-cashflow.md` — written by the cash flow review skill after processing the import
