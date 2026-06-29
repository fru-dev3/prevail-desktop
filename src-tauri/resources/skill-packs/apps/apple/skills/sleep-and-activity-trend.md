---
id: sleep-and-activity-trend
runner: llm
trigger: on-demand
outputs:
  - { path: data/apple-sleep-activity-trend-${date}.json, kind: replace }
---
# Apple Health Sleep & Activity Trend
How rest and movement move together over time.
1. **Load metrics.** Read the latest data/apple-health-metrics-*.json snapshot.
2. **Build series.** Assemble nightly sleep duration alongside next-day steps and exercise minutes.
3. **Correlate.** Look for the relationship between sleep and activity, and trends over the last several weeks.
4. **Flag.** Note short-sleep nights, low-movement stretches, and any consistent pairing.
Output: a sleep-and-activity-trend JSON with paired series, correlation notes, and flagged stretches.
