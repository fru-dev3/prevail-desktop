---
id: dividend-income-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/schwab-dividend-income-${date}.json, kind: replace }
---
# Dividend Income Summary
The passive income your portfolio is throwing off, totaled and projected.
1. **Load.** Read `data/schwab-transactions-*.json` and `data/schwab-positions-*.json`.
2. **Collect.** Filter dividend and interest transactions for the period; sum by symbol and overall.
3. **Yield.** Estimate trailing yield per holding (income ÷ position value) and a portfolio-level yield.
4. **Project.** Extrapolate a forward annual income estimate and flag qualified vs ordinary where the data allows.
Output: a dividend/interest income summary by holding with portfolio yield and a forward projection.
