---
id: completed-trails-log
runner: llm
trigger: on-demand
outputs:
  - { path: data/alltrails-completed-log-${date}.md, kind: markdown }
---
# Completed trails log

Keep an honest record of the trails you've actually walked, not just the ones you meant to.

1. **Tally the season.** From the latest data/alltrails-trails-*.json, sum completed trails, total distance, and total elevation gain over the last 90 days.
2. **Find the patterns.** Note your usual difficulty, typical length, and where you tend to hike, the rhythm the data reveals.
3. **Mark the standouts.** Surface the longest, the steepest, and any first-time trail or personal milestone worth remembering.
4. **Compare to before.** Set this stretch against the prior 90 days and say plainly whether you're outside more, less, or about the same.

Output: a log of recent completed trails with totals, patterns, standouts, and the trend versus last quarter.
