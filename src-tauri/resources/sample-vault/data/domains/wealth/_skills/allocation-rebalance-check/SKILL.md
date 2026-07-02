---
id: allocation-rebalance-check
runner: llm
trigger: on-demand
description: Compare current holdings to target allocation and decide whether a rebalance is worth the cost.
source: seed
---
# Allocation rebalance check

Run twice a year, or after a large market move.

1. **Current vs target.** From data/holdings.csv, sum each asset class (US equity, international, bonds, cash) as a percent of the portfolio and lay it beside the target from goals.md.
2. **Drift that matters.** Flag any class more than 5 points off target. Smaller drift is noise; rebalancing it just generates costs.
3. **Rebalance without selling first.** Prefer to correct drift by directing new contributions and any RSU proceeds into the underweight class before triggering a taxable sale.
4. **Tax-aware moves.** If a sale is needed, do it inside tax-advantaged accounts (401k, IRA) where it's free of capital-gains drag; coordinate any taxable lots with the tax domain.

Output: the current-vs-target table, the classes off by more than 5 points, and the specific buy/sell to correct it.
