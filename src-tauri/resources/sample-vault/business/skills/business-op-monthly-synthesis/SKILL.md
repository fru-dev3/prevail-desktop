---
name: aireadylife-business-op-monthly-synthesis
type: op
cadence: monthly
description: >
  Monthly business synthesis. Aggregates revenue and expenses into a full P&L and checks the compliance calendar.
  Triggers: "monthly P&L", "business synthesis", "revenue and expenses", "net income this month".
---

## What It Does

Runs at the end of each month to close the books and produce a complete monthly business synthesis. This is the deepest, most comprehensive monthly review — it goes beyond the P&L brief to produce a full business health assessment covering financials, compliance, pipeline, and forward outlook.

Aggregates all revenue by stream and all expenses by category for the closing month from `~/Documents/aireadylife/vault/business/00_current/` and `~/Documents/aireadylife/vault/business/00_current/`. Computes gross revenue, total expenses by category, net income, and profit margin. Compares all figures to prior month and to YTD averages — a single bad month is noise, a three-month trend is signal.

Checks the compliance calendar for any deadlines in the next 60 days. Calculates YTD net income and the implied SE tax liability (15.3% on net self-employment income) to assess whether quarterly estimated tax set-asides are on track relative to the safe harbor amount (100% of prior year tax, or 110% if prior year AGI exceeded $150,000). Flags if estimated tax payments are behind the pace needed to avoid underpayment penalties.

Reviews open-loops.md for any business items that have been unresolved for more than 30 days and escalates them. Writes the complete monthly synthesis report to vault/business/02_briefs/ and produces a YTD P&L file that rolls up the calendar year to date.

## Triggers

- "business synthesis"
- "end of month business review"
- "monthly P&L"
- "close the books"
- "net income this month"
- "revenue and expenses"
- "YTD business performance"

## Steps

1. Confirm vault/business/ is set up with all required subfolders and config.md complete
2. Determine review period: the month just ended (1st through last day)
3. Call `aireadylife-business-flow-build-pl-summary` for the month's P&L with MoM comparison
4. Calculate YTD totals: sum all pl-{YYYY-MM}.md briefs from January through current month to produce cumulative YTD revenue, expenses, and net income
5. Calculate YTD profit margin (YTD net income / YTD gross revenue) and compare to prior year if available
6. Calculate estimated SE tax liability: YTD net income × 15.3% × (estimated business-use % if sole prop) — compare to estimated payments made YTD; flag if behind safe harbor pace
7. Call `aireadylife-business-flow-check-compliance-status` for all entities; surface any items due within 60 days
8. Review vault/business/open-loops.md for unresolved items older than 30 days; escalate with 🔴
9. Identify the single most important business priority for the coming month based on the full picture
10. Write synthesis report to vault/business/02_briefs/synthesis-{YYYY-MM}.md
11. Update or create vault/business/00_current/pl-{YYYY}.md with YTD cumulative figures
12. Call `aireadylife-business-task-update-open-loops` with any new flags

## Input

- `~/Documents/aireadylife/vault/business/00_current/` — current and prior month revenue records
- `~/Documents/aireadylife/vault/business/00_current/` — current and prior month expense records
- `~/Documents/aireadylife/vault/business/02_briefs/pl-*.md` — all prior monthly P&L briefs for YTD rollup
- `~/Documents/aireadylife/vault/business/00_current/compliance-checklist.md` — compliance calendar
- `~/Documents/aireadylife/vault/business/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/business/config.md` — entity settings, prior year tax liability
- `~/Documents/aireadylife/vault/business/open-loops.md` — current open items

## Output Format

```
# Business Monthly Synthesis — {Month} {Year}

## Financial Summary
| Metric          | This Month | Prior Month | YTD     |
|-----------------|------------|-------------|---------|
| Gross Revenue   | $X,XXX     | $X,XXX      | $XX,XXX |
| Total Expenses  | $X,XXX     | $X,XXX      | $XX,XXX |
| Net Income      | $X,XXX     | $X,XXX      | $XX,XXX |
| Profit Margin   | XX%        | XX%         | XX%     |

## Tax Position
- YTD estimated SE tax liability: $X,XXX
- Estimated payments made YTD: $X,XXX
- Safe harbor required by Q{X} deadline ({date}): $X,XXX
- Status: [on track / behind — $X,XXX gap]

## Compliance Calendar (next 60 days)
[Items from check-compliance-status flow]

## Stale Open Loops (>30 days unresolved)
[Items from open-loops.md]

## Priority for Coming Month
[Single most important business action with rationale]
```

## Configuration

Required in `~/Documents/aireadylife/vault/business/config.md`:
- `prior_year_tax_liability` — total federal + state tax from prior year (for safe harbor calculation)
- `estimated_payments_ytd` — quarterly estimated payments made so far this year

## Error Handling

- If any prior month P&L briefs are missing from the YTD rollup: note which months are missing and calculate YTD from available data only; flag "YTD figures incomplete — missing data for {months}."
- If prior year tax liability is not configured: skip safe harbor comparison and note "Configure prior_year_tax_liability in config.md to enable safe harbor tracking."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/business/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/02_briefs/`, `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/config.md`, `~/Documents/aireadylife/vault/business/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/business/02_briefs/synthesis-{YYYY-MM}.md`, `~/Documents/aireadylife/vault/business/00_current/pl-{YYYY}.md`, `~/Documents/aireadylife/vault/business/open-loops.md`
