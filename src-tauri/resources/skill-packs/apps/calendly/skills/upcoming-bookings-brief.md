---
id: upcoming-bookings-brief
runner: llm
trigger: on-demand
outputs:
  - { path: data/calendly-upcoming-brief-${date}.json, kind: replace }
---
# Upcoming Bookings Brief
Know who's landing on your calendar before they do.
1. **Load.** Read the newest `data/calendly-events-*.json` and `data/calendly-invitees-*.json`.
2. **Filter.** Keep upcoming bookings only.
3. **Detail.** For each, surface the invitee, event type, time, and their intake answers.
4. **Flag.** Call out back-to-backs and unusually short gaps between bookings.
Output: a brief of upcoming bookings with invitee context.
