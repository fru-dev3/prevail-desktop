---
id: sync-activities
runner: llm
trigger: refresh
outputs:
  - { path: data/strava-activities-${date}.json, kind: replace }
---
# Sync activities from Strava

Keep the streaks and routes honest by bringing every run and ride you log into the vault.

1. **Pull activities.** Fetch recent activities with type, date, distance, moving time, elevation gain, and average pace or speed.
2. **Capture effort.** For each, keep average and max heart rate, average power if present, and suffer/relative-effort score where available.
3. **Capture segments and PRs.** Pull segment efforts and any personal records or achievements attached to recent activities.
4. **Write the file.** Save as one normalized JSON document, read-only — never post, edit, kudos, or delete an activity.

Output: data/strava-activities-${date}.json with your recent runs and rides, effort metrics, and segment PRs.
