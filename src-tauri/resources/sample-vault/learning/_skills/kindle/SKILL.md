---
name: kindle
type: app
description: >
  Accesses Kindle reading progress and highlights via Amazon's Manage Content page or Goodreads RSS sync. Used by learning-agent for reading list tracking and book progress reporting in the weekly learning brief. Two sync methods: Goodreads RSS for currently-reading shelf, or Amazon Kindle Content page for library overview. Configure sync method in vault/learning/config.md.
---

# Kindle

**Auth:** Manual export or Goodreads OAuth RSS (no active auth required for RSS)
**URL:** https://www.amazon.com/hz/mycd/digital-console/contentlist/booksAll (library)
**URL:** https://read.amazon.com/kp/notebook (highlights)
**URL:** https://www.goodreads.com/review/list_rss/{USER_ID}?shelf=currently-reading (RSS)
**Configuration:** Set sync method and paths in `vault/learning/config.md`

## What It Provides

Kindle is the most common e-reader for professional and nonfiction reading. This skill provides two pathways for reading progress data — an automated Goodreads RSS sync for users who sync their Kindle reading to Goodreads, and a manual/semi-manual Amazon library export for users who prefer to track directly. Reading highlights from kindle.amazon.com provide the most granular per-book insight, including the specific passages the user marked during reading — these are stored in `vault/learning/00_current/highlights/` for future reference.

## Sync Methods

**Method 1 — Goodreads RSS (recommended if Goodreads is active):**
Reads two RSS feeds from the user's Goodreads account:
- Currently reading shelf: `https://www.goodreads.com/review/list_rss/{USER_ID}?shelf=currently-reading` — provides title, author, and date added to currently-reading shelf. Note: Goodreads RSS does not provide page-level progress — the user must manually update current page in `vault/learning/00_current/current-reading.md`.
- Read shelf: `https://www.goodreads.com/review/list_rss/{USER_ID}?shelf=read&sort=date_read` — provides completed books with date_read for YTD completion count.

**Method 2 — Amazon Content page (fallback):**
Navigates to Amazon's Kindle library page via Playwright to list all Kindle books. Does not provide reading progress (Amazon only shows completion in the app, not on the web). Use this method only for library inventory, not progress tracking.

**Method 3 — Highlights export (supplemental):**
Amazon's Kindle Notebook at read.amazon.com/kp/notebook provides exported highlights and notes from all Kindle books. Export to `vault/learning/00_current/highlights/` for future reference. The export is a text file with each highlight attributed to the book title. This is not used for progress calculation but is valuable for review and key takeaway extraction when logging a book completion.

## Data Available

- Books currently being read (title, author, date started)
- Books completed (title, author, date finished) — via Goodreads read shelf or manual log
- Kindle library inventory (titles and authors only — from Amazon Content page)
- Reading highlights and notes (from Kindle Notebook export)
- Reading progress percentage (only available in the Kindle app itself; not accessible via web API — must be manually logged)

## Configuration

Add to `vault/learning/config.md`:
```yaml
kindle_sync_method: goodreads  # goodreads or manual
goodreads_user_id: "YOUR_USER_ID"  # found in your Goodreads profile URL
goodreads_rss_currently_reading: "https://www.goodreads.com/review/list_rss/YOURID?shelf=currently-reading"
goodreads_rss_read: "https://www.goodreads.com/review/list_rss/YOURID?shelf=read&sort=date_read"
kindle_highlights_export_path: "vault/learning/00_current/highlights/"
```

## Technical Notes

- Goodreads RSS feeds are public if the user's shelves are set to public — no authentication needed
- Kindle app reading progress (percentage complete shown in the app) is NOT accessible via web — must be manually logged in `vault/learning/00_current/current-reading.md`
- Highlights export from read.amazon.com/kp/notebook requires Playwright with Chrome login (headless=False)
- Goodreads has intermittently throttled RSS — add a 2-second delay and retry once if feed returns empty

## Manual Reading Progress Entry

Since app-level reading progress is not accessible programmatically, the vault uses a manual update system:
```yaml
# vault/learning/00_current/current-reading.md
title: "[book title]"
author: "[author name]"
total_pages: X
current_page: X  # update this manually when checking in
start_date: "YYYY-MM-DD"
goodreads_sync: yes/no
last_updated: "YYYY-MM-DD"
```

The learning brief prompts the user to update this file if the last_updated date is more than 7 days ago.

## Used By

- `aireadylife-learning-flow-build-reading-summary` — compile reading progress, YTD count, and annual goal pace
- `aireadylife-learning-op-monthly-sync` — update reading list status and completed book count

## Vault Output

- `~/Documents/aireadylife/vault/learning/00_current/current-reading.md` — current book progress
- `~/Documents/aireadylife/vault/learning/00_current/completed.md` — YTD reading completions (from Goodreads read shelf)
- `~/Documents/aireadylife/vault/learning/00_current/highlights/` — exported Kindle highlights by book
