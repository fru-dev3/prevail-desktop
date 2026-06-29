---
id: inventory-low-stock
runner: llm
trigger: on-demand
outputs:
  - { path: data/shopify-low-stock-${date}.json, kind: replace }
---
# Inventory Low-Stock Watch
Catch stockouts before they cost a sale.
1. **Load.** Read the newest `data/shopify-inventory-*.json`, `data/shopify-products-*.json`, and `data/shopify-orders-*.json` for sell-through velocity.
2. **Cover.** Compute days-of-cover per variant from on-hand quantity divided by recent daily sell-through.
3. **Flag.** Mark variants below a reorder threshold or projected to stock out within N days.
4. **Group.** Organize the alerts by location.
Output: a low-stock alert list with at-risk variants, current quantity, and estimated days to stockout.
