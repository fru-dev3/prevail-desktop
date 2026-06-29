---
id: recurring-charge-anomaly-check
runner: llm
trigger: on-demand
outputs:
  - { path: data/privacy-charge-anomalies-${date}.json, kind: replace }
---
# Recurring Charge Anomaly Check
Catch the silent price hikes and duplicate charges in your recurring spend.
1. **Load.** Read `data/privacy-transactions-*.json`.
2. **Build baselines.** For each recurring merchant, establish the normal charge amount and cadence from history.
3. **Detect.** Flag price increases versus the prior cycle, unexpected duplicate charges, and declined-then-retried authorizations.
4. **Rank.** Order anomalies by dollar impact and note any free-trial conversions that just started billing.
Output: a list of recurring-charge anomalies — price hikes, duplicates, and new trial conversions — ranked by impact.
