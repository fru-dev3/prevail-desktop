---
id: refresh-notion-browser
runner: browser-agent
trigger: refresh
favorite: true
method: browser
capability: refresh-notion
session: profile
start_url: https://www.notion.so/
domain_allow: [www.notion.so, notion.so]
success_url_contains: notion.so
goal: Open Notion in the logged-in session and read recently edited pages and task databases (title, last edited time, parent, and for task rows their status, due date, and priority). Read-only: never create, edit, move, or archive a page.
outputs:
  - { path: data/notion-pages-${date}.json, kind: replace }
---
# Refresh Notion (browser, favorite)

Read recently edited pages and tasks from Notion using the logged-in browser
session, no integration token required. Favorite. Falls through to the Notion
API method when the browser is blocked.

Read-only. Capture page title, last edited time, parent, and task status/due/
priority, then write a normalized JSON document. Never create, edit, move, or
archive anything.
