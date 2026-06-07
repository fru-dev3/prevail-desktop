---
name: aireadylife-business-flow-build-pipeline-summary
type: flow
trigger: called-by-op
description: >
  Summarizes active proposals by stage, expected close dates, total pipeline value, and flags
  proposals needing follow-up due to inactivity.
---

## What It Does

Reads the client pipeline from `~/Documents/aireadylife/vault/business/00_current/` and extracts all records with a status other than closed-won or closed-lost (i.e., all active opportunities). Groups active opportunities by stage: sent (proposal delivered, no response yet), in-review (client acknowledged, evaluating), verbal-yes (informal commitment received, contract pending), and closing (contract sent, awaiting signature or payment). Calculates total pipeline value at each stage and as a grand total.

Applies standard stage probability weights to produce a weighted pipeline value — a more realistic revenue forecast than raw pipeline total: sent = 10%, in-review = 40%, verbal-yes = 80%, closing = 95%. For example, $10,000 in the sent stage contributes $1,000 to the weighted forecast, while $10,000 in verbal-yes contributes $8,000. Weighted pipeline value is the number to use for cash flow planning.

Flags proposals where the last-contact date is more than 7 days ago with no response received as "stale — needs follow-up." Calculates trailing 90-day conversion rate: closed-won deals divided by total proposals sent in the prior 90 days, expressed as a percentage. Compares total pipeline value this month vs. prior month to show whether the opportunity book is growing or shrinking. Returns all results structured for the calling op.

## Triggers

Called internally by `aireadylife-business-op-pipeline-review`. Not invoked directly by the user.

## Steps

1. Read all proposal and contract records from `~/Documents/aireadylife/vault/business/00_current/`; filter to status: sent, in-review, verbal-yes, closing (exclude closed-won and closed-lost)
2. Group active opportunities by stage; sum value per stage and total active pipeline value
3. Apply stage probability weights (sent: 10%, in-review: 40%, verbal-yes: 80%, closing: 95%) to calculate weighted pipeline value per stage and overall
4. For each active opportunity, check last-contact date; flag as "stale" if last-contact date is more than 7 calendar days ago with no response recorded
5. Sort stale opportunities by days since last contact (most overdue first)
6. For the top 3 opportunities by value in the verbal-yes and closing stages, add a "priority" flag — these are closest to revenue
7. Read closed-won and closed-lost records from the prior 90 days; calculate conversion rate = closed-won / total sent in period
8. Load prior month pipeline total (from vault/business/02_briefs/pipeline-{prior month}.md if available) for MoM comparison
9. Return all results (stage breakdown, weighted forecast, stale list, top opportunities, conversion rate, MoM delta) to calling op

## Input

- `~/Documents/aireadylife/vault/business/00_current/` — proposal and contract records; each should include: client name, proposal name, value, stage, last-contact date, response status, expected close date
- `~/Documents/aireadylife/vault/business/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/business/02_briefs/pipeline-{YYYY-MM}.md` — prior month pipeline brief for MoM comparison (optional)
- `~/Documents/aireadylife/vault/business/config.md` — follow-up threshold in days (default: 7)

## Output Format

```
## Pipeline Summary — {Month} {Year}

### Stage Breakdown
| Stage       | Count | Total Value | Probability | Weighted Value |
|-------------|-------|-------------|-------------|----------------|
| Sent        | X     | $X,XXX      | 10%         | $XXX           |
| In Review   | X     | $X,XXX      | 40%         | $X,XXX         |
| Verbal Yes  | X     | $X,XXX      | 80%         | $X,XXX         |
| Closing     | X     | $X,XXX      | 95%         | $X,XXX         |
| **Total**   | **X** | **$XX,XXX** | —           | **$X,XXX**     |

### MoM: Pipeline $XX,XXX → $XX,XXX (±X%)
### 90-Day Conversion Rate: X%

### Stale Proposals (>7 days, no response)
| Client     | Proposal        | Value  | Stage     | Days Stale | Action              |
|------------|-----------------|--------|-----------|------------|---------------------|
| [Name]     | [Proposal]      | $X,XXX | Sent      | 12 days    | Send follow-up email |

### Priority Opportunities (verbal-yes / closing)
| Client     | Value  | Stage      | Expected Close | Next Action         |
|------------|--------|------------|----------------|---------------------|
| [Name]     | $X,XXX | Verbal Yes | {date}         | Send contract       |
```

## Configuration

Required in each proposal record in `~/Documents/aireadylife/vault/business/00_current/`:
- client name, proposal/project name, dollar value, current stage, last-contact date, response status (awaiting/received/none), expected close date

Optional in `~/Documents/aireadylife/vault/business/config.md`:
- `pipeline_followup_threshold_days` — days of inactivity before stale flag (default: 7)
- `pipeline_stage_weights` — override default probability weights if desired

## Error Handling

- If `05_contracts/` is empty or no active proposals: return "No active pipeline. Add proposal records to vault/business/00_current/ to enable pipeline tracking."
- If a proposal record is missing a value field: include in stage count but flag as "value unknown" and exclude from financial totals.
- If prior month brief is missing: populate MoM column with "N/A."
- If last-contact date field is missing from a record: flag that proposal as "contact date unknown — update record."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/business/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/02_briefs/`, `~/Documents/aireadylife/vault/business/config.md`
- Writes to: called by ops that write to `~/Documents/aireadylife/vault/business/02_briefs/`
