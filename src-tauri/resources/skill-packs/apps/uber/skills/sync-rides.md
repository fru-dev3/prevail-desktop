---
id: sync-rides
runner: llm
trigger: refresh
outputs:
  - { path: data/uber-rides-${date}.json, kind: replace }
---
# Sync rides from Uber

Pull your rides and routine trips into the vault so the rhythm of your comings and goings is part of the story.

1. **Pull trip history.** Fetch completed rides with date and time, pickup and dropoff areas, distance, and duration.
2. **Capture the cost.** For each ride, keep fare, surge, tip, product type (ride tier), and currency.
3. **Keep it coarse.** Store pickup and dropoff at neighborhood or label level rather than exact coordinates, to keep the vault private.
4. **Write the file.** Save as one normalized JSON document, read-only — never request, schedule, or cancel a ride.

Output: data/uber-rides-${date}.json with your recent ride history, fares, and trip patterns.
