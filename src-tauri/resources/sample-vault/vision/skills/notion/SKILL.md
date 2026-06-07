---
name: notion
type: app
description: >
  Reads and writes Notion pages and databases via the Notion API. Used by vision-agent
  for syncing quarterly OKR plans and monthly scorecards to Notion for review and sharing.
  Configure integration token and page IDs in vault/vision/config.md. Optional — all vision
  data lives locally first; Notion is a sync and visibility layer.
---

# Notion — Vision Plugin

**Auth:** Notion integration token (`NOTION_API_KEY`)
**URL:** https://www.notion.so
**API:** https://api.notion.com/v1
**Configuration:** Set token and page IDs in `vault/vision/config.md`

## Data Available

- Read existing quarterly planning pages and OKR databases
- Write monthly scorecard to a Notion page (creates or updates)
- Write quarterly OKR document as a new Notion page with rich formatting
- Query a Notion goals database with status filters (active, completed, at-risk)
- Append reflection blocks to the annual vision document page
- Create new database rows for individual key results with status fields

## Configuration

Add to `vault/vision/config.md`:
```
notion_api_key: secret_YOUR_NOTION_TOKEN
notion_vision_page_id: YOUR_MAIN_VISION_PAGE_ID
notion_goals_database_id: YOUR_GOALS_DATABASE_ID
notion_scorecard_page_id: YOUR_SCORECARD_PAGE_ID
```

To get page/database IDs: open the page in Notion → Share → Copy link → the ID is the 32-character string in the URL.

## Key API

```
POST https://api.notion.com/v1/pages
PATCH https://api.notion.com/v1/pages/{page_id}
GET  https://api.notion.com/v1/databases/{id}/query
POST https://api.notion.com/v1/blocks/{block_id}/children
Authorization: Bearer $NOTION_API_KEY
Notion-Version: 2022-06-28
```

## Used By

- `aireadylife-vision-op-monthly-scorecard` — sync completed scorecard to Notion scorecard page
- `aireadylife-vision-op-quarterly-planning` — create new quarterly OKR page in Notion; update goals database rows with new KR targets
- `aireadylife-vision-flow-draft-quarterly-plan` — read existing goal database entries for prior KR context

## Notes

- The Notion integration must be added to the relevant workspace pages before the API token can access them: go to the page → Add Connections → select your integration
- Goals database schema should include: Name, Domain, Quarter, Status (Active/Achieved/Missed/Dropped), Progress %, Due Date

## Vault Output

- Local: `vault/vision/00_current/`, `vault/vision/00_current/` — always written first
- Notion: sync after local write; Notion is not the source of truth, vault is
