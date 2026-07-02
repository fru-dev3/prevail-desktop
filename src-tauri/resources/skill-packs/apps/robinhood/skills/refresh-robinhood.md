---
id: refresh-robinhood
runner: browser-agent
trigger: refresh
goal: Log into Robinhood and download read-only account data, current positions, account value, order/trade history, dividends, and any available account statements. Do not place, modify, or cancel trades; do not transfer or withdraw funds.
domain_allow:
  - robinhood.com
outputs:
  - { path: data/robinhood-positions-${date}.json, kind: replace }
  - { path: data/robinhood-orders-${date}.json, kind: replace }
  - { path: data/robinhood-dividends-${date}.json, kind: replace }
---
# Refresh Robinhood
Bring your positions and trades into the vault so the active edge of your portfolio is weighed against the rest of your money. Strictly read-only.
1. **Open.** Navigate to robinhood.com and confirm the session is signed in.
2. **Positions.** From the home/portfolio view, capture each holding (symbol, shares, average cost, current price, market value) plus total account and buying power.
3. **History.** Open Account → History to read order/trade history and the dividends/interest list for the period; download statements if offered.
4. **Save.** Write positions, orders, and dividends to their `data/robinhood-*-${date}.json` files. Never buy, sell, cancel, or move money.
Output: a dated snapshot of Robinhood positions, trade history, and dividend activity.
