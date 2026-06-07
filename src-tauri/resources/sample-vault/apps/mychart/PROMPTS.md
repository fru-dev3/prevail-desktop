# MyChart — Prompt Reference

## Routine

1. **Lab Pull:** "Pull the most recent lab panel from MyChart. Compare each
   value to its reference range. Surface flags in red. Cross-reference
   against vault/health/state.md trend lines."

2. **Refill Window:** "List all active prescriptions and refill-due dates.
   Flag anything due in the next 30 days. Queue an open loop in
   vault/health/open-loops.md for each."

## Appointments

3. **Appointment Schedule:** "Show all upcoming appointments. Cross-check
   each against vault/calendar/00_current/ for conflicts."

4. **Schedule Cardiology:** "Find the earliest cardiology consult slot
   after Apr 15. Avoid days where vault/calendar shows a tax deadline or
   Stripe interview. Propose 3 options for me to pick from."

## Notes

5. **Last Visit Summary:** "Read the most recent visit note. Extract:
   diagnosis, recommendations, follow-ups required. Write to
   vault/health/00_current/visit-<date>.md if not already there."
