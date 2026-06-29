---
id: peer-payment-and-income-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/cashapp-payments-income-${date}.json, kind: replace }
---
# Peer Payment and Income Review
Who you're paying, who's paying you, and what counts as income.
1. **Load.** Read the latest `data/cashapp-transactions-*.json`.
2. **Split.** Separate peer payments sent from received, plus deposits and direct-deposit inflows.
3. **Counterparties.** Rank top recipients and senders by total amount and frequency.
4. **Income flag.** Tag recurring inflows that look like income or business receipts the tax/money domain should track.
Output: a review of net peer-to-peer flow, top counterparties, and flagged income inflows.
