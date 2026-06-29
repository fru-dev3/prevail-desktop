---
id: spend-limit-and-merchant-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/privacy-spend-limit-review-${date}.json, kind: replace }
---
# Spend Limit and Merchant Review
Are your card limits actually protecting you, or has spend drifted past them?
1. **Load.** Read `data/privacy-cards-*.json` and `data/privacy-transactions-*.json`.
2. **Per card.** Compare each card's spend limit and duration against its actual charges in the period.
3. **Flag mismatches.** Surface cards near or repeatedly hitting their limit, and unlocked cards with no limit that carry meaningful spend.
4. **Merchant check.** Note any merchant charging a card that doesn't match its expected lock, or unfamiliar merchants.
Output: a review of limit-vs-actual spend per card with flagged mismatches and unexpected merchants.
