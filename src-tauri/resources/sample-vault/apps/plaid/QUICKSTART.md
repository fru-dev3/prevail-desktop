# Plaid — Quickstart

Plaid is the bank/brokerage aggregator. Use it whenever you need to confirm
the canonical truth from an institution instead of trusting the last manual
state.md update.

## Common openers

- *"What's the actual balance across every Plaid-linked account right now?"*
  — pulls /accounts/balance/get for all 4 items and renders a summary table
- *"What changed in wealth this week per Plaid?"* — deltas since the last
  refresh, by institution and account
- *"Tag April's BoA transactions for tax"* — buckets transactions into
  business/personal categories the way Schedule C / Schedule E expect
- *"Audit Plaid recurring detection"* — surfaces the recurring list, flags
  duplicates and stale entries
