---
id: recurring-bills-review
runner: llm
trigger: on-demand
description: Audit the household's recurring bills and subscriptions: creep, duplicates, and the cancel/renegotiate list.
source: seed
---

# Recurring bills review

Run quarterly, before the autopay just keeps winning.

1. **List them all.** Pull every recurring charge from data/bills.csv — utilities, insurance, streaming, memberships. The ones you forgot are the ones to find.
2. **Spot the creep.** Flag any that rose since last review, especially the quiet annual renewals (insurance, internet) that climb without notice.
3. **Cut and duplicate.** Name subscriptions unused in 60 days and any overlapping services. Each one is a clean monthly saving.
4. **Renegotiate list.** For the big fixed bills, note the ones worth a retention call or a quote shop this quarter, with the rough target.

Output: the full recurring-bill list, the creep flags, the cancel list, and the renegotiate targets with expected savings.
