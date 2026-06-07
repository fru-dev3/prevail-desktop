---
name: aireadylife-business-op-pipeline-review
type: op
cadence: monthly
description: >
  Monthly client pipeline review that tracks active proposals, follow-ups needed, total pipeline
  value, and conversion rate. Triggers: "pipeline review", "client pipeline", "proposals",
  "sales pipeline".
---

## What It Does

Runs monthly alongside the P&L review to give a complete forward-looking picture of the business. While the P&L review is backward-looking (what happened last month), the pipeline review is forward-looking (what revenue is coming and from where). Reads all proposal and contract records from `~/Documents/aireadylife/vault/business/00_current/` to produce a snapshot of all active commercial opportunities.

Calls `aireadylife-business-flow-build-pipeline-summary` to compute the stage breakdown, weighted pipeline value, stale proposal list, and 90-day conversion rate. Reviews the stale list — any proposal with no response in more than 7 days — and generates a specific recommended follow-up action for each based on its stage and days stale: 7-14 days stale = send a brief follow-up email; 15-21 days stale = phone call or alternate contact; 22+ days stale = assume no response, mark as low probability or closed-lost unless there is a clear reason to continue pursuing.

Calculates MoM pipeline change: is the total opportunity book growing or shrinking? A shrinking pipeline in the sent and in-review stages is an early warning sign of revenue risk 60-90 days out. Writes a dated pipeline brief to vault/business/02_briefs/ and pushes all stale proposals and shrinking pipeline flags to open-loops.

## Triggers

- "pipeline review"
- "client pipeline"
- "active proposals"
- "sales pipeline"
- "what deals do I have going"
- "follow-up list"
- "what proposals are out there"
- "conversion rate"

## Steps

1. Confirm vault/business/00_current/ exists and has proposal records; if empty, prompt to add pipeline data
2. Call `aireadylife-business-flow-build-pipeline-summary` to get stage breakdown, weighted value, stale list, conversion rate, and MoM comparison
3. For each stale proposal, assign a follow-up action based on days stale: 7-14 days = email; 15-21 days = phone; 22+ days = decision needed (continue or close-lost)
4. Identify the top 3 opportunities by weighted value in verbal-yes or closing stage — these deserve the most attention
5. Flag if total pipeline is below a minimum healthy threshold (configurable in config.md; e.g., 3x monthly revenue target) — insufficient pipeline signals future revenue risk
6. Note conversion rate trend: if 90-day conversion rate has dropped more than 5 percentage points from the prior period, flag as a lead quality or proposal quality issue
7. Write pipeline brief to vault/business/02_briefs/pipeline-{YYYY-MM}.md
8. Call `aireadylife-business-task-update-open-loops` with stale proposal follow-ups and pipeline health flags

## Input

- `~/Documents/aireadylife/vault/business/00_current/` — proposal and contract records
- `~/Documents/aireadylife/vault/business/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/business/02_briefs/pipeline-{prior month}.md` — prior month brief for MoM comparison
- `~/Documents/aireadylife/vault/business/config.md` — follow-up threshold, minimum pipeline value target

## Output Format

```
# Pipeline Review — {Month} {Year}

**Total Active Pipeline:** $XX,XXX | Weighted: $X,XXX | MoM: ±X%
**90-Day Conversion Rate:** X% ({X} won / {Y} sent)

## Stage Breakdown
[Table from build-pipeline-summary flow]

## Stale Proposals — Needs Action
| Client   | Proposal     | Stage     | Days Stale | Recommended Action            |
|----------|--------------|-----------|------------|-------------------------------|
| [Name]   | [Proposal]   | Sent      | 14 days    | Send follow-up email today    |
| [Name]   | [Proposal]   | In Review | 22 days    | Call or mark closed-lost      |

## Priority Opportunities
[Top 3 by weighted value in verbal-yes/closing stage]

## Pipeline Health
[Status: healthy / watch / risk — with specific observation]
```

## Configuration

Required in `~/Documents/aireadylife/vault/business/config.md`:
- `pipeline_followup_threshold_days` — days before stale flag (default: 7)
- `pipeline_minimum_value` — minimum total pipeline to be considered healthy (optional; e.g., 3x monthly revenue target)
- `monthly_revenue_target` — used to assess pipeline health relative to target

## Error Handling

- If vault/business/00_current/ is empty: "No pipeline records found. Add proposal files to vault/business/00_current/ to enable pipeline tracking."
- If all records are closed-won or closed-lost with no active proposals: "Pipeline is empty — no active opportunities. Consider prospecting outreach."
- If a record is missing a stage field: include it in a "unclassified" category and flag for the user to update.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/business/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/config.md`
- Writes to: `~/Documents/aireadylife/vault/business/02_briefs/pipeline-{YYYY-MM}.md`, `~/Documents/aireadylife/vault/business/open-loops.md`
