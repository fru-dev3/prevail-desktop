---
id: portfolio-allocation-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/robinhood-allocation-${date}.json, kind: replace }
---
# Portfolio Allocation Review
What the active edge of your portfolio is actually betting on right now.
1. **Load.** Read the latest `data/robinhood-positions-*.json`.
2. **Total.** Sum market value across positions plus cash/buying power.
3. **Allocate.** Compute each position as a percent of the total; group by asset type (stock / ETF / option / crypto) where tagged.
4. **Flag.** Highlight concentration (single name over ~15%), options exposure, and how the speculative slice compares to the whole.
Output: an allocation review with per-position weights, asset-type mix, and concentration flags.
