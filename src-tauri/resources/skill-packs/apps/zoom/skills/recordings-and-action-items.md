---
id: recordings-and-action-items
runner: llm
trigger: on-demand
outputs:
  - { path: data/zoom-action-items-${date}.json, kind: replace }
---
# Recordings and Action Items
Turn what was said into what to do.
1. **Load.** Read the newest `data/zoom-recordings-*.json` and any transcripts it references.
2. **Summarize.** Write a tight summary of each recorded meeting.
3. **Extract.** Pull decisions and action items, attributing each to an owner.
4. **Yours.** Flag the items that are yours to do.
Output: per-recording summaries with decisions and an owned action-item list.
