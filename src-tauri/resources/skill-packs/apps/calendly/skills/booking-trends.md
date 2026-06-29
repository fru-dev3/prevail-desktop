---
id: booking-trends
runner: llm
trigger: on-demand
outputs:
  - { path: data/calendly-booking-trends-${date}.json, kind: replace }
---
# Booking Trends
Understand the rhythm of who books you.
1. **Load.** Read the newest `data/calendly-events-*.json` over the period.
2. **Aggregate.** Count bookings by event type, day of week, and hour of day.
3. **Trend.** Compare booking volume against the prior period.
4. **Surface.** Note your busiest slots and most-requested event types.
Output: a trends summary of booking volume by type and time.
