---
id: seasonal-maintenance-sweep
runner: llm
trigger: on-demand
description: The seasonal walkthrough: what to inspect, service, and budget before the season turns.
source: seed
---

# Seasonal maintenance sweep

Run at each season change, against data/maintenance-log.csv.

1. **Overdue.** Anything in the log past its service interval (filters, HVAC
   service, gutters, smoke detector batteries). Schedule them this week.
2. **Season-specific.** The items this season punishes if skipped: pre-winter
   (heating, pipes, weather seal), pre-summer (cooling, irrigation, pests).
3. **Watch list.** Anything aging toward replacement (like the HVAC decision in
   the threads): note expected remaining life and the replacement cost so it
   never arrives as a surprise.
4. **Budget line.** Total the season's expected spend and check it against the
   wealth domain's home reserve.

Output: the schedule, the watch list with timelines, and the budget number.
