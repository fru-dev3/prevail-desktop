---
id: design-activity-and-collaboration-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/canva-activity-summary-${date}.json, kind: replace }
---
# Design Activity and Collaboration Summary
Understand how your design work and team usage trend.
1. **Load.** Read the newest `data/canva-designs-*.json` and `data/canva-folders-*.json` over the period.
2. **Count.** Tally designs created and updated by week and by owner.
3. **Surface.** Identify the most-active folders and any shared or collaborative designs.
4. **Trend.** Compare activity against the prior period.
Output: a summary of design activity and collaboration over the period.
