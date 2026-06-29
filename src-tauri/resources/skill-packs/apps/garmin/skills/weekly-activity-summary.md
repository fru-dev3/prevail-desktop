---
id: weekly-activity-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/garmin-weekly-summary-${date}.md, kind: markdown }
---
# Weekly activity summary

Close the week with an honest tally of the work you put in.

1. **Tally the week.** From the latest data/garmin-health-*.json, sum sessions, active minutes, distance, and total training load for the last 7 days by activity.
2. **Read the intensity.** Show the split across heart-rate zones and whether the week leaned too hard or too easy.
3. **Compare to recent.** Set the week against your 4-week average and name the swing in volume or load.
4. **Call the next step.** Suggest whether next week should build, hold, or ease, balancing the trend against current recovery signals.

Output: a weekly activity summary with volume by type, the intensity split, the trend versus your average, and a call for next week.
