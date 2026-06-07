---
name: aireadylife-learning-task-update-open-loops
type: task
description: >
  Maintains vault/learning/open-loops.md as the canonical list of outstanding learning action items. Appends new flags from learning ops and flows (courses falling behind, certification exam prep timeline risks, expiring certifications, learning goal misalignment). Resolves and removes items when the underlying issue is addressed. Called by learning ops and flows.
---

## What It Does

The learning open-loops file is the domain's single source of truth for what needs active attention. All learning ops and flows write their flags here. The weekly brief surfaces the highest-priority items from this file. Without active maintenance — appending new flags and resolving completed ones — the file accumulates stale items that degrade its signal value.

**Flag types managed:**

- `FALLING-BEHIND` — learning item's completion pace is more than 15 points behind time-elapsed (with severity: mild/moderate/severe)
- `CERT-EXAM-RISK` — study pace for a certification will not reach exam readiness by the scheduled exam date
- `CERT-EXPIRING` — an earned certification is expiring within 6 months and requires renewal (CPE credits, re-examination, etc.)
- `GOAL-MISALIGNED` — a quarterly learning goal no longer aligns with top career or vision priorities (flagged by quarterly goal review)
- `GOAL-ABANDONED` — an active learning item shows no progress for 21+ days — decision needed (resume, pause, or drop)
- `PLATFORM-SUBSCRIPTION` — a paid learning platform subscription is renewing within 30 days and has been used less than 5 hours in the past 90 days
- `MILESTONE-MISSED` — a monthly milestone from the quarterly plan was not completed and needs to be rescheduled
- `SKILLS-GAP-NOT-ADDRESSED` — a top career skills gap priority (from Career plugin) is not addressed by any active learning goal

**Resolution logic:** Checks each existing flag against current vault state on every run. Resolution conditions: FALLING-BEHIND resolves when the item's pace returns to within 15 points of schedule (caught up), or when the item is completed, or when the target date is extended (new target date logged); CERT-EXAM-RISK resolves when the exam date passes or when study pace catches up to the required timeline; CERT-EXPIRING resolves when renewal is logged in the completion archive; GOAL-ABANDONED resolves when progress resumes (active unit logged in the past 7 days) or when the item is formally dropped (moved to archive with status "dropped"); PLATFORM-SUBSCRIPTION resolves when the renewal date passes (user chose to renew or cancel). Resolved items are moved to a `[Resolved]` section at the bottom of the file.

**Priority ordering:** Items sorted by urgency within each category. Certification exam risks with exam dates within 30 days are the highest urgency. Severe falling-behind flags (>40 point deficit or <7 days remaining) are next. Moderate and mild pace issues follow. Goal alignment issues, platform subscriptions, and informational items at the bottom.

## Steps

1. Receive new flags from calling op or flow with type, severity, description, and due date.
2. Read current `vault/learning/open-loops.md`.
3. For each existing flag: check resolution conditions against current vault data.
4. Move resolved flags to `[Resolved]` section with resolution date and method.
5. Append new flags in correct section — check for duplicates (update, not duplicate).
6. Re-sort by urgency within each section.
7. Write updated file to `vault/learning/open-loops.md`.
8. Return summary: X new flags added, X resolved, X updated.

## Input

- Flags from calling op or flow
- `~/Documents/aireadylife/vault/learning/open-loops.md` — current state
- `~/Documents/aireadylife/vault/learning/00_current/` — for resolution condition checks

## Output Format

`vault/learning/open-loops.md` structure:

```
# Learning Open Loops — Updated [YYYY-MM-DD]

## Urgent
- [CERT-EXAM-RISK] [Cert Name] — Exam in X days — pace is X hours/day short
- [FALLING-BEHIND] [Course] — Severe — X% deficit — deadline in X days — decide: accelerate / extend / drop

## Attention Needed
- [FALLING-BEHIND] [Course] — Moderate — X% deficit — need X min/day for X days
- [GOAL-ABANDONED] [Course/Book] — No progress in X days — resume or drop?

## Watch
- [FALLING-BEHIND] [Course] — Mild — X% deficit — manageable with +X min/day
- [CERT-EXPIRING] [Cert Name] — Expires [date] — renewal requires [X CPE credits / re-exam]
- [PLATFORM-SUBSCRIPTION] [Platform] — Renews [date] — X hours used in past 90 days

## Info
- [SKILLS-GAP-NOT-ADDRESSED] [Skill] — X% demand in target postings — no active learning goal
- [MILESTONE-MISSED] [Milestone] — reschedule by [date]

## Resolved (last 30 days)
- [flag] — Resolved [date] — [how]
```

## Configuration

No configuration required. File auto-created on first run at `vault/learning/open-loops.md`.

## Error Handling

- **open-loops.md does not exist:** Create with header structure on first write.
- **Flag type not recognized:** Log as MISC with calling op name and full flag content.
- **Resolution condition check requires vault data that is unavailable:** Leave item as open with "verification needed" note.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/learning/open-loops.md`, `~/Documents/aireadylife/vault/learning/00_current/`
- Writes to: `~/Documents/aireadylife/vault/learning/open-loops.md`
