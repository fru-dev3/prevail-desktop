---
name: prevail-chief-op-weekly-review
type: op
cadence: weekly
description: >
  Friday-evening week-in-review. Captures what shipped, what slipped,
  what surprised, and what's next. Aggregates highlights and slips from
  every domain's _log/ entries this week. Surfaces calibration trends
  from gut-vs-council outcomes. Produces a single-page review used as
  context for next week's planning. Triggers: "weekly review", "friday
  review", "review the week", "how did this week go", "what shipped
  this week".
---

# chief-op-weekly-review

**Cadence:** Weekly (Friday 17:00 local)
**Produces:** `vault/chief/02_briefs/week-YYYY-WW.md`; cross-posts the headline section to `vault/chief/state.md`.

## What It Does

The lightest-weight retrospective that still has signal: ~10 minutes to
generate, ~3 minutes to read.

Sections:

1. **Headline** — one sentence: "this week we _____ and _____."
2. **Shipped** — completed items across all domains' open-loops (week-over-week diff)
3. **Slipped** — open-loops with no progress for 7+ days
4. **Surprised** — calibration entries where outcome ≠ gut, with the lesson
5. **Next week's top 3** — automatically promoted to next week's daily briefs

## Inputs

- Every `<domain>/_log/YYYY-MM-DD.md` for the past 7 days
- Every `<domain>/open-loops.md` (diffed week-over-week against last Friday's snapshot)
- `<domain>/_calibration.md` if the domain has retros recorded

## Outputs

- `vault/chief/02_briefs/week-YYYY-WW.md` (one file per ISO week)
- Updates `vault/chief/state.md` "this week" section with the headline
- Updates `vault/chief/00_current/next-week.md` with the top-3 carry-forward
