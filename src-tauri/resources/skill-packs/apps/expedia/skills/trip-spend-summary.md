---
id: trip-spend-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/expedia-trip-spend-${date}.md, kind: markdown }
---
# Trip spend summary

See where your travel money goes across flights, hotels, and extras.

1. **Total the trips.** From the latest data/expedia-itineraries-*.json, sum spend over the last 12 months in a single currency.
2. **Split by category.** Break each trip into flights, lodging, and extras, then show the category mix across the year.
3. **Rank and flag.** Rank trips by total cost and flag any leg that ran well above your usual for that route or city.
4. **Look ahead.** Add the committed cost of upcoming booked itineraries so the next stretch of travel spend is visible now.

Output: a travel spend summary with 12-month total, the flight/lodging/extras split, cost outliers, and committed upcoming cost.
