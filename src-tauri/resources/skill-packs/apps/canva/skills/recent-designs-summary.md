---
id: recent-designs-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/canva-recent-designs-${date}.json, kind: replace }
---
# Recent Designs Summary
See what you've been making lately.
1. **Load.** Read the newest `data/canva-designs-*.json` and `data/canva-folders-*.json`.
2. **Filter.** Keep designs updated in the past N days.
3. **Group.** Organize them by type and folder.
4. **Status.** Separate active projects from dormant ones.
Output: a summary of recent designs grouped by type and folder.
