---
id: payout-and-dispute-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/stripe-payout-dispute-${date}.json, kind: replace }
---
# Payout and Dispute Review
Reconcile what landed in the bank and watch the chargebacks eating into it.
1. **Load.** Read `data/stripe-payouts-*.json` and `data/stripe-disputes-*.json`.
2. **Payouts.** Total payouts that hit the bank for the period and list pending/in-transit ones with arrival dates.
3. **Fees.** Estimate Stripe fees from the gap between gross volume and net payout where balance-transaction data is present.
4. **Disputes.** List open disputes by `reason` and `status`, total amount at risk, and flag those nearing their evidence-due deadline.
Output: a reconciliation of payouts received, fees taken, and open disputes with deadlines.
