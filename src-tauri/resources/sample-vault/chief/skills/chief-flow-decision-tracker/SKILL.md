---
name: prevail-chief-flow-decision-tracker
type: flow
cadence: on-demand
description: >
  Lists every open decision that's waiting on you. Reads the calibration
  log for any council verdict where the user wrote down a gut answer but
  hasn't yet recorded the outcome — those are the decisions still in
  flight. Also picks up "DECIDE:" lines from open-loops.md. Sorted by
  decide-by date when known. Triggers: "open decisions", "what am I
  deciding", "decision queue", "what's pending decision".
---

# chief-flow-decision-tracker

**Cadence:** On-demand + auto-runs in daily brief
**Produces:** `vault/chief/00_current/decisions.md`

## What It Does

A decision is anything where the user has multiple options and hasn't
committed. The skill finds them by walking:

1. Every domain's `_log/*.md` for prevail-meta entries with `gut=...`
   and `retro_due` not yet passed AND no `outcome=` set — those are
   decisions where the council weighed in but the user hasn't told the
   world what they chose
2. Every domain's `open-loops.md` for lines starting with `DECIDE:`,
   `decide by`, `choose`, `pick`
3. Calendar events tagged `[decision]` or in a decision-meeting category

Output is one row per pending decision:
```
| domain   | decision                          | options | decide by  |
| -------- | --------------------------------- | ------- | ---------- |
| wealth   | prepay mortgage vs invest cash    | 2       | 2026-07-15 |
| career   | accept the SA role at Anthropic   | 3       | 2026-06-30 |
```

Past-due decisions are red-flagged at the top.

## Inputs

- Every `<domain>/_log/YYYY-MM-DD.md` for prevail-meta entries
- Every `<domain>/open-loops.md`
- Calendar connector (optional)

## Outputs

- `vault/chief/00_current/decisions.md` — the table
- Surface line in the daily brief: "3 decisions pending, 1 past due"
