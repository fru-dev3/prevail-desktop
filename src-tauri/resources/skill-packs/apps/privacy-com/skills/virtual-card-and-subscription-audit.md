---
id: virtual-card-and-subscription-audit
runner: llm
trigger: on-demand
outputs:
  - { path: data/privacy-subscription-audit-${date}.json, kind: replace }
---
# Virtual Card and Subscription Audit
Every merchant-locked card maps to a subscription, audit which are still worth paying for.
1. **Load.** Read `data/privacy-cards-*.json` and `data/privacy-transactions-*.json`.
2. **Map.** For each merchant-locked card, identify the merchant and its recurring charge cadence and amount.
3. **Status.** Tag each as active (recent charge), dormant (no charge in 60+ days), or zombie (open card, charging but unused).
4. **Recommend.** List subscriptions to review or cancel and total monthly/annual recurring spend across all cards. Read-only, flag only, do not pause or close cards.
Output: a subscription audit listing each card-to-merchant mapping, status, and total recurring spend.
