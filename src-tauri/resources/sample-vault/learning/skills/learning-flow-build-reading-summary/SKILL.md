---
name: aireadylife-learning-flow-build-reading-summary
type: flow
trigger: called-by-op
description: >
  Reads the reading list and completion log to produce a reading progress summary: books completed YTD (count and titles), current book with percentage complete and projected completion date at current pace, books/month pace vs. annual goal pace, projected year-end total, and the next 2-3 books queued. Returns structured reading data to the calling op.
---

## What It Does

Called by `aireadylife-learning-op-progress-review` to produce the reading progress layer of the monthly review. Reading is the most frequently tracked learning activity for most people, and the annual book goal is the most commonly set personal learning metric. This flow ensures the vault's reading data translates into a clear status report rather than requiring the user to manually calculate where they stand against their annual goal.

**Reading list data sources:** Primary source is `vault/learning/00_current/` — the reading log and completion records maintained in the vault. If Goodreads is configured and an RSS feed URL is set in `vault/learning/config.md`, the flow reads the "currently-reading" shelf RSS for current book progress and "read" shelf for completion dates. If Kindle highlights are exported to `vault/learning/00_current/highlights/`, these are noted as supplementary data for completeness tracking but are not required for the summary.

**YTD completion count:** Reads all entries in `vault/learning/00_current/completed.md` where `date_completed` falls within the current calendar year. Counts total books. Lists titles for reference. This is the factual baseline for the rest of the calculations.

**Reading pace calculation:** Divides YTD completed books by months elapsed in the year so far. Months elapsed = (today − January 1) ÷ 30.44. Books per month = YTD_completed ÷ months_elapsed. This is the current actual pace, not a goal.

**Annual goal projection:** Annual goal is stored in `vault/learning/config.md` as `annual_book_goal`. Compares current pace to the pace required to hit the goal (goal ÷ 12 books/month). Projected year-end total = current_pace × 12. If projected total < goal: calculates additional books/month needed = (goal − projected_total) ÷ remaining_months_in_year. If on track or ahead: notes the favorable pace.

**Current book progress:** Reads `vault/learning/00_current/current-reading.md` for the book currently in progress. Extracts title, author, current page, total pages, and start date. Calculates completion percentage = current_page ÷ total_pages. Estimates daily reading pace from recent page logs (if tracked) or from the current_page and days_since_start. Projects completion date = today + (remaining_pages ÷ daily_pace_pages).

**Reading queue:** Reads the next 2-3 books from the reading list in `vault/learning/00_current/reading-list.md` — books with status "queued" or "next" — for visibility into what is coming after the current book.

## Steps

1. Read completion log from `vault/learning/00_current/completed.md` — filter to current calendar year. Count and list.
2. Calculate months elapsed since January 1 (to one decimal place).
3. Calculate books per month pace = YTD_completed ÷ months_elapsed.
4. Read annual_book_goal from `vault/learning/config.md`.
5. Calculate required pace = annual_book_goal ÷ 12.
6. Determine pace status: on-track if current pace ≥ required pace; behind if current pace < required pace.
7. Project year-end total = current_pace × 12.
8. If behind: calculate additional books/month needed for the rest of the year.
9. Read current book from `vault/learning/00_current/current-reading.md` or Goodreads RSS.
10. Calculate current book % complete and project completion date at current reading pace.
11. Read next 2-3 queued books from `vault/learning/00_current/reading-list.md`.
12. Return structured reading summary to calling op.

## Input

- `~/Documents/aireadylife/vault/learning/00_current/completed.md` — YTD completion log
- `~/Documents/aireadylife/vault/learning/00_current/current-reading.md` — current book progress
- `~/Documents/aireadylife/vault/learning/00_current/reading-list.md` — reading queue
- `~/Documents/aireadylife/vault/learning/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/learning/config.md` — annual_book_goal, goodreads_rss_url

## Output Format

Structured reading data returned to calling op:

```
Reading Progress Summary:

Books completed YTD: X
  [Title 1] — completed [date]
  [Title 2] — completed [date]
  [...]

Current reading pace: X books/month
Annual goal: X books (requires X books/month)
Pace status: On track / Behind — need X additional books/month for remainder of year
Projected year-end total: X books

Current book:
  [Title] by [Author]
  Progress: X% (page X of X)
  Reading pace: ~X pages/day (based on X days of reading)
  Projected completion: [date]

Next in queue:
  1. [Title] by [Author]
  2. [Title] by [Author]
  3. [Title] by [Author]
```

## Configuration

`vault/learning/00_current/completed.md` format:
```yaml
- title: "[name]"
  author: "[name]"
  date_completed: "YYYY-MM-DD"
  pages: X
  rating: 1-5
  key_takeaway: "[optional]"
```

`vault/learning/00_current/current-reading.md` format:
```yaml
title: "[name]"
author: "[name]"
total_pages: X
current_page: X
start_date: "YYYY-MM-DD"
```

## Error Handling

- **No books completed YTD:** Report 0 YTD. Calculate how many books/month are needed to hit the annual goal from today. Note that at zero books in the first months of the year, the required monthly pace for the rest of the year is higher than the full-year rate.
- **Annual book goal not set:** Report reading pace without goal comparison. Suggest setting `annual_book_goal` in config.
- **Current book progress not updated:** Note that current book data may be stale. Suggest updating `current-reading.md` with latest page number.
- **Goodreads RSS unavailable:** Fall back to vault data only; note that Goodreads sync is unavailable.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/learning/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/learning/00_current/`, `~/Documents/aireadylife/vault/learning/config.md`
- Writes to: None (returns data to calling op)
