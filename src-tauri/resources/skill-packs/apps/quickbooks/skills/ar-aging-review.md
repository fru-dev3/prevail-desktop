---
id: ar-aging-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/quickbooks-ar-aging-review-${date}.json, kind: replace }
---
# AR Aging Review
Who owes you, how late, and what to chase first, so income on paper becomes cash in the account.
1. **Load.** Read the latest `data/quickbooks-ar-aging-*.json` and `data/quickbooks-invoices-*.json`.
2. **Bucket.** Total receivables by aging bucket (Current, 1–30, 31–60, 61–90, 90+) and overall.
3. **Rank.** List the largest overdue balances by customer with invoice numbers, due dates, and days late.
4. **Prioritize.** Recommend a collection order (biggest + oldest first) and flag any balances at risk of becoming bad debt. Read-only, do not send reminders or change invoices.
Output: an AR aging review with bucket totals, top overdue customers, and a suggested collection order.
