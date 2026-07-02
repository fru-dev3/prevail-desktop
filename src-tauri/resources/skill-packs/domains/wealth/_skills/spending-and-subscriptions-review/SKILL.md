---
id: spending-and-subscriptions-review
runner: llm
trigger: on-demand
description: Find every recurring charge, flag the ones not earning their keep, and surface spending creep.
source: seed
---
# Spending and subscriptions review

Run quarterly, recurring charges drift in quietly.

1. **List the recurring.** From data/transactions.csv, pull every charge that repeats monthly or annually: streaming, software, memberships, insurance, storage. Total the monthly burn.
2. **Earning its keep?** For each, mark keep / cut / negotiate. The test is honest use in the last 60 days, not the intention behind the signup.
3. **Spending creep.** Compare this quarter's discretionary categories against the prior one. Name any category that crept up more than 15% and why.
4. **The annual trap.** Flag any annual renewal landing in the next 90 days so a cut happens before the charge, not after.

Output: the recurring list with keep/cut/negotiate calls, the monthly total, and the renewals to act on before they hit.
