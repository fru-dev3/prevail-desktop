---
id: watch-history-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/netflix-watch-summary-${date}.json, kind: replace }
---
# Netflix Watch History Summary
Remembering your taste so downtime feels like yours.
1. **Load activity.** Read the latest data/netflix-watch-history-*.json snapshot.
2. **Summarize volume.** Count titles and episodes watched per week and per month.
3. **Profile taste.** Group by series vs. film and by inferred genre to describe what you gravitate toward.
4. **Spot patterns.** Note binge stretches, half-finished series, and the days you watch most.
Output: a watch-summary JSON with viewing volume, taste profile, and notable patterns.
