---
name: aireadylife-intel-task-update-open-loops
type: task
description: >
  Writes all intel flags (breaking priority stories, source gaps, follow-up items) to
  vault/intel/open-loops.md and resolves completed items.
---

## What It Does

Maintains `~/Documents/aireadylife/vault/intel/open-loops.md` as the live action list for the intel domain. Unlike the business and brand open-loops files which track problems and compliance items, the intel open-loops file is primarily a reading and action queue — a list of stories that warrant a deeper read, responses to share, routing actions to take, and source management tasks that have been identified but not yet completed.

Receives flags from calling ops — new priority story alerts, source gap flags from the weekly source scan, follow-up items from topic deep dives, and thread management tasks (threads that should be closed or need a status update). Appends new items with a priority marker (🔴 for stories needing immediate action or today's read, 🟡 for items to address within the week, 🟢 for informational items with no deadline).

Before appending new items, checks for resolution conditions on existing entries: a priority story flag is resolved when the user has read and acted on it (noted by the user, or confirmed by a response posted, a decision made, or a routing completed); a source gap flag is resolved when a new source covering that topic has been added via log-source; a thread management item is resolved when the thread file has been updated or closed. Resolved items are moved to vault/intel/open-loops-archive.md with resolution date and resolution note.

Deduplicates: same story (same headline or same source+date), same source gap (same topic with no coverage), same thread management task — checked against existing unresolved entries. For priority story duplicates, update the "last surfaced" date rather than creating a new entry. After processing, sorts: 🔴 first (newest at top — intel flags are time-sensitive, the most recent breaking story should be most visible), then 🟡, then 🟢.

Note the sort difference from other plugins: intel open-loops sorts 🔴 items newest-first (breaking news is most relevant when fresh), while business and brand open-loops sort 🔴 items oldest-first (unresolved compliance issues get more urgent with age).

## Triggers

Called by `aireadylife-intel-op-daily-briefing`, `aireadylife-intel-op-review-brief`, `aireadylife-intel-op-source-scan`, `aireadylife-intel-op-topic-deep-dive`, and `aireadylife-intel-task-flag-priority-story`.

## Steps

1. Receive flag list from calling op
2. Read vault/intel/open-loops.md (or create if it does not exist)
3. For each existing entry: check resolution status — story read and acted on, source added, thread closed, explicit "resolved" user marker; move resolved items to archive
4. Write resolved items to vault/intel/open-loops-archive.md with resolution date
5. For each new flag: check for duplicate (same story, same source gap topic, same thread task); if duplicate, update date; otherwise append
6. Apply priority standards: priority story flagged by daily-briefing op with Criterion A (Tier 1 + priority topic) = 🔴; source gap for a priority topic with zero Tier 1 coverage = 🔴; all other source gap flags = 🟡; routine follow-ups = 🟢
7. Sort: 🔴 newest-first (most recent breaking news most visible), then 🟡 and 🟢 oldest-first (pending source tasks get more stale with age)
8. Write cleaned, updated, sorted file
9. Return summary: "{X} 🔴 (today's priority reads/actions), {Y} 🟡, {Z} 🟢 open items"

## Input

- Flag list from calling op
- `~/Documents/aireadylife/vault/intel/open-loops.md` — current file for dedup and resolution check
- `~/Documents/aireadylife/vault/intel/00_current/source-list.md` — to verify if a source gap has been addressed
- `~/Documents/aireadylife/vault/intel/00_current/` — to verify if a thread management item has been completed

## Output Format

`~/Documents/aireadylife/vault/intel/open-loops.md`:
```
# Intel Open Loops
Last updated: {YYYY-MM-DD HH:MM}
Open: {X} 🔴 | {Y} 🟡 | {Z} 🟢

---

🔴 PRIORITY STORY — Reuters | Tier 1 | 2026-04-13 06:42
Headline: "Fed Announces Emergency Rate Cut of 50bps"
Summary: Federal Reserve cut the federal funds rate by 50 basis points in an emergency session, first such action since 2020, citing financial stability concerns.
Why it matters: Affects variable-rate debt and savings rate yields immediately.
Action: Read full article + route to Wealth Agent — check mortgage/savings impact
Source URL: https://reuters.com/...
Raised: 2026-04-13 | Source: intel-op-daily-briefing

🟡 SOURCE GAP — No Tier 1 coverage for topic: Crypto
Action: Add CoinDesk (Tier 2) or Bloomberg Crypto section (Tier 1) — run source scan to validate
Source: intel-op-source-scan | Raised: 2026-04-07

🟢 THREAD MANAGEMENT — "AI Regulation" thread — last update 8 days ago
Action: Check if thread is still active or should be archived
Source: intel-op-review-brief | Raised: 2026-04-10
```

## Configuration

Optional in `~/Documents/aireadylife/vault/intel/config.md`:
- `open_loops_archive_after_days_priority` — days before a 🔴 that has not been read auto-downgrades to 🟡 (default: 3; breaking news loses urgency quickly)
- `open_loops_archive_after_days_info` — days before a 🟢 auto-archives (default: 14)

## Error Handling

- If vault/intel/open-loops.md does not exist: create with standard header before writing.
- If open-loops-archive.md does not exist: create when first item is archived.
- If no flags are received: scan for resolvable items only; update the "last updated" timestamp.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/intel/open-loops.md`, `~/Documents/aireadylife/vault/intel/00_current/`, `~/Documents/aireadylife/vault/intel/00_current/`
- Writes to: `~/Documents/aireadylife/vault/intel/open-loops.md`, `~/Documents/aireadylife/vault/intel/open-loops-archive.md`
