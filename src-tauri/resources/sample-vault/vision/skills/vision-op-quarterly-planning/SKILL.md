---
name: aireadylife-vision-op-quarterly-planning
type: op
cadence: quarterly
description: >
  Structured quarterly planning session. Reviews prior quarter OKRs, runs a retrospective,
  and sets new OKRs for the next quarter aligned to the life vision.
  Triggers: "quarterly planning", "set goals", "quarterly review", "Q planning session".
---

# aireadylife-vision-quarterly-planning

**Cadence:** Quarterly (first week of January, April, July, October)
**Produces:** Quarterly retrospective + new OKRs at ~/Documents/aireadylife/vault/vision/00_current/YYYY-QN-okrs.md and planning session at vault/vision/00_current/YYYY-QN-planning-session.md

## What It Does

The quarterly planning session is the most important strategic conversation in the vision plugin — it anchors the next 3 months of intentional effort. It runs in three phases, designed to be completed in a single 90-120 minute session or spread across two shorter conversations.

**Phase 1 — Retrospective (30-45 minutes):** Reviews each prior-quarter OKR using a structured format. For each Objective: was it achieved? What percentage of the Key Results were fully hit? For each Key Result individually: what was the final result, what was the target, and what is the honest explanation for the gap or overachievement? The retrospective is not a performance review — it is a learning exercise. Goals that were missed reveal information about either the goal itself (was it realistic?), the user's actual priorities (did other things consistently win?), or systemic blockers (was there something structural preventing progress?). Each lesson learned is captured in the planning session document.

**Phase 2 — Quarterly Scorecard (15-20 minutes):** Calls `vision-flow-build-scorecard` and `vision-flow-score-domain-progress` to compile the final picture of the quarter across all 13 domains. Identifies the 2-3 domains with the strongest positive momentum entering the new quarter (candidate for continued investment) and the 2-3 domains most in need of attention (candidate for a focused recovery objective). This domain health picture informs which objectives to carry forward vs. which to pivot.

**Phase 3 — New OKRs (45-60 minutes):** Calls `vision-flow-draft-quarterly-plan` to generate a first-draft set of OKRs for the upcoming quarter based on: the life vision document (3-5 year context), domain health scores from Phase 2, carry-forward milestones from vault/vision/00_current/, and the lessons from the retrospective. The draft presents 3-5 proposed Objectives with 2-3 draft Key Results per Objective. The user then reviews the draft in conversation — modifying Key Results to be more precise, adjusting the difficulty calibration, or replacing objectives that no longer feel aligned. The final agreed OKRs are saved to vault/vision/00_current/YYYY-QN-okrs.md.

The planning session document (written to vault/vision/00_current/) captures the full retrospective notes, the domain health summary, and the final OKRs — creating a searchable archive of how goals evolved quarter over quarter.

## Triggers

- "quarterly planning"
- "set goals"
- "quarterly review"
- "Q planning session"
- "start next quarter"
- "plan my quarter"
- "Q1 planning" / "Q2 planning" / "Q3 planning" / "Q4 planning"

## Steps

1. Verify vault/vision/ exists and prior quarter's OKRs are in vault/vision/00_current/; if missing, note
2. **Phase 1:** Read prior quarter OKRs from vault/vision/00_current/; for each KR, read completion evidence from relevant domain vaults
3. Calculate final completion percentages for each KR; identify achieved vs. missed
4. Conduct retrospective conversation: for each missed KR, ask "What happened? What did this teach us?"
5. Capture retrospective notes and lessons learned
6. **Phase 2:** Call `vision-flow-build-scorecard` for final quarterly domain health picture
7. Call `vision-flow-score-domain-progress` for final OKR completion assessment
8. Identify top 2-3 momentum domains and top 2-3 needs-attention domains
9. **Phase 3:** Call `vision-flow-draft-quarterly-plan` with: vision doc, domain scores, lessons learned, carry-forward milestones
10. Present draft OKRs (3-5 Objectives, 2-3 KRs each) for user review
11. Facilitate OKR refinement conversation: sharpen KR specificity, calibrate difficulty, confirm alignment with vision
12. Write finalized OKRs to vault/vision/00_current/YYYY-QN-okrs.md
13. Write full planning session document to vault/vision/00_current/YYYY-QN-planning-session.md
14. Call `vision-task-update-open-loops` to clear prior-quarter flags and write new quarter's priority flags

## Input

- ~/Documents/aireadylife/vault/vision/00_current/ (prior quarter OKRs)
- ~/Documents/aireadylife/vault/vision/00_current/ (life vision document, milestones, BHAG)
- ~/Documents/aireadylife/vault/vision/00_current/ (monthly scorecard history)
- `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/*/open-loops.md (domain health for scorecard)
- ~/Documents/aireadylife/vault/vision/config.md

## Output Format

OKR file (vault/vision/00_current/YYYY-QN-okrs.md):
```markdown
# Q[N] [YYYY] — Objectives & Key Results

## Objective 1: [Qualitative, inspiring statement]
- KR 1.1: [Specific measurable outcome by date]
- KR 1.2: [Specific measurable outcome by date]
- KR 1.3: [Specific measurable outcome by date]

## Objective 2: ...

---
Quarter: Q[N] [YYYY]
Set: [YYYY-MM-DD]
Status: active
```

Planning session file (vault/vision/00_current/YYYY-QN-planning-session.md):
- Prior quarter retrospective with completion percentages and lessons learned
- Domain health summary (13-domain scores entering new quarter)
- Final OKRs as agreed

## Configuration

Required in vault/vision/config.md:
- Life vision document (3-5 year picture) must be present for Phase 3
- `active_domains` — which domains are tracked for the scorecard

## Error Handling

- **No prior quarter OKRs found:** Run Phase 1 as first-time planning with no retrospective; note "First planning session — no prior OKRs to review."
- **Life vision document missing from vault/vision/00_current/:** Run draft OKR phase with domain health alone; prompt user to complete the life vision document.
- **User ends session after Phase 1 or 2:** Save progress to vault/vision/00_current/YYYY-QN-planning-session-draft.md; resume on next call.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/*/open-loops.md
- Writes to: ~/Documents/aireadylife/vault/vision/00_current/YYYY-QN-okrs.md, ~/Documents/aireadylife/vault/vision/00_current/YYYY-QN-planning-session.md
