---
id: dividend-income-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/robinhood-dividend-income-${date}.json, kind: replace }
---
# Dividend Income Summary
The income your holdings pay out, totaled so it's not lost in the noise of trading.
1. **Load.** Read `data/robinhood-dividends-*.json` and `data/robinhood-positions-*.json`.
2. **Collect.** Sum dividends and interest received over the period by symbol and overall.
3. **Yield.** Estimate per-holding trailing yield (income ÷ position value) and a portfolio yield.
4. **Project.** Extrapolate a forward annual income estimate from recurring payers.
Output: a dividend income summary by holding with portfolio yield and a forward projection.
