---
name: aireadylife-wealth-op-review-brief
type: op
cadence: monthly
description: >
  Monthly wealth review brief. Compiles net worth delta, cash flow summary, investment
  performance highlights, active open-loop count, and prioritized action items into a
  single concise briefing document. Designed to be read in 3 minutes and acted on in
  15. Triggers: "wealth review brief", "monthly wealth brief", "wealth summary brief",
  "what happened with my wealth this month".
---

# aireadylife-wealth-review-brief

**Cadence:** Monthly (after `aireadylife-wealth-monthly-synthesis` completes)
**Produces:** Wealth review brief at `vault/wealth/02_briefs/YYYY-MM-wealth-brief.md`

## What It Does

Generates the monthly wealth review brief — a single document that synthesizes the entire wealth picture into an executive summary with prioritized actions. This is the document the user reads first; the detailed sub-reports in `vault/wealth/02_briefs/` are available for drilling down.

**Brief structure:**

**Headline.** Net worth as of [date]: $X. Change from last month: +/−$Y (+/−Z%). Direction: Up / Down / Flat.

**Net Worth Breakdown.** Key drivers of the MoM change: which accounts moved most (in plain language, not a table). "Your 401k grew by $2,100 (market gain + contributions), your checking dropped $1,800 (annual car insurance payment), and your mortgage balance fell $650 (principal paydown)."

**Cash Flow.** Income this month: $X. Expenses: $Y. Net: +/−$Z. Savings rate: W%. Budget status: N categories over budget (listed by name and overage amount). Top budget flag: "[Category]: $X over budget — [context]."

**Investments.** Portfolio total: $X. 30-day return: Y%. YTD return: Z%. Allocation status: In range / Rebalancing needed (flag count). 401k pace: On track / $X short of $23,500 limit.

**Open Items.** N open items in open-loops.md — [count] HIGH, [count] MEDIUM, [count] LOW.

**Action Items (prioritized).** Numbered list of concrete next steps, ordered by impact and urgency. Each item is a single sentence describing exactly what to do. Examples:
1. "Increase 401k contribution to $X/paycheck by logging into Fidelity NetBenefits."
2. "Review the $3,200 unexplained movement in Checking #1234 and annotate in vault."
3. "Rebalance: buy $1,800 of bonds in your Roth IRA to restore 15% bond allocation."

## Calls

- **Flows:** `aireadylife-wealth-build-review-brief` (internal flow for formatting)
- **Tasks:** `aireadylife-wealth-update-open-loops`

## Apps

None

## Vault Output

- `vault/wealth/02_briefs/YYYY-MM-wealth-brief.md` — monthly wealth review brief

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/wealth/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/wealth/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/wealth/02_briefs/` — prior briefs for period-over-period context
