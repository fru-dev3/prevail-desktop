---
id: premium-comparison
runner: llm
trigger: on-demand
description: Compare quotes on an apples-to-apples basis so the cheapest number isn't quietly the thinnest coverage.
source: seed
---

# Premium comparison

Run when shopping a policy or weighing a renewal against outside quotes.

1. **Lock the baseline.** Pull the current policy from data/policies.csv: coverage limits, deductible, exclusions, and premium. Every quote gets measured against this exact spec.
2. **Normalize the quotes.** Restate each competing quote at the same limits and deductible. A lower premium at lower coverage isn't cheaper, it's less protection.
3. **Read the fine print.** Compare exclusions, sub-limits, and claim reputation, not just price. The cheapest carrier on a bad claim day is the most expensive choice.
4. **Price the switch.** Net the annual saving against any new-policy fees, bundling discounts lost, or coverage given up.

Output: a side-by-side table at matched coverage, with a clear stay / switch recommendation and the dollar delta.
