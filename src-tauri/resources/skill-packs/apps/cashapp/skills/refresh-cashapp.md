---
id: refresh-cashapp
runner: llm
trigger: refresh
outputs:
  - { path: data/cashapp-transactions-${date}.json, kind: replace }
  - { path: data/cashapp-balance-${date}.json, kind: replace }
---
# Refresh Cash App
Pull your Cash App balance and activity into the vault so day-to-day money in and out is visible alongside everything else. Read-only, never send a payment or move money.
1. **Auth.** Use the connected Cash App credentials/token (read-only).
2. **Balance.** Read the current Cash App balance and any linked card/savings balance.
3. **Activity.** Pull transaction history for the period (peer payments sent/received, Cash Card purchases, deposits, ATM withdrawals, and Bitcoin/stock activity) with merchant, amount, date, and direction.
4. **Save.** Write transactions and balance to their `data/cashapp-*-${date}.json` files.
Output: a dated snapshot of Cash App balance and full transaction activity.
