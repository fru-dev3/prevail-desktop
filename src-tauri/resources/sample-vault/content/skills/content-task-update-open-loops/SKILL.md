---
name: aireadylife-content-task-update-open-loops
type: task
description: >
  Writes all content flags (revenue dips, SEO gaps, publishing misses, channel
  anomalies) to vault/content/open-loops.md and resolves completed items.
---

## What It Does

Maintains `~/Documents/aireadylife/vault/content/open-loops.md` as the live action list for the content domain. This file aggregates flags from every content op — channel underperformance, revenue declines, SEO drops, publishing gaps, and optimization opportunities — into a single prioritized list that drives the weekly and monthly action agenda.

Receives flags from calling ops and writes them as structured entries with priority marker (🔴 / 🟡 / 🟢), flag type, specific finding, recommended action, and date raised. Before appending new items, scans existing entries for resolvable conditions: a revenue decline flag is resolved if the channel's most recent data shows recovery; an SEO gap flag is resolved if a new piece of content targeting that keyword has been published (check vault/content/00_current/ for new entries); a publishing gap flag is resolved if content has since been published on the flagged platform; a flag explicitly marked resolved by the user. Resolved items are moved to `vault/content/open-loops-archive.md` with a resolution date.

Deduplicates before writing: same SEO keyword, same platform gap, same revenue decline channel — if an existing unresolved entry exists for the same item, updates the date rather than adding a duplicate. After processing, sorts the file: 🔴 first (oldest within tier), 🟡 second, 🟢 third. The file is read by the weekly review op to surface the most urgent 3 action items for the week.

Unlike the business and brand open-loops files, content open-loops also tracks opportunity flags (not just problems) — a high-performing topic area that should be doubled down on, a keyword gap that is a major opportunity, a repurposing opportunity from an existing video. These are flagged as 🟢 info and kept in the file until acted on or archived.

## Triggers

Called at the end of every content op: `aireadylife-content-op-channel-review`, `aireadylife-content-op-revenue-review`, `aireadylife-content-op-seo-review`, `aireadylife-content-op-weekly-review`, and `aireadylife-content-task-flag-seo-gap`.

## Steps

1. Receive flag list from calling op
2. Read vault/content/open-loops.md (or create if it does not exist)
3. For each existing entry: check resolution conditions — revenue recovery, content published, gap filled, explicit resolution; move resolved items to archive
4. Write resolved items to vault/content/open-loops-archive.md with resolution date and note
5. For each new flag: check for duplicate (same keyword/platform/channel); if duplicate exists, update date; otherwise append new entry
6. Apply priority standards: revenue decline >30% MoM = 🔴; publishing gap week 2 = 🔴; SEO drop with opportunity score 8+ = 🔴; everything else follows calling op's suggestion
7. Sort file: 🔴 oldest first, then 🟡 oldest first, then 🟢
8. Write updated file
9. Return summary: "{X} 🔴 urgent, {Y} 🟡 watch, {Z} 🟢 info — {N} items resolved this cycle"

## Input

- Flag list from calling op
- `~/Documents/aireadylife/vault/content/open-loops.md` — current file
- `~/Documents/aireadylife/vault/content/00_current/` — for publishing resolution check
- `~/Documents/aireadylife/vault/content/00_current/` — for revenue recovery resolution check

## Output Format

`~/Documents/aireadylife/vault/content/open-loops.md`:
```
# Content Open Loops
Last updated: {YYYY-MM-DD}
Open: {X} 🔴 | {Y} 🟡 | {Z} 🟢

---

🔴 REVENUE — Gumroad declined 33% MoM | [Product A]
From $540 → $360 (-33%) | Conversion rate dropped 2.8% → 1.9%
Action: Review product page copy and traffic source quality
Source: content-op-revenue-review | Raised: 2026-03-01

🟡 SEO DROP — "keyword" | /blog/post-3 | Pos 4 → 9 (-5 positions)
Traffic impact: ~-320 clicks/mo | Opportunity score: 7/10
Action: Refresh content with 2026 data + update publish date
Source: content-op-seo-review | Raised: 2026-03-01

🟢 OPPORTUNITY — AI Tools pillar outperforming (3.8% vs 2.4% avg)
Action: Publish 2 more AI Tools posts this month to capitalize
Source: content-op-channel-review | Raised: 2026-03-01
```

## Configuration

Optional in `~/Documents/aireadylife/vault/content/config.md`:
- `open_loops_archive_after_days` — days before a 🟢 item auto-archives (default: 60)

## Error Handling

- If vault/content/open-loops.md does not exist: create with standard header.
- If open-loops-archive.md does not exist: create when first item is archived.
- If no flags received and no items to resolve: write a "no new items" update with the current date.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/content/open-loops.md`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`
- Writes to: `~/Documents/aireadylife/vault/content/open-loops.md`, `~/Documents/aireadylife/vault/content/open-loops-archive.md`
