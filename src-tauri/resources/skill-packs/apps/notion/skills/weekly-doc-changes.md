---
id: weekly-doc-changes
runner: llm
trigger: on-demand
outputs:
  - { path: data/notion-weekly-changes-${date}.json, kind: replace }
---
# Weekly Doc Changes
See what actually moved across your workspace this week.
1. **Load.** Read the newest `data/notion-pages-*.json`.
2. **Filter.** Keep pages with `last_edited_time` in the past 7 days.
3. **Group.** Organize edits by workspace area / parent and summarize what changed.
4. **Highlight.** Separate brand-new pages from edits to existing ones.
Output: a weekly change-log of created and edited pages grouped by workspace area.
