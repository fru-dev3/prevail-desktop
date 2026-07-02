---
id: recovery-readiness-check
runner: llm
trigger: on-demand
description: A morning read on whether to train hard, train easy, or rest, from recovery signals, not mood.
source: seed
---
# Recovery readiness check

Run on the morning of any planned hard session.

1. **The signals.** Pull resting HR, sleep hours, and wellness score from health/data/vitals.csv, and note yesterday's load and RPE from data/training-log.csv.
2. **Compare to baseline.** A resting HR several beats above your recent average, or sleep under 7 hours, is the body asking for less, read the trend, not one number.
3. **Green / amber / red.** Green: train as planned. Amber: keep the session but cut volume or intensity. Red: swap for easy movement or rest. Be honest; the plan can absorb one moved day.
4. **Adjust today.** Restate today's session at the chosen level, and note what to watch tomorrow before deciding the next hard day.

Output: the readiness color, the reason in one line, and today's session at the adjusted level.
