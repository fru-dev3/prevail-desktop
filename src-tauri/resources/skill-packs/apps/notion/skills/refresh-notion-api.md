---
id: refresh-notion-api
runner: api
trigger: on-demand
capability: refresh-notion
auth: [NOTION_TOKEN]
url: https://api.notion.com/v1/search
method: POST
headers:
  - "Authorization: Bearer ${env.NOTION_TOKEN}"
  - "Notion-Version: 2022-06-28"
  - "Content-Type: application/json"
body: '{"page_size": 50, "sort": {"direction": "descending", "timestamp": "last_edited_time"}}'
save: notion-pages-${date}.json
---
# Refresh Notion (API fallback)

Headless fallback for the refresh-notion capability. Access method derives from
`runner: api`; `method: POST` is the HTTP verb (Notion search is a POST). Uses
an internal integration token in NOTION_TOKEN. The integration must be shared
with the pages it should see. Read-only search.
