---
id: segment-prs
runner: llm
trigger: on-demand
outputs:
  - { path: data/strava-segment-prs-${date}.md, kind: markdown }
---
# Segment PRs

Surface the segments where you're getting faster and the ones worth chasing.

1. **Pull the PRs.** From the latest data/strava-activities-*.json, list recent personal records and segment achievements with date and the effort behind them.
2. **Find the trend.** For repeated segments, show whether your times are improving, flat, or slipping.
3. **Spot the near-misses.** Surface segments where a recent effort came close to a PR, the realistic next targets.
4. **Pick the chase list.** Name two or three segments worth a focused effort soon, with the time to beat on each.

Output: a segment-PR report with recent records, the trend on repeats, near-misses, and a short chase list with targets.
