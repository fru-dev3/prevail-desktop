---
id: realized-gains-for-taxes
runner: llm
trigger: on-demand
outputs:
  - { path: data/coinbase-realized-gains-${date}.json, kind: replace }
---
# Realized Gains for Taxes
The taxable events hiding in your trade history, lined up before filing season.
1. **Load.** Read `data/coinbase-transactions-*.json` and `data/coinbase-fills-*.json`.
2. **Find disposals.** Isolate sells and conversions (crypto-to-crypto counts as a disposal) within the tax year.
3. **Match basis.** Pair each disposal to its acquisition cost (default FIFO) and compute proceeds − basis per lot.
4. **Classify.** Split realized gains/losses into short-term (<1yr) and long-term (≥1yr); total each and note reward/income receipts taxable as ordinary income.
Output: a realized gains report with short- vs long-term totals and a per-disposal lot list for tax prep.
