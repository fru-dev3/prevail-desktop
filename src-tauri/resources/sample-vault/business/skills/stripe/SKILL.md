---
name: stripe
type: app
description: >
  Queries Stripe for payment, payout, and revenue data via the Stripe API. Used
  by business-agent for revenue review and P&L input. Set API key in
  vault/business/config.md.
---

# Stripe

**Auth:** API key (`STRIPE_API_KEY`)
**URL:** https://dashboard.stripe.com
**API:** https://api.stripe.com/v1
**Configuration:** Set your API key in `vault/business/config.md`

## Data Available

- Payments received (amount, date, customer, status)
- Payouts to bank (settled vs pending)
- Refunds and disputes
- Monthly gross revenue by product or price
- Net revenue after fees
- Subscription MRR and churn (if using Stripe Billing)
- Discount code redemptions

## Configuration

Add to `vault/business/config.md`:
```
stripe_api_key: sk_live_YOUR_STRIPE_KEY
```

## Key Endpoints

```
GET https://api.stripe.com/v1/charges?limit=100&created[gte]={epoch}
GET https://api.stripe.com/v1/payouts?limit=50
GET https://api.stripe.com/v1/balance_transactions
Authorization: Bearer $STRIPE_API_KEY
```

## Used By

- `aireadylife-business-pl-review` — pull gross and net revenue for P&L input
- `aireadylife-business-revenue-review` — summarize revenue by product and period

## Vault Output

`vault/business/revenue/`
