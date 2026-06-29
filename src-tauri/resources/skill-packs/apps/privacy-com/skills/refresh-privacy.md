---
id: refresh-privacy
runner: llm
trigger: refresh
outputs:
  - { path: data/privacy-cards-${date}.json, kind: replace }
  - { path: data/privacy-transactions-${date}.json, kind: replace }
---
# Refresh Privacy.com
Pull your virtual cards and their transactions into the vault so every merchant and subscription is accounted for. Read-only, never create, close, pause, or change a card.
1. **Auth.** Use the connected Privacy.com API key (read-only) against `https://api.privacy.com/v1`.
2. **Cards.** `GET /v1/cards`, list every virtual card with state (OPEN/PAUSED/CLOSED), type (single-use / merchant-locked / unlocked), spend limit, and limit duration.
3. **Transactions.** `GET /v1/transactions` (paginate), pull authorizations and settlements with merchant name, amount, status, and card token.
4. **Save.** Write cards and transactions to their `data/privacy-*-${date}.json` files.
Output: a dated snapshot of all virtual cards and their transaction history.
