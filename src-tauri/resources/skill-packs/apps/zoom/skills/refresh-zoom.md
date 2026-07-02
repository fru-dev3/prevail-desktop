---
id: refresh-zoom
runner: llm
trigger: refresh
outputs:
  - { path: data/zoom-meetings-${date}.json, kind: replace }
  - { path: data/zoom-participants-${date}.json, kind: replace }
  - { path: data/zoom-recordings-${date}.json, kind: replace }
---
# Refresh Zoom
Keep the calls, the recordings, and who you sat across from so nothing said out loud gets lost. Strictly read-only, never schedule, update, or delete a meeting.
1. **Meetings.** List upcoming and past meetings within a window, capturing topic, start time, duration, and host.
2. **People.** Pull registrants and participants per meeting.
3. **Recordings.** Fetch recording metadata and transcripts where available.
4. **Save.** Write each dataset to its `data/zoom-*-${date}.json` file.
Output: a dated snapshot of meetings, participants, and recordings/transcripts.
