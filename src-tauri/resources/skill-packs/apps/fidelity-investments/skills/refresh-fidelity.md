---
id: refresh-fidelity
runner: browser-agent
trigger: refresh
goal: Log into Fidelity and download read-only account data — positions and balances across brokerage and retirement accounts, transaction/activity history, dividends, and available account statements. Do not place trades, transfer, or withdraw funds.
domain_allow:
  - fidelity.com
  - digital.fidelity.com
outputs:
  - { path: data/fidelity-positions-${date}.json, kind: replace }
  - { path: data/fidelity-activity-${date}.json, kind: replace }
  - { path: data/fidelity-dividends-${date}.json, kind: replace }
---
# Refresh Fidelity
Where your long game compounds — retirement, brokerage, the future you're funding — kept in view so every dollar is accounted for. Strictly read-only.
1. **Open.** Navigate to fidelity.com and confirm the session is signed in.
2. **Positions.** From Accounts → Positions, capture each account (brokerage, IRA, 401k) with holdings — symbol, shares, cost basis, current value — and balances.
3. **Activity.** Open Activity & Orders / History to read transactions, contributions, and the dividends/interest list for the period; download statements if offered.
4. **Save.** Write positions, activity, and dividends to their `data/fidelity-*-${date}.json` files. Never trade or move money.
Output: a dated snapshot of Fidelity positions across all accounts, activity history, and dividends.
