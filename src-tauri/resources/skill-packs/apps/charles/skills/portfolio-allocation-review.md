---
id: portfolio-allocation-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/schwab-allocation-${date}.json, kind: replace }
---
# Portfolio Allocation Review
How the long game is actually positioned, across assets, sectors, and single names.
1. **Load.** Read the latest `data/schwab-positions-*.json` and `data/schwab-accounts-*.json`.
2. **Total.** Sum market value across all accounts including cash.
3. **Allocate.** Break down by asset class (equity / ETF / fixed income / cash) and by individual position as a percent of total.
4. **Flag.** Call out concentration (any single holding over ~10%), cash drag, and drift from a typical target if one is noted.
Output: an allocation review with asset-class and position-level weights plus concentration flags.
