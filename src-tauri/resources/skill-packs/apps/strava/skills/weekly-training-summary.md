---
id: weekly-training-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/strava-weekly-summary-${date}.md, kind: markdown }
---
# Weekly training summary

Close the week with an honest read on the training you actually did.

1. **Tally the week.** From the latest data/strava-activities-*.json, sum sessions, distance, moving time, and elevation for the last 7 days by sport.
2. **Read the effort.** Show the easy/hard split using heart rate or relative effort, and flag whether the week leaned too hard or too easy.
3. **Compare to recent.** Set the week against your 4-week rolling average and name the swing in volume or intensity.
4. **Call the next step.** Suggest whether next week should hold, build, or back off, based on the trend and any sign of fatigue.

Output: a weekly training summary with volume by sport, the easy/hard split, the trend versus your average, and a call for next week.
