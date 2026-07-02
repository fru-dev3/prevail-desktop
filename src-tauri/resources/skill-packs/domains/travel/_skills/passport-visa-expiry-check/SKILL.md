---
id: passport-visa-expiry-check
runner: llm
trigger: on-demand
description: Safety check, confirm every traveler's passport and visa clears the trip's entry rules in time.
source: seed
---

# Passport & visa expiry check

Run the moment a trip is on the calendar, document problems take weeks to fix, not days.

1. **List the travelers and the trip.** Everyone going, and the destination and return date from data/trips.csv. A family trip is only as ready as its least-ready passport.
2. **Check each passport.** Expiry date against the six-months-past-return rule many countries enforce. Flag anyone short, and count back the renewal lead time so there's room to act.
3. **Check entry requirements.** Visa, ETA, or entry form needed for each traveler's nationality, plus blank-page and any health-document rules. Note the lead time for each.
4. **Surface the deadlines.** Turn anything that needs action into a dated task well ahead of departure.

Output: a per-traveler status line (clear or action-needed with the deadline) and the renewals to start now.
