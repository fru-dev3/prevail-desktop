---
id: action-items-sweep
runner: llm
trigger: on-demand
outputs:
  - { path: data/granola-action-items-${date}.json, kind: replace }
---
# Granola Action Items Sweep
Pull every commitment out of the notes so nothing falls through.
1. **Load notes.** Read the latest data/granola-notes-*.json snapshot.
2. **Extract actions.** Find every action item, todo, or follow-up across all meetings.
3. **Attribute.** For each item capture the owner, due date if stated, and the source meeting.
4. **Prioritize.** Group by owner and flag items that are unassigned or look overdue.
Output: an action-items JSON with owner, due date, source meeting, and priority flags for the chief domain.
