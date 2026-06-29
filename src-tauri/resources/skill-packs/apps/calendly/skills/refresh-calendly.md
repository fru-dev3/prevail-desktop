---
id: refresh-calendly
runner: llm
trigger: refresh
outputs:
  - { path: data/calendly-events-${date}.json, kind: replace }
  - { path: data/calendly-invitees-${date}.json, kind: replace }
  - { path: data/calendly-cancellations-${date}.json, kind: replace }
---
# Refresh Calendly
Pull who's reserved time and why so your week never gets ambushed. Strictly read-only — never create, cancel, or reschedule a booking.
1. **Events.** List scheduled events within a window, capturing start time, event type, and status.
2. **Invitees.** Pull invitee details — name, email, and answers to intake questions.
3. **Changes.** Collect cancellations and reschedules with their reasons.
4. **Save.** Write each dataset to its `data/calendly-*-${date}.json` file.
Output: a dated snapshot of Calendly events, invitees, and cancellations.
