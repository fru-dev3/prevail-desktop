---
id: trip-spend-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/airbnb-trip-spend-${date}.md, kind: markdown }
---
# Trip spend summary

See what your stays really cost once cleaning and service fees are counted in.

1. **Total the stays.** From the latest data/airbnb-reservations-*.json, sum total paid over the last 12 months in a single currency.
2. **Show the true nightly cost.** For each trip, compute the effective nightly rate including cleaning and service fees, not just the headline price.
3. **Find the drift.** Rank trips by total and by fee load, and flag stays where fees pushed the real cost well above the nightly rate.
4. **Look ahead.** Add the committed cost of upcoming booked stays so the next stretch of travel spend is visible now.

Output: a stay spend summary with 12-month total, effective per-night cost, fee outliers, and committed upcoming cost.
