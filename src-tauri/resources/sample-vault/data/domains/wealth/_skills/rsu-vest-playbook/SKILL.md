---
id: rsu-vest-playbook
runner: llm
trigger: on-demand
description: What to do the week RSUs vest: taxes set aside, sell/hold decision, and where proceeds go.
source: seed
---
# RSU vest playbook

Run the week of any RSU vest (see career/data/rsu-schedule.csv).

1. **The number.** Shares vesting, price, gross value, and the tax actually withheld vs the marginal rate. The gap is a bill, not a bonus.
2. **Sell or hold.** Default is sell-on-vest (a vest is income; holding it is a fresh decision to buy employer stock). Argue the exception only from concentration limits, not from feelings about the stock.
3. **Destination.** Route proceeds by standing priority: tax set-aside first, then the current goal from goals.md, then taxable investing per allocation.
4. **Record it.** One line in the decisions ledger with date, shares, price, and where the money went.

Output: the four numbers, the sell/hold call with the reason, and the routing.
