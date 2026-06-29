---
id: routine-trips-map
runner: llm
trigger: on-demand
outputs:
  - { path: data/uber-routine-trips-${date}.md, kind: markdown }
---
# Routine trips map

Find the trips you take again and again — the quiet rhythm of your week.

1. **Cluster the routes.** From the latest data/uber-rides-*.json, group rides by pickup-to-dropoff pair and count how often each recurs.
2. **Read the schedule.** For each recurring route, note the usual days and times, and what it likely is — commute, gym, airport, night out.
3. **Cost the routine.** Total what each recurring route costs per month so the standing trips are visible, not just one-offs.
4. **Suggest the fix.** Where a route is frequent and predictable, note whether a pass, scheduled rides, or another mode would serve it better.

Output: a map of your recurring routes with timing, monthly cost each, and where a routine could be handled better.
