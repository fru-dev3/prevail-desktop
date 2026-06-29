---
id: net-worth-snapshot
runner: llm
trigger: on-demand
description: A clean point-in-time net worth statement: assets, liabilities, and the trend that matters.
source: seed
---
# Net worth snapshot

Run quarterly, or any time a major balance changes.

1. **Tally the sides.** From data/net-worth-history.json and data/holdings.csv: total liquid, invested, and real assets on one side; mortgage and any other debt on the other. State the single net figure.
2. **Trend, not snapshot.** Plot the last four data points. Is net worth rising, and is the rise driven by contributions you control or by markets you don't?
3. **Liquidity layer.** Separate what is reachable this week (cash, taxable brokerage) from what is locked (401k, home equity). A big number with thin liquidity is a different situation than it looks.
4. **One watch item.** Name the one balance to keep an eye on next quarter — a debt to retire, a concentration to trim, or a cash pile to deploy.

Output: a two-sided statement, the net figure, the trend read, and one watch item.
