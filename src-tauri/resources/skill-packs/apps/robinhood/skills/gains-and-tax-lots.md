---
id: gains-and-tax-lots
runner: llm
trigger: on-demand
outputs:
  - { path: data/robinhood-gains-tax-lots-${date}.json, kind: replace }
---
# Gains and Tax Lots
The realized and unrealized P&L behind the trades, ready for tax season.
1. **Load.** Read `data/robinhood-positions-*.json` (avg cost, shares) and `data/robinhood-orders-*.json` (buys/sells).
2. **Unrealized.** Per holding, compute market value − cost basis and the holding period (short vs long term).
3. **Realized.** From sell orders in the tax year, match to buys (FIFO) and compute proceeds − basis, split short- vs long-term.
4. **Watch.** Flag positions near the 1-year long-term threshold and any potential wash-sale patterns. Read-only, never trade.
Output: a gains report with realized/unrealized totals, holding periods, and tax-timing flags.
