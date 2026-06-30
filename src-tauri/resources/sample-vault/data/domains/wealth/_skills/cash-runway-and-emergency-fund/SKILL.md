---
id: cash-runway-and-emergency-fund
runner: llm
trigger: on-demand
description: How many months of expenses the cash covers, against target, with a plan to close any gap.
source: seed
---
# Cash runway and emergency fund

Run quarterly and after any income change.

1. **Monthly burn.** From data/transactions.csv, compute true average monthly outflow over the last three months — essentials separated from discretionary, so the floor is clear.
2. **Runway today.** Divide accessible cash (from data/holdings.csv and data/net-worth-history.json) by that burn. State the runway in months, both at full spend and at the essentials-only floor.
3. **Target check.** Compare against the target buffer in goals.md (months of expenses). A two-income household with stable jobs needs a different cushion than a single earner.
4. **Close the gap.** If short, set a monthly top-up amount and a date to hit target. If over-funded, name the excess that could move to investing per allocation.

Output: the monthly burn, runway in months, the gap or surplus versus target, and the plan to close it.
