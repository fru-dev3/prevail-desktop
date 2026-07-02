---
id: sync-health
runner: llm
trigger: refresh
outputs:
  - { path: data/garmin-health-${date}.json, kind: replace }
---
# Sync health from Garmin Connect

Bring your runs, sleep, and recovery into the vault so consistency stays honest and your body's signals get heard.

1. **Pull activities.** Fetch recent workouts with type, date, distance, duration, average heart rate, and training load or effort.
2. **Pull sleep.** Capture nightly sleep duration, stages, and sleep score where available.
3. **Pull recovery signals.** Capture resting heart rate, HRV, Body Battery, stress, and any training-readiness or status metric.
4. **Write the file.** Save as one normalized JSON document, read-only, never change device settings, workouts, or profile data.

Output: data/garmin-health-${date}.json with recent activities, sleep, and recovery signals.
