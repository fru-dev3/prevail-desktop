---
id: refresh-notion
runner: llm
# Demoted to on-demand: this is now a pack fallback for the refresh-notion
# capability. The browser favorite (and api variant) lead; this still runs if
# they are blocked or fail, writing the same data/ files the analysis skills read.
trigger: on-demand
outputs:
  - { path: data/notion-pages-${date}.json, kind: replace }
  - { path: data/notion-tasks-${date}.json, kind: replace }
  - { path: data/notion-content-${date}.json, kind: replace }
---
# Refresh Notion
Bring your docs, tasks, and half-built ideas into the vault so your plans and knowledge stay within reach. Strictly read-only, search and retrieve only, never create, update, or archive a page.
1. **Index.** Search the pages and databases you have access to, capturing title, `last_edited_time`, and parent.
2. **Tasks.** From task-style databases, pull status, due date, assignee, and priority for each item.
3. **Content.** Retrieve recent page/block content for notes and docs edited lately.
4. **Save.** Write each dataset to its `data/notion-*-${date}.json` file.
Output: a dated snapshot of Notion pages, tasks, and recent content.
