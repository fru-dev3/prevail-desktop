---
name: notion
type: app
description: >
  Reads and writes Notion pages and databases via the Notion API. Used by calendar-agent to
  publish weekly agendas and deadline tracking tables to Notion for cross-device access. Optional
  — all calendar data lives locally in vault/calendar/ first; Notion is a display and sharing layer.
  Configure integration token and page IDs in vault/calendar/config.md.
---

# Notion — Calendar Plugin

**Auth:** Notion integration token (`NOTION_API_KEY`)
**URL:** https://www.notion.so
**API:** https://api.notion.com/v1
**Configuration:** Set token and page IDs in `vault/calendar/config.md`

## What It Does

Provides the calendar-agent with write access to Notion so that completed weekly agendas,
focus time reports, and deadline tables can be published to a Notion page for reading on
any device. Notion is a display layer for the calendar plugin — the vault is the source of truth.
The calendar-agent never reads from Notion as its primary data source.

## Data Available

- Write weekly agenda to a Notion page (with sections for focus blocks, meetings, deadlines)
- Write focus time weekly report to a Notion page (hours achieved, trend, focus block table)
- Sync deadline items to a Notion database (one row per deadline with domain, date, urgency)
- Update an existing agenda page if re-running for the same week
- Query the deadline database for existing entries to avoid duplicate rows

## Configuration

Add to `vault/calendar/config.md`:
```
notion_api_key: secret_YOUR_NOTION_TOKEN
notion_calendar_page_id: YOUR_CALENDAR_PARENT_PAGE_ID
notion_deadlines_database_id: YOUR_DEADLINES_DATABASE_ID
notion_agenda_page_id: YOUR_WEEKLY_AGENDA_PAGE_ID
```

**Integration setup:** Create a Notion integration at notion.so/my-integrations → copy the
integration token to `notion_api_key`. Share the calendar parent page (and any databases) with the
integration: open the page → ... menu → Add Connections → select your integration. Without
this step, API calls will return 404 even with a valid token.

## Key API

```
POST https://api.notion.com/v1/pages
PATCH https://api.notion.com/v1/pages/{page_id}
GET  https://api.notion.com/v1/databases/{id}/query
POST https://api.notion.com/v1/blocks/{block_id}/children
Authorization: Bearer $NOTION_API_KEY
Notion-Version: 2022-06-28
Content-Type: application/json
```

## Weekly Agenda Page Structure

When writing a weekly agenda to Notion, use the following block structure:
1. **Heading 1**: `Week of {Monday date, Month Day}`
2. **Callout block**: Focus time target — "{X} focus hours scheduled this week (target: 8h)"
3. **Heading 2**: `Focus Blocks`
4. **Table**: Day | Time | Duration | Topic
5. **Heading 2**: `Deadlines This Week`
6. **Table**: Deadline | Domain | Due Date | Urgency | Hard/Soft
7. **Heading 2**: `Calendar Overview`
8. **Bulleted list**: One line per day with meeting count and key events
9. **Heading 2**: `Open Items`
10. **To-do blocks**: Action items from open-loops.md

## Deadlines Database Schema

The Notion deadlines database should have these properties:
- **Name** (title) — deadline label
- **Domain** (select) — health, wealth, career, taxes, explore, social, vision, calendar
- **Due Date** (date) — the deadline date
- **Urgency** (select) — Critical / Important / Monitor
- **Hard Deadline** (checkbox) — true for IRS dates, enrollment windows, legal deadlines
- **Status** (select) — Active / Completed / Overdue
- **Source** (text) — which vault file flagged this deadline

## Deduplication

Before adding a new deadline row to the Notion database, query for existing entries with the
same name and due date:
```
POST https://api.notion.com/v1/databases/{id}/query
Body: {"filter": {"and": [
  {"property": "Name", "title": {"equals": "{deadline_name}"}},
  {"property": "Due Date", "date": {"equals": "YYYY-MM-DD"}}
]}}
```
If a match is found, PATCH the existing row to update urgency or status rather than creating
a duplicate entry.

## Used By

- `calendar-op-weekly-agenda` — publish completed weekly agenda to Notion agenda page after local write
- `calendar-op-deadline-alert` — sync flagged deadlines to Notion deadlines database
- `calendar-op-focus-time-review` — write focus time weekly report to Notion calendar page

## Notes

- Local vault write always happens first. If Notion write fails, log the error to
  `~/Documents/aireadylife/vault/calendar/02_briefs/notion-sync-errors.md` and continue.
- Notion is optional. If `notion_calendar_page_id` is not configured, skip Notion sync silently.
- Notion rate limits: 3 requests/second per integration. Batch block creation for agendas with
  many events — max 100 blocks per append request.

## Vault Output

- Local (primary): `~/Documents/aireadylife/vault/calendar/02_briefs/` — agendas written first
- Notion (secondary): agenda page and deadlines database — written after local write succeeds
