---
id: gains-and-tax-lots
runner: llm
trigger: on-demand
outputs:
  - { path: data/fidelity-gains-tax-lots-${date}.json, kind: replace }
---
# Gains and Tax Lots
Realized and unrealized gains by lot, with retirement accounts kept separate from taxable.
1. **Load.** Read `data/fidelity-positions-*.json` (cost basis, shares) and `data/fidelity-activity-*.json` (sales).
2. **Unrealized.** Per taxable holding, compute market value − cost basis and short- vs long-term holding period.
3. **Realized.** From sales in the tax year, compute proceeds − basis (FIFO unless lots specified) and split short- vs long-term.
4. **Opportunities.** Surface loss-harvest candidates and large long-term gains; exclude IRA/401k positions from tax-lot analysis. Read-only, never trade.
Output: a gains report covering taxable accounts with realized/unrealized totals, holding periods, and harvest candidates.
