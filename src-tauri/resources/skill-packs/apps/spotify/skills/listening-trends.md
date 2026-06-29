---
id: listening-trends
runner: llm
trigger: on-demand
outputs:
  - { path: data/spotify-listening-trends-${date}.json, kind: replace }
---
# Spotify Listening Trends
What you play maps the rhythm of your days.
1. **Load plays.** Read the latest data/spotify-recently-played-*.json snapshot.
2. **Find rhythms.** Bucket plays by hour of day and day of week to surface your listening patterns.
3. **Track variety.** Measure unique tracks vs. repeats and how much of your listening is new versus familiar.
4. **Note shifts.** Compare against earlier snapshots to flag rising and fading tracks.
Output: a listening-trends JSON with time-of-day patterns, variety metrics, and notable shifts.
