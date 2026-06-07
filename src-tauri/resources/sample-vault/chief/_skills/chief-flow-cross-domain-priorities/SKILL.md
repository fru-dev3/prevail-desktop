---
name: prevail-chief-flow-cross-domain-priorities
type: flow
cadence: on-demand
description: >
  Reads every domain's open-loops.md and produces a single ranked list
  of "what matters right now across my whole life." Ranks by stakes ×
  urgency × time-since-touched. Used as the input for the daily brief's
  top-3 section and as a standalone "what should I work on" answer.
  Triggers: "what should I work on", "top priorities", "across all my
  domains", "what matters most", "where should I focus".
---

# chief-flow-cross-domain-priorities

**Cadence:** On-demand (runs whenever the daily brief or weekly review fires)
**Produces:** `vault/chief/00_current/priorities.md`

## What It Does

Walks every life domain in the vault and reads `open-loops.md` from each.
Each open loop is scored:

```
score = stakes_weight × urgency × recency_decay
```

Where:
- **stakes_weight**: high/medium/low (from the open-loop's prefix tag, or
  inferred from keywords like "deadline", "review", "draft")
- **urgency**: days until any due date in the loop text (if no date,
  defaults to 30 days)
- **recency_decay**: how stale the loop is — items untouched >14 days
  drift to the bottom unless they have a hard deadline, items recently
  added bubble up

Output is a flat ranked list of the top 12 cross-domain items, with
domain prefix tag (`[wealth]`, `[career]`, `[health]`).

## Inputs

- Every `<domain>/open-loops.md` and `<domain>/state.md`
- `vault/chief/00_current/okrs.md` (boost items that hit a current OKR)

## Outputs

- `vault/chief/00_current/priorities.md` — the ranked list
- Top-3 surface fed into `chief-op-daily-brief`'s "Top 3 priorities" section
