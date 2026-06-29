---
id: portfolio-allocation-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/fidelity-allocation-${date}.json, kind: replace }
---
# Portfolio Allocation Review
How the long game is positioned across every account that funds your future.
1. **Load.** Read the latest `data/fidelity-positions-*.json`.
2. **Total.** Sum market value across all accounts (brokerage + retirement) including cash and money-market.
3. **Allocate.** Break down by asset class (equity / bond / fund / cash) and by individual holding as a percent of total; note taxable vs tax-advantaged split.
4. **Flag.** Call out concentration (single holding over ~10%), overlap across funds, and cash drag.
Output: an allocation review with asset-class and holding weights, account-type split, and concentration flags.
