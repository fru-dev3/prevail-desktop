---
id: refresh-schwab
runner: llm
trigger: refresh
outputs:
  - { path: data/schwab-accounts-${date}.json, kind: replace }
  - { path: data/schwab-positions-${date}.json, kind: replace }
  - { path: data/schwab-transactions-${date}.json, kind: replace }
---
# Refresh Charles Schwab
Pull Schwab's holdings, trades, and balances into the vault so your AI sees the full picture behind your financial decisions. Read-only, never place or cancel an order.
1. **Auth.** Use the connected Schwab Trader API OAuth token; resolve account hashes via `GET /trader/v1/accounts/accountNumbers`.
2. **Balances & positions.** `GET /trader/v1/accounts?fields=positions` for each account, cash, securities, market value, and per-position quantity/cost basis.
3. **History.** `GET /trader/v1/accounts/{accountNumber}/transactions` for trades, dividends, interest, and transfers over the period.
4. **Save.** Write accounts, positions, and transactions to their `data/schwab-*-${date}.json` files.
Output: a dated snapshot of Schwab balances, positions, and transaction history.
