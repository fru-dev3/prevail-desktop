# Plaid — Alex Rivera (Demo)

> **SYNTHETIC DATA — Demo only.** Plaid is the banking aggregation layer for
> Alex's wealth, tax, and business cockpits.

**Used by domains:** wealth, tax, business
**Last refresh:** 2026-04-12 06:14 UTC | **Link status:** healthy
**Items linked:** 4 (Bank of America, Fidelity, Mercury, American Express)

## Current Coverage

| Institution | Type | Item ID | Last refresh | Health |
|------------|------|---------|--------------|--------|
| Bank of America | checking + savings | item_BoA_4811 | 06:14 UTC | ✓ healthy |
| Fidelity | brokerage + Roth IRA | item_FID_3920 | 06:14 UTC | ✓ healthy |
| Mercury (LLC) | business checking | item_MER_7733 | 06:14 UTC | ✓ healthy |
| Amex Platinum | credit card | item_AMX_2014 | 06:14 UTC | ✓ healthy |

## Data Available Right Now

- 24 months of transactions across all 4 items
- Real-time balances on every account
- Investment holdings + cost basis on Fidelity Roth IRA
- Recurring transaction detection on BoA + Amex (subscriptions, salary)

## When to Use This App

- Cross-reference vault/wealth/state.md when month-end balances feel stale
- Tax-time category export (filter by date range, push to vault/tax/)
- Reconcile QuickBooks with bank truth for the Mercury LLC account
- Spot-check recurring charges before the quarterly subscription review

## Open Items

- [ ] Plaid access token for Fidelity expires 2026-07-01 — rotate before
- [ ] Add Wells Fargo checking (opened March 2026, not yet linked)
- [ ] Decide: keep Mercury under Plaid or move to direct API
