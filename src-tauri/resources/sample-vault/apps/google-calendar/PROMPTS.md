# Google Calendar — Prompt Reference

## Daily

1. **Today's Agenda:** "Pull today's events across all calendars. Output a
   single-line summary plus a flagged section for any back-to-back stretch
   longer than 90 minutes."

## Weekly

2. **Weekly Load Audit:** "Sum total meeting minutes this week. Compare to
   the rolling 4-week average. Flag if meeting load > 40% of working hours.
   Suggest which recurring meetings to drop."

3. **Deep Work Slot Finder:** "Find every block of 90+ minutes with no
   meetings this week. Rank by morning-vs-afternoon (morning preferred for
   deep work)."

## Conflict / Booking

4. **Conflict Check:** "Given <invite details>, check for overlap with any
   existing event, plus the no-meetings rules in vault/calendar/state.md.
   Return accept/decline recommendation."

5. **Schedule Cross-Domain:** "I have a tax deadline on <date>. Find the
   best 2-hour block in the 5 days before to actually do the work. Block
   the calendar."
