---
id: annual-preventive-care-schedule
runner: llm
trigger: on-demand
description: Map the year's preventive care — physicals, screenings, dental, vision — and book what's overdue.
source: seed
---
# Annual preventive care schedule

Run at the start of the year, or any time something feels overdue.

1. **What's due by age.** List the recommended preventive items for the year — annual physical, dental cleanings, eye exam, age-appropriate screenings, and vaccinations.
2. **Last done.** From data/appointments.csv and data/lab-results.csv, note when each was last completed and compute the next-due date for each.
3. **Overdue and upcoming.** Flag anything past due in red and anything due in the next 90 days, with the provider to call to book it.
4. **Carry-forwards.** Note any follow-up the doctor asked for (a recheck, a referral) that hasn't been scheduled, so it doesn't quietly fall off.

Output: the year's preventive-care calendar with last-done and next-due dates, and the short list to book now.
