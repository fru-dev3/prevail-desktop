---
name: fidelity
type: app
description: >
  Accesses brokerage and retirement account data from Fidelity Investments via
  Playwright with Chrome cookie authentication. Downloads account balances, current
  holdings with market values, portfolio performance (day/month/YTD/all-time), monthly
  statements, and tax documents (1099-R, 1099-B, 1099-DIV). Used by the wealth agent
  for investment review, net worth tracking, and tax document sync. Requires
  headless=False. Configure Chrome profile path in vault/wealth/config.md.
---

# Fidelity

**Auth:** Playwright + Chrome cookies (cookie-based session; headless=False required)
**URL:** https://www.fidelity.com
**Configuration:** Set Chrome profile path in `vault/wealth/config.md`

## Data Available

| Data Type | Navigation Path | Notes |
|-----------|----------------|-------|
| Account balances | Accounts → Portfolio | All accounts: brokerage, IRA, 401k rollover, HSA |
| Holdings | Accounts → Positions | Ticker, shares, current price, market value, cost basis |
| Performance | Accounts → Performance | Time-weighted return: 1-day, 1-month, YTD, 1-year, 3-year, 5-year |
| Transaction history | Accounts → History | Trades, dividends, contributions, withdrawals |
| Monthly statements | Accounts → Statements & Documents → Statements | PDF per account per month |
| Tax documents | Accounts → Statements & Documents → Tax Forms | 1099-R (IRA distributions), 1099-B (brokerage gains/losses), 1099-DIV |
| Pending dividends | Accounts → Pending Activity | Scheduled dividend reinvestments |

## Configuration

Add to `vault/wealth/config.md`:
```
fidelity_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Profile 1
fidelity_accounts:
  - nickname: "Fidelity 401k Rollover"
    type: ira-traditional
  - nickname: "Fidelity Roth IRA"
    type: ira-roth
  - nickname: "Fidelity Brokerage"
    type: brokerage
```

## Session Notes

- Session cookies are valid for 30–60 days depending on last active date
- Re-authentication triggered by Fidelity security checks (new IP, long inactivity)
- If 2FA is triggered during automation, complete it manually in the launched Chrome window
- Download path: Accounts → Statements & Documents → select account → select month → Download

## Used By

- `aireadylife-wealth-investment-review` — pull account balances, holdings, and performance data
- `aireadylife-wealth-net-worth-review` — contribute retirement and brokerage balances to net worth
- Tax document sync — download 1099s when available (typically mid-to-late January)

## Vault Output

- `vault/wealth/00_current/fidelity/` — holdings snapshots and performance records
- `vault/wealth/00_current/fidelity/statements/` — monthly statement PDFs
- `vault/wealth/00_current/fidelity/tax-docs/` — 1099-R, 1099-B, 1099-DIV
