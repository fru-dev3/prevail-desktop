---
id: upcoming-trips-brief
runner: llm
trigger: on-demand
outputs:
  - { path: data/bookingdotcom-upcoming-brief-${date}.md, kind: markdown }
---
# Upcoming trips brief

Pull the next stays together so travel plans, dates, and confirmations are clear before you go.

1. **Read what's booked.** From the latest data/bookingdotcom-bookings-*.json, pull every stay with a check-in date in the future.
2. **Order by date.** List trips soonest first with property, city, check-in/check-out, nights, and confirmation number.
3. **Flag what's near.** Call out any stay within the next 14 days and note its cancellation deadline so a free cancel isn't missed.
4. **Spot the gaps.** Flag back-to-back trips with no lodging between dates, or a city visit with no booking yet.

Output: a date-ordered brief of upcoming stays with confirmations, near-term flags, and any gaps to fill.
