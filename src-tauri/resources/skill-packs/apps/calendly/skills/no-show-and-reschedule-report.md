---
id: no-show-and-reschedule-report
runner: llm
trigger: on-demand
outputs:
  - { path: data/calendly-noshow-report-${date}.json, kind: replace }
---
# No-show and Reschedule Report
Spot flaky bookings and protect your time.
1. **Load.** Read the newest `data/calendly-events-*.json` and `data/calendly-cancellations-*.json`.
2. **Tally.** Count canceled, rescheduled, and no-show events over the period.
3. **Break out.** Group the rates by event type and by invitee.
4. **Flag.** Surface repeat cancelers and the event types most prone to falling through.
Output: a report of cancellation, reschedule, and no-show rates by type and invitee.
