---
id: trip-spend-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/bookingdotcom-trip-spend-${date}.md, kind: markdown }
---
# Trip spend summary

See what lodging actually costs across your trips, not just one booking at a time.

1. **Total the stays.** From the latest data/bookingdotcom-bookings-*.json, sum lodging spend over the last 12 months, converting to a single currency.
2. **Break it down.** Show cost per trip and average nightly rate, and rank trips by total spend.
3. **Find the drift.** Compare nightly rates across cities and seasons, and flag where you paid notably above your own average.
4. **Look ahead.** Add the committed cost of upcoming booked stays so the next stretch of travel spend is visible now.

Output: a lodging spend summary with 12-month total, per-trip and per-night figures, and committed upcoming cost.
