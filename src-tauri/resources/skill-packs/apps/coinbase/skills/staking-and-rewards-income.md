---
id: staking-and-rewards-income
runner: llm
trigger: on-demand
outputs:
  - { path: data/coinbase-rewards-income-${date}.json, kind: replace }
---
# Staking and Rewards Income
The income trickling in from staking and rewards — easy to miss, taxable all the same.
1. **Load.** Read `data/coinbase-transactions-*.json`.
2. **Filter.** Isolate transaction types like `staking_reward`, `inflation_reward`, and `interest` over the period.
3. **Value.** Sum reward quantity per asset and its USD value at receipt (ordinary income basis).
4. **Total.** Report year-to-date rewards income by asset and combined, flagging it for the tax domain.
Output: a rewards/staking income summary by asset with USD value at receipt and a YTD total.
