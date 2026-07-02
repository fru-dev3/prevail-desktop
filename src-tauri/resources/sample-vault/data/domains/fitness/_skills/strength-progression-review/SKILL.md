---
id: strength-progression-review
runner: llm
trigger: on-demand
description: Review the main lifts over recent weeks and set the next progression — heavier, more reps, or hold.
source: seed
---
# Strength progression review

Run monthly, against the strength sessions in data/training-log.csv.

1. **The main lifts.** Pull the working sets for the key movements (squat, bench, OHP, deadlift, row) over the last four to six weeks — load, reps, and RPE.
2. **Progressing or stalling?** For each lift, decide if it is still moving. Two flat or grinding sessions in a row is a stall, not a bad day.
3. **The next step.** For movers, add the smallest meaningful load or rep. For stalls, prescribe the fix — a deload, a rep-range change, or tightening form before adding weight.
4. **Balance check.** Confirm push/pull and lower-body work stay balanced so no movement gets neglected into an imbalance.

Output: a per-lift progress table with the next-session prescription for each.
