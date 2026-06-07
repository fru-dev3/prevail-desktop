---
name: aireadylife-brand-task-update-open-loops
type: task
description: >
  Writes all brand flags (profile inconsistencies, content gaps, unanswered mentions, publishing
  cadence misses) to vault/brand/open-loops.md. Resolves completed items.
---

## What It Does

Maintains `~/Documents/aireadylife/vault/brand/open-loops.md` as the live, always-current action list for the brand domain. This file is what the Chief of Staff reads to surface brand alerts in Ben's morning brief, and what the user reads when they want to know exactly what brand actions are outstanding.

Receives flags from the calling op — which may include profile fields out of sync with master profile, platforms that missed their publishing cadence target, brand mentions that need a response, analytics anomalies worth investigating (engagement rate drop, follower decline), or any other brand-domain action items surfaced during reviews. Appends new flags with a priority marker (🔴 urgent / 🟡 watch / 🟢 info), the source op or flow that generated the flag, a clear action description, and the date the flag was raised.

Before writing new items, scans existing entries for those that are marked as resolved. Resolution conditions: a profile inconsistency flag is resolved if the platform snapshot file has been updated to match master (check updated date vs flag raised date), a mention response flag is resolved if the mention record in vault/brand/00_current/ shows responded: yes, a cadence miss flag is resolved if posts were published on the flagged platform in the current period, and any flag explicitly marked "resolved" by the user. Resolved items are moved to vault/brand/open-loops-archive.md — not deleted — for historical reference.

Deduplicates: before appending a new flag, checks whether the same issue (same platform + same field for profile flags, same mention author for mention flags) already has an unresolved entry. If yes, updates the date rather than creating a duplicate. After writing, the file is sorted: 🔴 first (oldest unresolved at top of that tier), then 🟡, then 🟢.

## Triggers

Called at the end of every brand op: `aireadylife-brand-op-profile-audit`, `aireadylife-brand-op-monthly-synthesis`, `aireadylife-brand-op-content-review`, and `aireadylife-brand-task-flag-profile-inconsistency`.

## Steps

1. Receive flag list from calling op: each flag has priority, category, description, action, source op, date
2. Read current vault/brand/open-loops.md (or create if it does not exist)
3. For each existing entry: check resolution status (platform snapshot updated, mention responded, cadence catch-up confirmed, or explicit "resolved" marker); move resolved to archive
4. Write resolved items to vault/brand/open-loops-archive.md with resolution date and note
5. For each new flag: check for duplicate (same category + same specific item); if duplicate exists, update the "last surfaced" date on the existing entry; otherwise append as new
6. Apply priority standards: unanswered mention from high-priority author >24 hours = escalate to 🔴; LinkedIn profile inconsistency = 🔴; secondary platform wording variation = 🟢 regardless of calling op's suggestion
7. Sort final file: 🔴 first (oldest first within tier), then 🟡, then 🟢
8. Write cleaned, updated, sorted file
9. Return summary: "{X} 🔴 urgent, {Y} 🟡 watch, {Z} 🟢 info items in brand open-loops.md"

## Input

- Flag list from calling op
- `~/Documents/aireadylife/vault/brand/open-loops.md` — current file for dedup and resolution check
- `~/Documents/aireadylife/vault/brand/00_current/` — to verify mention response status
- `~/Documents/aireadylife/vault/brand/00_current/` — to verify profile snapshot update dates

## Output Format

`~/Documents/aireadylife/vault/brand/open-loops.md`:
```
# Brand Open Loops
Last updated: {YYYY-MM-DD}
Open: {X} 🔴 | {Y} 🟡 | {Z} 🟢

---

🔴 MENTION RESPONSE — @journalist_handle | LinkedIn
High-priority mention: 45K followers, positive coverage — respond within 24hr window
Action: Reply to LinkedIn mention at {link}; thank for the reference, add value
Source: brand-task-log-mention | Raised: 2026-03-15

🟡 PROFILE INCONSISTENCY — YouTube | Field: Channel Description
Current: "[old description]" | Expected: "[current tagline from master]"
Fix: YouTube Studio → Customization → Basic Info → Description
Source: brand-op-profile-audit | Raised: 2026-03-01

🟢 CADENCE NOTE — Twitter/X: 3 posts this month vs target 20
Not a miss (target is aspirational), but noting for next month planning
Source: brand-op-content-review | Raised: 2026-03-01
```

## Configuration

Optional in `~/Documents/aireadylife/vault/brand/config.md`:
- `open_loops_archive_after_days` — days before a 🟢 item auto-archives (default: 60)

## Error Handling

- If vault/brand/open-loops.md does not exist: create with standard header before writing entries.
- If open-loops-archive.md does not exist: create when first item is archived.
- If no new flags are received: scan only for resolvable items; write the updated file without adding any new entries.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/brand/open-loops.md`, `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/00_current/`
- Writes to: `~/Documents/aireadylife/vault/brand/open-loops.md`, `~/Documents/aireadylife/vault/brand/open-loops-archive.md`
