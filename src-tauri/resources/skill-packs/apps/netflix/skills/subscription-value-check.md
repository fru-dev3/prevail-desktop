---
id: subscription-value-check
runner: llm
trigger: on-demand
outputs:
  - { path: data/netflix-value-check-${date}.json, kind: replace }
---
# Netflix Subscription Value Check
Is the plan earning its keep against how much you actually watch?
1. **Load data.** Read the latest netflix-billing-*.json and netflix-watch-history-*.json snapshots.
2. **Compute usage.** Tally titles and viewing hours per billing period.
3. **Derive cost per watch.** Divide the monthly charge by titles watched and by hours viewed.
4. **Assess fit.** Flag months of low usage and note whether a different plan tier would obviously fit better, read-only, no changes.
Output: a value-check JSON with cost-per-watch, usage by period, and a fit assessment.
