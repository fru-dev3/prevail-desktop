---
id: monthly-ride-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/uber-monthly-summary-${date}.md, kind: markdown }
---
# Monthly ride summary

Close out the month with a clear read on how much you moved and what it cost.

1. **Count the month.** From the latest data/uber-rides-*.json, tally rides, total distance, total time in the car, and total spend for the month.
2. **Show the shape.** Break the month into weeks and into ride tiers so peaks and the splurge trips stand out.
3. **Compare to last.** Set this month against the prior one (more rides, higher fares, or steadier) and name the driver of any swing.
4. **Note one thing.** Call out a single takeaway worth carrying into next month, whether a cost to watch or a habit that's working.

Output: a monthly ride summary with totals, the weekly and tier shape, the month-over-month change, and one takeaway.
