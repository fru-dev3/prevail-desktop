---
id: seasonal-trail-picks
runner: llm
trigger: on-demand
outputs:
  - { path: data/alltrails-seasonal-picks-${date}.md, kind: markdown }
---
# Seasonal trail picks

Match the trails you've saved to the time of year so the right walk is ready when you are.

1. **Read saved and done.** From the latest data/alltrails-trails-*.json, pull both wishlist trails and recently completed ones with location, length, and elevation.
2. **Read the season.** Consider the current month: daylight, likely conditions, and what's typically in good shape to hike now near your usual areas.
3. **Shortlist for now.** Pick five wishlist trails that fit the season, balancing a couple of easy wins with one stretch goal.
4. **Note what to avoid.** Flag saved trails better left for another season and why, so they don't get picked on a bad-weather whim.

Output: five seasonal trail picks for the coming weeks, plus the ones to hold for later.
