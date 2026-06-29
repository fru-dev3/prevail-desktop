---
id: failed-payments-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/stripe-failed-payments-${date}.json, kind: replace }
---
# Failed Payments Review
Catch the revenue leaking out through declines before it churns.
1. **Load.** Read `data/stripe-charges-*.json` and `data/stripe-invoices-*.json`.
2. **Isolate failures.** Filter charges where `status` is `failed` and invoices where `status` is `uncollectible` or `open` past due.
3. **Group.** Bucket by decline `failure_code` / `outcome.reason` (e.g. `card_declined`, `insufficient_funds`, `expired_card`) with counts and dollar totals.
4. **Recover.** Flag high-value failures and recurring customers worth a dunning retry. Do not retry or charge — surface only.
Output: a failed-payments review with total at-risk amount, decline reasons, and accounts to follow up.
