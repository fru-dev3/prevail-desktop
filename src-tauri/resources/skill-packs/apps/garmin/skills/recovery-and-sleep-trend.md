---
id: recovery-and-sleep-trend
runner: llm
trigger: on-demand
outputs:
  - { path: data/garmin-recovery-trend-${date}.md, kind: markdown }
---
# Recovery and sleep trend

Hear what your body is signaling before it has to shout.

1. **Read the nights.** From the latest data/garmin-health-*.json, pull sleep duration, stages, and score over the last 2–4 weeks.
2. **Read recovery.** Track resting heart rate, HRV, Body Battery, and stress across the same window and note the direction each is moving.
3. **Connect the dots.** Line recovery signals up against training load and short sleep, and flag any building strain.
4. **Make the call.** Say plainly whether to push, hold, or rest in the next few days, and name one habit nudging sleep or recovery the wrong way.

Output: a recovery and sleep trend with sleep and signal direction, the load connection, and a clear push/hold/rest call.
