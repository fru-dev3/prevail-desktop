---
id: upcoming-trips-brief
runner: llm
trigger: on-demand
outputs:
  - { path: data/airbnb-upcoming-brief-${date}.md, kind: markdown }
---
# Upcoming trips brief

Bring the next stays together so the plan, the dates, and the address are clear before you travel.

1. **Read what's booked.** From the latest data/airbnb-reservations-*.json, pull every stay with a check-in date in the future.
2. **Order by date.** List trips soonest first with listing, location, host, check-in/check-out, nights, and confirmation code.
3. **Flag what's near.** Call out any stay within the next 14 days and note its cancellation deadline and check-in instructions to confirm.
4. **Spot the gaps.** Flag a planned destination with no booking yet, or dates that don't line up with travel into and out of the city.

Output: a date-ordered brief of upcoming Airbnb stays with confirmations, near-term flags, and any gaps to fill.
