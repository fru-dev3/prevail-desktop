---
id: stay-history-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/bookingdotcom-stay-history-${date}.md, kind: markdown }
---
# Stay history review

Look back at where you've slept to learn how you actually travel.

1. **Map the places.** From the latest data/bookingdotcom-bookings-*.json, list past stays by city and country and count nights in each.
2. **Find your defaults.** Surface repeat properties or cities, typical trip length, and the room types and price tiers you tend to choose.
3. **Name the favorites.** Call out the stays worth returning to and any you'd skip, based on price, location, and repeat visits.
4. **Compare the years.** Set this year's travel against last year — more trips, farther afield, longer stays, or steadier.

Output: a stay-history review with top destinations, your booking defaults, return-worthy places, and the year-over-year shift.
