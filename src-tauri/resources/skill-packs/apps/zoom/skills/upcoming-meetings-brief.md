---
id: upcoming-meetings-brief
runner: llm
trigger: on-demand
outputs:
  - { path: data/zoom-upcoming-brief-${date}.json, kind: replace }
---
# Upcoming Meetings Brief
Walk into every call already knowing who and why.
1. **Load.** Read the newest `data/zoom-meetings-*.json` and `data/zoom-participants-*.json`.
2. **Filter.** Keep meetings scheduled in the next N days.
3. **Detail.** For each, list time, duration, host, and participants.
4. **Context.** Pull prior history from past meetings and recordings with the same people.
Output: a brief of upcoming meetings with attendees and context notes.
