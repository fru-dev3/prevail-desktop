---
id: dividend-income-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/fidelity-dividend-income-${date}.json, kind: replace }
---
# Dividend Income Summary
The income your holdings compound — totaled, yielded, and projected forward.
1. **Load.** Read `data/fidelity-dividends-*.json` and `data/fidelity-positions-*.json`.
2. **Collect.** Sum dividends, capital-gains distributions, and interest for the period by symbol and overall.
3. **Yield.** Estimate per-holding trailing yield (income ÷ value) and a portfolio yield; note reinvested vs cash.
4. **Project.** Extrapolate forward annual income and flag qualified vs ordinary where data allows.
Output: a dividend/distribution income summary by holding with portfolio yield and a forward projection.
