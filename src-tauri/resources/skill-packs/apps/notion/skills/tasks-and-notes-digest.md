---
id: tasks-and-notes-digest
runner: llm
trigger: on-demand
outputs:
  - { path: data/notion-digest-${date}.json, kind: replace }
---
# Tasks and Notes Digest
A single read on what's open and what you've been thinking about.
1. **Load.** Read the newest `data/notion-tasks-*.json` and `data/notion-content-*.json`.
2. **Sort tasks.** Group by status and due date; surface overdue and due-this-week items.
3. **Fresh ideas.** Pull standout recent notes and half-formed ideas worth revisiting.
4. **Frame.** Lead with what needs action, then what to think about.
Output: a digest of open tasks ordered by urgency plus a short list of fresh notes.
