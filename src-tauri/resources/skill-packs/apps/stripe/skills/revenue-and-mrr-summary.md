---
id: revenue-and-mrr-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/stripe-revenue-mrr-${date}.json, kind: replace }
---
# Revenue and MRR Summary
The shape of recurring revenue, what's coming in, and whether it's growing.
1. **Load.** Read `data/stripe-charges-*.json`, `data/stripe-invoices-*.json`, and `data/stripe-subscriptions-*.json`.
2. **Gross revenue.** Sum succeeded charges for the period (net of refunds) by currency.
3. **MRR.** From active subscriptions, normalize each plan to monthly (annual ÷ 12) and total MRR; derive ARR.
4. **Movement.** Break MRR into new, expansion, and churned where status/period data allows; count active vs canceled subs.
Output: a revenue summary with gross revenue, MRR/ARR, and the net new/churn breakdown.
