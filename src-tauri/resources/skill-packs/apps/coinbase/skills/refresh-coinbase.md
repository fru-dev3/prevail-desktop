---
id: refresh-coinbase
runner: llm
trigger: refresh
outputs:
  - { path: data/coinbase-accounts-${date}.json, kind: replace }
  - { path: data/coinbase-transactions-${date}.json, kind: replace }
  - { path: data/coinbase-fills-${date}.json, kind: replace }
---
# Refresh Coinbase
Pull your crypto holdings, moves, and gains so the volatile corner of your money is something you can actually see clearly. Read-only scopes only — never place, cancel, or transfer.
1. **Auth.** Use the connected Coinbase API key (read-only). Confirm access with a `GET /api/v3/brokerage/accounts`.
2. **Balances.** List every wallet/account and its crypto balance plus current spot value (`GET /v2/accounts`, `GET /api/v3/brokerage/accounts`).
3. **Activity.** For each account pull transaction history — buys, sells, sends, receives, rewards (`GET /v2/accounts/:id/transactions`) and historical fills (`GET /api/v3/brokerage/orders/historical/fills`).
4. **Save.** Write balances, transactions, and fills to their `data/coinbase-*-${date}.json` files.
Output: a dated snapshot of crypto balances, full transaction history, and trade fills.
