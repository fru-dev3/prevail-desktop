---
id: resting-hr-and-hrv-trend
runner: llm
trigger: on-demand
outputs:
  - { path: data/apple-rhr-hrv-trend-${date}.json, kind: replace }
---
# Apple Health Resting HR & HRV Trend
The quiet markers of how recovered you are.
1. **Load metrics.** Read the latest data/apple-health-metrics-*.json snapshot.
2. **Build series.** Assemble daily resting heart rate and HRV over the available history.
3. **Find the baseline.** Compute rolling averages and your normal range for each.
4. **Flag deviations.** Highlight days where resting HR is elevated or HRV is suppressed beyond the baseline.
Output: a resting-HR-and-HRV trend JSON with daily series, baselines, and flagged deviations feeding the health domain.
