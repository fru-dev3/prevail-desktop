---
name: aireadylife-vision-task-update-open-loops
type: task
description: >
  Writes all vision flags (stalled goals, OKRs off-pace, domain score declines)
  to vault/vision/open-loops.md and resolves completed items.
---

# aireadylife-vision-update-open-loops

**Produces:** Updated ~/Documents/aireadylife/vault/vision/open-loops.md with new flags added and resolved items marked complete

## What It Does

This task maintains vault/vision/open-loops.md — the highest-level open-loops file in the AI Ready Life system. While domain-specific open-loops files track execution-level items ("make the payment," "file the document," "renew the membership"), the vision open-loops file tracks strategic-level issues that require a decision about direction rather than just execution of a task.

**What goes into vision open-loops.md:** Four types of items belong here. (1) Stalled goals: goals with 42+ days of inactivity that require a recommit/modify/drop decision (written by vision-task-flag-stalled-goal). (2) Critically at-risk OKRs: key results with <50% completion and <14 days remaining in the quarter (written by vision-flow-score-domain-progress via the calling op). (3) Sustained domain score declines: domains that have scored below 5 for 2+ consecutive months — this pattern indicates a structural problem that won't fix itself (written by vision-op-monthly-scorecard via the calling op). (4) Vision-level alignment decisions: situations where the user's stated vision and their actual behavior have diverged significantly enough that a decision is needed — not just a task assignment.

**Resolution logic:** On every call, the task scans all existing open-loop items for resolution conditions. Stalled goal items are resolved when: the user logs a new milestone in that domain, or a goal is explicitly dropped (resolution note added with the close date and reason). At-risk OKR items are resolved when: the KR is achieved (completion hits 100%), or the quarter ends and the post-quarter retrospective is complete (the OKR is either achieved or formally evaluated as missed). Sustained decline items are resolved when: the domain score returns above 5 for the current month AND the prior month. Alignment decision items are resolved when: the user makes an explicit decision (calendar changes made, OKR priorities adjusted, behavior change committed to with a specific start date).

**Archive management:** Items resolved more than 60 days ago are moved to vault/vision/open-loops-archive.md to keep the active file manageable. The archive is preserved as a historical record.

**Chief plugin visibility:** vault/vision/open-loops.md is read by the Chief plugin's collect-domain-alerts flow. This means any 🔴 vision items (critically at-risk OKRs, sustained domain declines) will appear in the Chief daily brief's domain alert table and potentially in the Top 3 ACTION TODAY. This cross-domain visibility ensures strategic issues surface at the operational level — the user sees them every morning, not just during monthly vision reviews.

## Steps

1. Receive new flags list from calling op (stalled goals, at-risk OKRs, domain declines, alignment gaps)
2. For each new flag: check for existing entry matching the same goal/KR/domain
3. If match found: update existing entry with escalation note; do not duplicate
4. If no match: append new flag with full structured content
5. Scan all existing open-loop items for resolution conditions
6. For each potentially resolved item: verify resolution evidence in the relevant vault source
7. If confirmed resolved: mark as `- [x]`; add resolution note with date and method
8. Move to resolved section at bottom of file
9. Archive items resolved 60+ days ago to vault/vision/open-loops-archive.md
10. Write updated file to vault/vision/open-loops.md

## Input

- New flags from calling op (stalled goals, at-risk OKRs, domain declines)
- ~/Documents/aireadylife/vault/vision/open-loops.md (current state)
- ~/Documents/aireadylife/vault/vision/00_current/milestones.md (for resolution verification)
- ~/Documents/aireadylife/vault/vision/00_current/ (for OKR completion verification)
- ~/Documents/aireadylife/vault/vision/00_current/ (for domain score recovery verification)

## Output Format

vault/vision/open-loops.md structure:
```markdown
# Vision — Open Loops

_Last updated: YYYY-MM-DD_
_Read by: Chief plugin (morning brief), vision-op-monthly-scorecard, vision-op-quarterly-planning_

## Active
- [ ] 🔴 **Critically At-Risk OKR: Reach $50k liquid savings by June 30** — 32% complete, 14 days remaining — flagged 2026-04-13
  - diagnosis: Deprioritized in favor of discretionary spending in March
  - decision_needed: Rescue plan or accept miss?

- [ ] ⚠️ **Stalled Goal: Establish estate planning** — 63 days inactive — flagged 2026-02-10
  [three-option decision prompt]

- [ ] 🟡 **Sustained Decline: Creativity domain** — Below 5.0 for 2 consecutive months — flagged 2026-04-01
  - pattern: No creative output logged; no creative goals in current OKRs
  - options: Add a creativity OKR next quarter / Acknowledge this is a low priority right now

## Resolved
- [x] 🟡 **At-Risk OKR: Publish 4 videos by March 31** — Resolved 2026-04-02 (achieved: 4 published)
```

## Configuration

Optional in vault/vision/config.md:
- `archive_after_days` — default 60; days after resolution before archiving

## Error Handling

- **open-loops.md missing:** Create with standard header before writing.
- **Resolution evidence ambiguous:** Leave item as active; note "Resolution not confirmed — manually mark resolved when complete."
- **File grows beyond 30 active items:** Flag: "Vision open loops growing — schedule a quarterly planning session to process stalled and at-risk items."

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/vision/open-loops.md, ~/Documents/aireadylife/vault/vision/00_current/milestones.md, ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/
- Writes to: ~/Documents/aireadylife/vault/vision/open-loops.md, ~/Documents/aireadylife/vault/vision/open-loops-archive.md
