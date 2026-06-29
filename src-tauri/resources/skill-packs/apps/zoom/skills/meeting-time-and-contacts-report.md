---
id: meeting-time-and-contacts-report
runner: llm
trigger: on-demand
outputs:
  - { path: data/zoom-time-contacts-${date}.json, kind: replace }
---
# Meeting Time and Contacts Report
See where your meeting hours actually go.
1. **Load.** Read the newest `data/zoom-meetings-*.json` and `data/zoom-participants-*.json` over the period.
2. **Tally time.** Sum meeting hours by day and by week.
3. **Tally people.** Rank recurring participants by time spent together.
4. **Flag.** Call out back-to-back blocks and your heaviest meeting days.
Output: a report of meeting load by day/week plus your most-met-with contacts.
