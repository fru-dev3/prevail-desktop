---
id: crypto-holdings-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/coinbase-holdings-summary-${date}.json, kind: replace }
---
# Crypto Holdings Summary
A clear-eyed look at the volatile corner of your money, what you hold and what it's worth right now.
1. **Load.** Read the latest `data/coinbase-accounts-*.json`.
2. **Value.** For each asset, list quantity, current spot price, and USD value; total the portfolio.
3. **Allocate.** Compute each asset's percent of the crypto total and flag concentration (any single coin over ~40%).
4. **Context.** Note total crypto value as a line your wealth domain can weigh against the rest of your money.
Output: a holdings summary with per-asset value, allocation percentages, and concentration flags.
