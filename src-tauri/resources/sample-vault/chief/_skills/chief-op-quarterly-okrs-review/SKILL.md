---
name: prevail-chief-op-quarterly-okrs-review
type: op
cadence: quarterly
description: >
  End-of-quarter OKR retro. Scores each Objective on a 0.0-1.0 scale per
  standard OKR convention (≥0.7 is success, 0.4-0.6 hit but didn't
  stretch, <0.4 a real miss). Captures the "what we learned" for each
  KR and proposes the next quarter's draft OKRs based on what the data
  shows is and isn't working. Triggers: "quarterly review", "OKR
  review", "score the quarter", "Q1 retro" / "Q2 retro" / etc, "end of
  quarter review".
---

# chief-op-quarterly-okrs-review

**Cadence:** Quarterly (last business day of Mar/Jun/Sep/Dec, 14:00 local — needs 60 min focused)
**Produces:** `vault/chief/02_briefs/Q[1-4]-YYYY.md`

## What It Does

Honest scoring of the quarter against the OKRs you set at the start.
Designed to be read in the next quarter's kickoff session.

Sections:

1. **Score card** — table of every Objective + KR + 0.0-1.0 score + the
   evidence for the score
2. **What I learned** — one paragraph per Objective on what surprised you
3. **Stop / Start / Continue** — three short lists
4. **Draft OKRs for next quarter** — populated from your weekly slip
   patterns + monthly compounding wins (the council can refine)
5. **Calibration trend** — gut-vs-council accuracy this quarter vs last

## Inputs

- `vault/chief/00_current/okrs.md` (the OKRs you wrote at quarter start)
- The 3 monthly summaries from this quarter
- `vault/chief/_calibration.md` (running scoreboard)
- Every domain's `state.md` for outcome evidence

## Outputs

- `vault/chief/02_briefs/Q[1-4]-YYYY.md` (one per quarter — archived)
- Replaces `vault/chief/00_current/okrs.md` with next quarter's draft
  (previous moved to `01_prior/okrs-Q[1-4]-YYYY.md`)
