---
id: meeting-notes-digest
runner: llm
trigger: on-demand
outputs:
  - { path: data/granola-digest-${date}.json, kind: replace }
---
# Granola Meeting Notes Digest
The week's meetings, distilled to what mattered.
1. **Load notes.** Read the latest data/granola-notes-*.json snapshot.
2. **Group by period.** Bucket meetings by day and week with attendees and topics.
3. **Distill.** For each meeting write a one-line outcome and the key decisions reached.
4. **Surface threads.** Note recurring topics and people across meetings for the calendar and chief domains.
Output: a digest JSON with per-meeting outcomes, decisions, and recurring threads.
