---
id: fetch-meeting-notes
runner: llm
trigger: refresh
outputs:
  - { path: data/granola-notes-${date}.json, kind: replace }
---
# Pull Granola Meeting Notes
Bring your meeting notes into the vault so the calendar and chief always have the record.
1. **Authenticate.** Use the existing Granola credentials with read-only access to your notes.
2. **Fetch notes.** Pull each meeting note with title, date, attendees, and the full enhanced/summary text.
3. **Capture structure.** Preserve any sections, decisions, and action-item lists Granola already separated out.
4. **Normalize.** Write all notes to granola-notes-${date}.json; read only, never edit or create notes.
Output: a read-only JSON snapshot of Granola meeting notes with metadata and structure.
