---
id: recurring-purchases
runner: llm
trigger: on-demand
outputs:
  - { path: data/amazon-recurring-${date}.json, kind: replace }
---
# Amazon Recurring Purchases
The things you rebuy quietly add up, so make them visible.
1. **Load orders.** Read the latest data/amazon-orders-*.json snapshot.
2. **Group repeats.** Cluster items bought more than once by title/ASIN and compute the cadence between purchases.
3. **Estimate run rate.** For each recurring item, project the annualized cost and next likely reorder date.
4. **Flag savings.** Note items where Subscribe & Save or buying in bulk would obviously cut cost — read-only, no subscribing.
Output: a recurring-purchases JSON listing repeat items, cadence, annual cost, and savings flags.
