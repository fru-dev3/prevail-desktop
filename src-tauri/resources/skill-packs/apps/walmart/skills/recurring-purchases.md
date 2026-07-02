---
id: recurring-purchases
runner: llm
trigger: on-demand
outputs:
  - { path: data/walmart-recurring-${date}.json, kind: replace }
---
# Walmart Recurring Purchases
Spot the staples you rebuy so the grocery run plans itself.
1. **Load orders.** Read the latest data/walmart-orders-*.json snapshot.
2. **Group repeats.** Cluster items bought more than once by name and compute the cadence between purchases.
3. **Estimate run rate.** Project annualized cost and the next likely restock date for each recurring item.
4. **Flag savings.** Note where larger pack sizes or pickup over delivery would cut cost, read-only, no ordering.
Output: a recurring-purchases JSON with repeat items, cadence, annual cost, and savings flags.
