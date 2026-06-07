---
name: m1-finance
type: app
description: >
  Accesses automated investment portfolio data from M1 Finance via Playwright with
  Chrome cookie authentication. Downloads portfolio value and total return, pie
  allocation (target vs. actual percentages), individual positions with cost basis,
  dividend history, and monthly statements. Also retrieves tax documents (1099-B,
  1099-DIV). Used by the wealth agent for investment review, allocation drift analysis,
  and tax document retrieval. Requires headless=False.
---

# M1 Finance

**Auth:** Playwright + Chrome cookies (headless=False required)
**URL:** https://app.m1.com
**Configuration:** Set Chrome profile path in `vault/wealth/config.md`

## Data Available

| Data Type | Navigation Path | Notes |
|-----------|----------------|-------|
| Portfolio total value | Dashboard | Total portfolio value, today's change, all-time return |
| Pie allocation | Invest → Pie | Target vs. actual allocation % per slice |
| Holdings | Invest → Holdings | Each position: shares, current price, value, cost basis, unrealized P&L |
| Dividend history | Invest → Activity → Dividends | Date, amount, reinvested flag |
| Portfolio performance | Invest → Performance | Time-weighted return chart; export not always available |
| Monthly statements | Account → Documents | PDF per month |
| Tax documents | Account → Documents → Tax Documents | 1099-B (gains/losses), 1099-DIV |
| Account history | Account → Activity | All transactions: trades, transfers, dividends |

## Configuration

Add to `vault/wealth/config.md`:
```
m1_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Profile 2
m1_accounts:
  - nickname: "M1 Brokerage"
    type: brokerage
  - nickname: "M1 IRA"
    type: ira-roth
```

## M1-Specific Notes

- M1 uses a "pie" structure: each pie has target allocation slices (e.g., "70% VTI, 30% BND"). The allocation drift check compares target slice % to actual slice % within each pie, and then the pie-level allocation to total portfolio target.
- M1 auto-invests new deposits according to pie targets — the allocation drift from deposits is typically small; drift accumulates from differential market returns across slices.
- M1 Plus subscribers have access to more performance data; free tier has some limitations.
- Tax documents typically available by late January / early February.

## Used By

- `aireadylife-wealth-investment-review` — pull portfolio value, allocation, and dividend income
- `aireadylife-wealth-net-worth-review` — contribute brokerage value to net worth snapshot

## Vault Output

- `vault/wealth/00_current/m1/` — holdings snapshots, pie allocation records
- `vault/wealth/00_current/m1/statements/` — monthly statement PDFs
- `vault/wealth/00_current/m1/tax-docs/` — 1099-B, 1099-DIV
