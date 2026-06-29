---
id: gains-and-tax-lots
runner: llm
trigger: on-demand
outputs:
  - { path: data/schwab-gains-tax-lots-${date}.json, kind: replace }
---
# Gains and Tax Lots
Unrealized and realized gains, lot by lot, so tax decisions aren't a year-end scramble.
1. **Load.** Read `data/schwab-positions-*.json` (cost basis, quantity) and `data/schwab-transactions-*.json` (sales).
2. **Unrealized.** Per position, compute market value − cost basis and tag holding period short vs long term.
3. **Realized.** From sale transactions in the tax year, compute proceeds − basis and split short- vs long-term.
4. **Opportunities.** Surface lots with losses for harvesting and large embedded gains to hold for long-term treatment. Read-only — never sell.
Output: a gains report with realized and unrealized totals, holding periods, and harvest candidates.
