---
id: refresh-shopify
runner: llm
trigger: refresh
outputs:
  - { path: data/shopify-orders-${date}.json, kind: replace }
  - { path: data/shopify-products-${date}.json, kind: replace }
  - { path: data/shopify-inventory-${date}.json, kind: replace }
---
# Refresh Shopify
Pull the latest store state into the vault. Strictly read-only, only fetch and list, never `create`, `update`, set inventory, or change product status.
1. **Shop & orders.** Call `get-shop-info`, then `list-orders` over a recent window (e.g. last 60 days) capturing status, financial/fulfillment status, totals, line items, and customer.
2. **Catalog.** Use `search_products` / `list` and `get-product` for titles, variants, prices, and published status.
3. **Inventory.** Call `get-inventory-levels` across all locations for on-hand quantity per variant.
4. **Save.** Write each dataset to its `data/shopify-*-${date}.json` file without mutating anything in Shopify.
Output: a dated snapshot of orders, products, and inventory levels.
