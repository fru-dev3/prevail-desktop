---
name: aireadylife-vision-flow-draft-quarterly-plan
type: flow
trigger: called-by-op
description: >
  Drafts next quarter's OKRs based on current domain scores, open milestones,
  and life vision priorities. Identifies 3-5 priority domains and proposes 2-3
  key results per domain.
---

# aireadylife-vision-draft-quarterly-plan

**Trigger:** Called by `aireadylife-vision-op-quarterly-planning`, `aireadylife-vision-op-annual-review`
**Produces:** Draft quarterly OKR plan at ~/Documents/aireadylife/vault/vision/00_current/YYYY-QN-draft-okrs.md

## What It Does

This flow synthesizes life vision context, current domain health, and the backlog of open milestones to generate a starting-point set of OKRs for the upcoming quarter. It produces a draft — a structured starting point for the user's quarterly planning conversation — not a final plan.

**Vision anchoring:** The flow begins by reading the life vision document from vault/vision/00_current/ (the 3-5 year picture). Quarterly planning without vision anchoring tends to produce reactive OKRs that address whatever was loudest last quarter rather than what matters most for long-term trajectory. The vision document is the filter: proposed objectives must connect to a 3-year or 1-year life priority, not just to a current pain point.

**Domain selection logic:** The flow selects 3-5 priority domains for the quarter using a composite score. Inputs to the selection: (1) domain score from the most recent monthly scorecard — declining or low-scoring domains get selection priority for recovery objectives; (2) vision alignment — domains that appear prominently in the life vision document get selection priority for continued-investment objectives; (3) carry-forward milestone backlog — domains with important milestones that were planned for prior quarters but not completed get selection priority because the work is already known; (4) momentum signal — domains scoring 8+ for 2+ consecutive months may not need a specific OKR this quarter (they're working already). The selected 3-5 domains represent a mix of recovery (bottom domains) and continued investment (vision-aligned domains with current momentum).

**OKR drafting:** For each selected domain, the flow drafts one Objective and 2-3 Key Results. The Objective is written as a qualitative, inspiring statement of the domain outcome being targeted this quarter — not a task list. The Key Results are written as specific, measurable outcomes with concrete targets and dates. The flow follows three rules for Key Results: they must be measurable (binary — either hit or not at quarter end), they must be achievable (calibrated to be ~70% likely to be achieved with focused effort), and they must be linked to a specific vault metric or artifact that will verify completion (a number in vault/wealth/, a filed document in vault/tax/, a logged milestone in vault/vision/).

**Rationale documentation:** For each selected domain, the flow writes a brief rationale explaining why this domain was chosen for this quarter and how the proposed OKRs connect to the life vision. This rationale is included in the draft OKR document so the user can evaluate whether the logic makes sense before committing to the quarter's priorities.

## Steps

1. Read life vision document from vault/vision/00_current/ for 3-5 year context
2. Read most recent monthly scorecard from vault/vision/00_current/ for domain scores and trends
3. Read open milestone backlog from vault/vision/00_current/ for carry-forward items
4. Score each of the 13 domains on the selection composite (domain score + vision alignment + milestone backlog)
5. Select 3-5 priority domains; write rationale for each
6. For each priority domain: draft one Objective (qualitative, inspiring, quarterly-scale)
7. For each Objective: draft 2-3 Key Results (specific, measurable, binary, achievable, linked to vault metric)
8. Verify each KR is achievable within the quarter given reasonable effort levels
9. If any KR feels unrealistic: flag with "calibration note" suggesting a more achievable version
10. Assemble draft OKR document with rationale section
11. Write draft to vault/vision/00_current/YYYY-QN-draft-okrs.md
12. Return draft with selection rationale to calling op for user review

## Input

- ~/Documents/aireadylife/vault/vision/00_current/ (life vision document, BHAG)
- ~/Documents/aireadylife/vault/vision/00_current/ (most recent monthly scorecard)
- ~/Documents/aireadylife/vault/vision/00_current/milestones.md (carry-forward milestone backlog)
- `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records for trend comparison
- Domain selection composite data from calling op

## Output Format

Draft OKR file (vault/vision/00_current/YYYY-QN-draft-okrs.md):
```markdown
# Q[N] [YYYY] — Draft OKRs

_This is a draft for review. Review with your vision agent before finalizing._

## Why These Domains?
- **[Domain 1]:** [Rationale — recovery / momentum / vision alignment / carry-forward]
- **[Domain 2]:** [Rationale]
...

## Objective 1: [Inspiring statement — Domain]
_[How this connects to the 3-year vision]_
- KR 1.1: [Specific measurable outcome] — verified by: [vault metric/artifact]
- KR 1.2: [Specific measurable outcome] — verified by: [vault metric/artifact]
- KR 1.3: [Specific measurable outcome] — verified by: [vault metric/artifact]
  - Calibration note: [if KR may be too ambitious]

## Objective 2: ...

---
Status: draft — pending review
Generated: [YYYY-MM-DD]
```

## Configuration

No configuration required. Vision document must exist in vault/vision/00_current/.

## Error Handling

- **Life vision document missing:** Draft OKRs based on domain health alone; note "Complete the life vision document in vault/vision/00_current/ to enable vision-anchored OKR drafting."
- **No monthly scorecard available:** Use domain open-loops data for selection; note limited scoring confidence.
- **Fewer than 3 domains with clear priority signals:** Draft OKRs for whatever domains have available data; note selection was based on limited signals.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/vision/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/, ~/Documents/aireadylife/vault/vision/00_current/milestones.md
- Writes to: ~/Documents/aireadylife/vault/vision/00_current/YYYY-QN-draft-okrs.md
