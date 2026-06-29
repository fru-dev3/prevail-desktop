---
id: fees-and-bitcoin-activity
runner: llm
trigger: on-demand
outputs:
  - { path: data/cashapp-fees-bitcoin-${date}.json, kind: replace }
---
# Fees and Bitcoin Activity
The small leaks (fees) and the taxable corner (Bitcoin/stock) inside Cash App.
1. **Load.** Read the latest `data/cashapp-transactions-*.json`.
2. **Fees.** Sum instant-deposit fees, ATM fees, and Bitcoin transaction fees for the period.
3. **Crypto/stock.** List Bitcoin and stock buys/sells with amounts and dates; flag sells as potential taxable events.
4. **Summarize.** Total fees paid and net crypto/stock position changes.
Output: a summary of total fees paid plus Bitcoin/stock buys and sells flagged for taxes.
