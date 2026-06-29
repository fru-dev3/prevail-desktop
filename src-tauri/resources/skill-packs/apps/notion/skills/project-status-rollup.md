---
id: project-status-rollup
runner: llm
trigger: on-demand
outputs:
  - { path: data/notion-project-rollup-${date}.json, kind: replace }
---
# Project Status Rollup
Roll task databases up into a per-project health read.
1. **Load.** Read the newest `data/notion-tasks-*.json` and `data/notion-pages-*.json`.
2. **Group.** Bucket tasks by project / database; compute percent done, open count, and overdue count.
3. **Health.** Flag projects with many overdue items or no recent activity as at-risk.
4. **Rank.** Order projects by how much attention they need.
Output: a per-project rollup with completion, open work, and stall flags.
