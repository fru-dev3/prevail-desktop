---
name: aireadylife-learning-task-flag-falling-behind
type: task
description: >
  Writes a behind-pace flag to vault/learning/open-loops.md when a learning item's completion percentage is more than 15 percentage points behind the time-elapsed percentage. Flag includes item title, type, platform, completion percentage, time-elapsed percentage, pace deficit, remaining content, days remaining, required daily pace to recover, and a decision prompt (accelerate / adjust deadline / drop).
---

## What It Does

Called by `aireadylife-learning-flow-build-progress-summary` and `aireadylife-learning-op-progress-review` whenever a learning item's pace is more than 15 percentage points behind schedule. The 15-point threshold is intentional: it is large enough to filter out minor fluctuations (a busy week that slightly delays progress) while catching meaningful pace problems that will result in a missed target if the pattern continues.

**What makes this flag useful:** The flag does not just say "you're behind on Course X." It gives the user everything needed to make a decision: exactly how far behind, exactly how much content remains, exactly how many days are left, and exactly what daily pace is needed to recover. "You need 18 minutes/day for 12 more days to finish this course by your target date" is a decision — you either commit to 18 minutes/day or you adjust the deadline or you drop the course. Vague "you're falling behind" flags produce inaction.

**Severity levels:**
- *Mild* (pace deficit 15-25 points): recoverable with modest daily commitment increase. Flag as "watch" in open loops. Recovery plan shows modest daily addition.
- *Moderate* (pace deficit 25-40 points): requires meaningful daily time commitment to recover. Flag as "attention needed." Recovery plan may require doubling the daily study allocation for a period.
- *Severe* (pace deficit > 40 points, or fewer than 7 days remaining): recovery is likely unrealistic at a sustainable pace. Flag as "decision needed" — should the deadline be extended or the item be dropped? Present the realistic options.

**Decision prompt:** For severe flags, the task does not just flag — it presents three explicit options: (1) Accelerate: if recovery pace is ≤ 2× the normal daily target, this is feasible. State exactly what it requires per day. (2) Adjust deadline: calculate the new target date if the current pace continues unchanged. (3) Drop: if the item is no longer strategically relevant or recovery is unrealistic, dropping is a legitimate choice that frees capacity for higher-priority items. Dropping is different from failing — it is a portfolio management decision.

**Deduplication:** Checks for an existing falling-behind flag for the same item before writing. If found: updates the flag with current pace data rather than creating a duplicate. Updates to flags note the change in deficit (e.g., "deficit increased from 18 to 27 points since last review").

## Steps

1. Receive item data from calling flow: title, type, platform, completion_pct, time_elapsed_pct, remaining_units, days_remaining, required_daily_pace, unit_type.
2. Calculate pace_deficit = time_elapsed_pct − completion_pct.
3. Determine severity: mild (15-25), moderate (25-40), severe (>40 or days_remaining ≤ 7).
4. Assess recovery feasibility: compare required_daily_pace to configured daily_study_target in config.
5. Check `vault/learning/open-loops.md` for existing flag for this item — if found, update.
6. Compose flag entry with all fields, severity, recovery plan, and decision prompt (for moderate/severe).
7. Write (or update) flag in appropriate section of `vault/learning/open-loops.md`.
8. Return confirmation with severity and flag type to calling flow.

## Input

- Item data from calling flow (all fields required)
- `~/Documents/aireadylife/vault/learning/config.md` — daily_study_minutes for recovery feasibility
- `~/Documents/aireadylife/vault/learning/open-loops.md` — for deduplication

## Output Format

Entry in `vault/learning/open-loops.md`:

```
## [FALLING BEHIND] [Item Title] — [Severity: Mild/Moderate/Severe]
[Type: Course/Certification/Book] — [Platform]

Completion: X% | Time elapsed: X% | Deficit: X points
Remaining: X [hours/modules/pages] | Days remaining: X

Recovery plan:
  Need: X [minutes/modules/pages] per day for X more days
  That's X× your normal daily target of X [minutes]

[If moderate/severe — Decision needed:]
  Option 1: Accelerate — X [minutes] per day for X days
  Option 2: Adjust deadline — at current pace, completes [new date]
  Option 3: Drop — not recommended if this is a top skills gap priority; consider if lower priority

Career connection: [from goal record if available — e.g., "closes Docker gap — 45% demand in target postings"]

Status: Open — Flagged [date] / Updated [date]
```

## Configuration

`vault/learning/config.md` provides `daily_study_minutes` for recovery feasibility assessment.
Active item records in `vault/learning/00_current/` provide the career connection data if populated.

## Error Handling

- **Required daily pace is zero or negative:** Item might already be complete — check completion_pct. If not complete, the remaining_units or days_remaining data may be incorrect. Flag as "data error — verify item progress data."
- **Career connection unknown for this item:** Omit career connection line from flag. The flag is still valid without it.
- **Days remaining is negative (target date passed):** Severity is automatic "severe." Present only drop or new-deadline options — recovery within original deadline is no longer possible.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/learning/open-loops.md`, `~/Documents/aireadylife/vault/learning/config.md`
- Writes to: `~/Documents/aireadylife/vault/learning/open-loops.md`
