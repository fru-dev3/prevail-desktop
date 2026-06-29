---
id: refresh-stripe
runner: llm
trigger: refresh
outputs:
  - { path: data/stripe-charges-${date}.json, kind: replace }
  - { path: data/stripe-subscriptions-${date}.json, kind: replace }
  - { path: data/stripe-invoices-${date}.json, kind: replace }
  - { path: data/stripe-payouts-${date}.json, kind: replace }
  - { path: data/stripe-disputes-${date}.json, kind: replace }
---
# Refresh Stripe
Pull recent payments activity from the Stripe CLI into the vault. Strictly read-only, only `list`/`get`, never `create`, `update`, `refund`, or `pay`.
1. **Auth.** Use the connected Stripe key (`stripe config` / `--api-key`); confirm with `stripe balance retrieve`.
2. **Charges & balance.** Run `stripe charges list --limit 100` and `stripe balance_transactions list --limit 100`.
3. **Recurring.** Run `stripe subscriptions list --limit 100 --status all` and `stripe invoices list --limit 100`.
4. **Payouts & risk.** Run `stripe payouts list --limit 100` and `stripe disputes list --limit 100`.
5. **Save.** Write each JSON response to its `data/stripe-*-${date}.json` file.
Output: a dated snapshot of charges, subscriptions, invoices, payouts, and disputes.
