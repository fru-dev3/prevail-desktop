---
id: weekly-health-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/apple-weekly-health-${date}.json, kind: replace }
---
# Apple Health Weekly Summary
A plain read on the week your body just had.
1. **Load metrics.** Read the latest data/apple-health-metrics-*.json snapshot.
2. **Summarize the week.** Compute weekly totals and daily averages for steps, active energy, and exercise minutes.
3. **Compare.** Contrast this week against the prior week and your recent baseline.
4. **Highlight.** Call out the strongest and weakest days and any streaks worth noting.
Output: a weekly-health JSON with activity totals, averages, and week-over-week comparison feeding the health domain.
