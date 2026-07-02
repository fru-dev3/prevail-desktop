---
id: busy-night-pattern
runner: llm
trigger: on-demand
outputs:
  - { path: data/ubereats-busy-nights-${date}.md, kind: markdown }
---
# Busy night pattern

Find when the orders cluster, the busy nights the habit quietly tracks.

1. **Map the timing.** From the latest data/ubereats-orders-*.json, bucket orders by day of week and time of day.
2. **Find the peaks.** Surface your heaviest ordering nights and hours, and how consistent the pattern is week to week.
3. **Read the trigger.** Note what the busy nights tend to share (late weeknights, weekends, the end of a long stretch) and what it suggests about those days.
4. **Plan ahead.** Suggest one or two nights worth prepping for in advance so the default isn't always delivery.

Output: a timing pattern of your orders with the peak nights, the likely trigger, and a couple of nights to plan around.
