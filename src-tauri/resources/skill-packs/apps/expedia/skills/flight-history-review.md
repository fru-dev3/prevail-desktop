---
id: flight-history-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/expedia-flight-history-${date}.md, kind: markdown }
---
# Flight history review

Look back at where you've flown to see the shape of your year in the air.

1. **Map the routes.** From the latest data/expedia-itineraries-*.json, list past flights by route and count trips, segments, and rough miles.
2. **Find the patterns.** Surface your most-flown airlines and airports, typical cabin, and how far ahead you tend to book.
3. **Name the standouts.** Call out the longest trip, the busiest travel month, and any route you fly often enough to warrant a status or fare-watch.
4. **Compare the years.** Set this year's flying against last (more trips, farther, or steadier) and note the trend.

Output: a flight-history review with top routes and carriers, booking patterns, standouts, and the year-over-year trend.
