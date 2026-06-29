---
id: cravings-and-cuisine-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/ubereats-cravings-${date}.md, kind: markdown }
---
# Cravings and cuisine review

Read what you actually crave from the orders you actually place.

1. **Rank the restaurants.** From the latest data/ubereats-orders-*.json, count orders per restaurant and surface your top regulars.
2. **Read the cravings.** Group orders by cuisine and dish type to show what you reach for most, and what you only order on certain nights.
3. **Find the repeat dishes.** Surface the exact items ordered again and again — the comfort go-tos.
4. **Note the variety.** Say plainly whether you're rotating or stuck in a rut, and name a couple of past favorites that have gone quiet.

Output: a cravings review with top restaurants, the cuisine mix, your repeat dishes, and a read on variety.
