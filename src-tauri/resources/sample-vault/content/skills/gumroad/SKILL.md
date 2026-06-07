---
name: gumroad
type: app
description: >
  Queries product sales and revenue data from Gumroad via their API. Used by
  content-agent for digital product revenue review and discount code tracking.
  Configure API token in vault/content/config.md.
---

# Gumroad

**Auth:** Bearer token (`GUMROAD_API_KEY`)
**URL:** https://app.gumroad.com
**API:** https://api.gumroad.com/v2
**Configuration:** Set your API token in `vault/content/config.md`

## Data Available

- Product list (name, price, sales count)
- Sales history (date, amount, buyer, product)
- Revenue by product (gross and net after fees)
- Discount codes and redemption counts
- Refunds and chargebacks
- Subscriber list for memberships

## Configuration

Add to `vault/content/config.md`:
```
gumroad_api_key: YOUR_GUMROAD_ACCESS_TOKEN
```

## Key Endpoints

```
GET https://api.gumroad.com/v2/products
GET https://api.gumroad.com/v2/sales?after=YYYY-MM-DD
Authorization: Bearer $GUMROAD_API_KEY
```

## Used By

- `aireadylife-content-revenue-review` — pull product sales and revenue by product per period

## Vault Output

`vault/content/revenue/`
