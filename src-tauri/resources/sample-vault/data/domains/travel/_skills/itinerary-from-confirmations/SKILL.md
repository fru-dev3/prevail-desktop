---
id: itinerary-from-confirmations
runner: llm
trigger: on-demand
description: Pull scattered booking confirmations into one clean day-by-day itinerary for the trip.
source: seed
---

# Itinerary from confirmations

Run once the bookings are made — turn a dozen confirmation emails into a single view.

1. **Gather the confirmations.** Sweep synced booking and confirmation emails plus anything in data/trips/ for this trip: flights, hotels, rental cars, trains, tours, reservations. Pull confirmation numbers, times, addresses, and check-in/out.
2. **Lay it on a timeline.** Order everything chronologically into a day-by-day itinerary, in local time, with each segment's confirmation number and address attached.
3. **Catch the seams.** Flag tight connections, unbooked gaps (a night with no bed, a day with no plan), and anything double-booked. The gaps are where trips go wrong.
4. **Make it travel-ready.** Note which items need offline copies and which times feed the calendar.

Output: the single day-by-day itinerary saved to data/trips/, with gaps and tight connections flagged up top.
