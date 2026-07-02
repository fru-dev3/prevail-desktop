---
id: consistency-streak-check
runner: llm
trigger: on-demand
outputs:
  - { path: data/strava-consistency-${date}.md, kind: markdown }
---
# Consistency streak check

Keep training honest by looking at how steadily you actually show up.

1. **Map the calendar.** From the latest data/strava-activities-*.json, mark active days over the last 8 weeks and count sessions per week.
2. **Find the streak.** Show the current and longest active streaks and the longest gap, and whether weeks are trending up or fragmenting.
3. **Read the pattern.** Note which days you reliably train and which you skip, so the weak spots in the routine are clear.
4. **Protect the habit.** Suggest one small change (a fixed day, a default short session) to keep the streak alive through a busy week.

Output: a consistency check with weekly counts, current and longest streaks, your reliable and skipped days, and one habit-protecting move.
