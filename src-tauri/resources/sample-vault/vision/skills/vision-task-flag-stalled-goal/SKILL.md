---
name: aireadylife-vision-task-flag-stalled-goal
type: task
description: >
  Writes a stalled goal flag to vault/vision/open-loops.md when a goal has had no
  progress for more than 42 days. Includes goal description, domain, last activity
  date, and recommended next action (recommit, modify, or drop).
---

# aireadylife-vision-flag-stalled-goal

**Produces:** New stalled goal flag entry in ~/Documents/aireadylife/vault/vision/open-loops.md

## What It Does

This task fires when any goal in vault/vision/00_current/ has had no recorded activity — no milestone logged, no open loop resolved, no OKR progress update — for more than 42 days (6 weeks). It is the goal triage mechanism: a stalled goal is a decision point, and this task ensures that decision gets made consciously rather than through passive neglect.

**Activity detection:** Before writing a flag, the task looks for activity evidence across three sources: vault/vision/00_current/milestones.md (any milestone logged since the check date that references this goal or its domain), vault/{domain}/open-loops.md (any item marked complete since the check date related to this goal's domain), and vault/vision/00_current/ (any OKR progress update logged since the check date for a KR tied to this goal). If activity is found in any of these sources, the goal is not flagged. The 42-day threshold is applied from the date of the most recent activity in any of these sources.

**Three-option framing:** The stall is presented as a decision, not a failure. The flag writes three explicit options: (1) Recommit — "I still want this goal. The specific blocker is [X]. My concrete next action is [Y] by [date]." This option requires identifying a named blocker and a specific next step with a date — recommitting without a blocker diagnosis typically produces another stall within 6 weeks. (2) Modify — "The original goal was too broad / no longer the right target / needs to be broken down differently. The modified version is [new goal statement]." This option rewrites the goal rather than abandoning it. (3) Drop — "This goal genuinely no longer serves my life vision. I'm closing it explicitly to free attention for what actually matters." Dropping a goal is not failure — it is strategic resource allocation.

**Deduplication:** Before writing, the task checks vault/vision/open-loops.md for an existing stalled-goal flag for the same goal. If one exists, it adds an escalation note with the current date (showing the goal has been stalled for an additional N days since the first flag) rather than creating a duplicate entry.

**Tone:** The flag is written in neutral, non-judgmental language. "This goal has been inactive for 7 weeks. That's worth noticing. Here are the options:" — not "You have failed to make progress."

## Steps

1. Receive goal details from calling op: goal name, domain, date set, last activity date
2. Calculate days since last activity; confirm it exceeds 42-day threshold
3. Search vault/vision/00_current/milestones.md, vault/{domain}/open-loops.md, vault/vision/00_current/ for any activity since last activity date
4. If activity found: do not write flag; return "activity found, no stall" to calling op
5. Check vault/vision/open-loops.md for existing stalled-goal flag for the same goal
6. If existing flag: append escalation note with days-since-flag-written count; do not create duplicate
7. If no existing flag: write new stalled-goal flag with three-option decision prompt
8. Return confirmation to calling op

## Input

- Goal data from calling op (goal name, domain, date set, last activity date)
- ~/Documents/aireadylife/vault/vision/00_current/milestones.md
- ~/Documents/aireadylife/vault/{domain}/open-loops.md
- ~/Documents/aireadylife/vault/vision/00_current/
- ~/Documents/aireadylife/vault/vision/open-loops.md (for deduplication)

## Output Format

Entry in vault/vision/open-loops.md:
```markdown
- [ ] ⚠️ **Stalled Goal: [Goal Name]** — [Domain] — [N] days inactive
  - goal_set: [YYYY-MM-DD]
  - last_activity: [YYYY-MM-DD]
  - days_stalled: [N]
  - supporting_kr: [KR name if this goal supports an active OKR, or "None"]
  - flagged_date: [YYYY-MM-DD]

  **This goal has been inactive for [N] weeks. Choose one:**

  **Option A — Recommit:** "I still want this. The blocker is _[fill in]_. My next action is _[specific step]_ by _[date]_."

  **Option B — Modify:** "The original framing doesn't fit anymore. I'm rewriting it to: _[new goal statement]_."

  **Option C — Drop:** "This no longer serves my vision. I'm closing it intentionally."

  _Escalation log:_
  - [YYYY-MM-DD]: First flagged — [N] days stalled
  - [YYYY-MM-DD]: [N+X] days stalled — decision still pending
```

## Configuration

Optional in vault/vision/config.md:
- `stall_threshold_days` — default 42 (6 weeks); adjustable per user preference

## Error Handling

- **Goal missing from vault/vision/00_current/:** Cannot verify; skip. Note in calling op result.
- **open-loops.md missing:** Create the file before writing.
- **Last activity date not determinable:** Use the goal creation date as the start date for stall calculation; flag with note "Last activity date uncertain — using goal creation date."

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/vision/00_current/milestones.md, ~/Documents/aireadylife/vault/{domain}/open-loops.md, ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/open-loops.md
- Writes to: ~/Documents/aireadylife/vault/vision/open-loops.md
