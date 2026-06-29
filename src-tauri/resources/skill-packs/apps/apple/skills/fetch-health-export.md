---
id: fetch-health-export
runner: llm
trigger: refresh
outputs:
  - { path: data/apple-health-metrics-${date}.json, kind: replace }
---
# Pull Apple Health Export
The body's daily signals, pulled into the vault so health is something your AI understands.
1. **Locate the export.** Find the latest Apple Health export (export.xml or the Health app's exported archive) in the configured source path.
2. **Parse records.** Read step count, active energy, exercise minutes, heart rate, resting heart rate, HRV, and sleep analysis records.
3. **Roll up daily.** Aggregate each metric into per-day values with min/avg/max where relevant.
4. **Normalize.** Write the daily metric series to apple-health-metrics-${date}.json; read the export only, never write back to Health.
Output: a read-only JSON of daily Apple Health metrics (activity, heart, sleep).
