---
name: aireadylife-business-op-review-brief
type: op
cadence: monthly
description: >
  Monthly business brief. Pulls revenue, expenses, P&L, compliance status, and open items.
  Triggers: "business brief", "LLC update", "P&L summary", "business status", "revenue this month".
---

## What It Does

Produces the concise monthly business status brief — the document the user reads to get a quick, complete picture of business health without running a full synthesis. This is the 90-second version of the monthly review: headline numbers, status of key business areas, and a prioritized action list.

Reads the most recent P&L brief from vault/business/02_briefs/ for current month financial figures. If the P&L brief has not been run yet this month, calls the P&L review op first. Pulls the current compliance status by calling `aireadylife-business-flow-check-compliance-status`. Reads vault/business/open-loops.md for all unresolved action items. Reads the pipeline summary from the most recent pipeline brief if available.

Synthesizes all of this into a brief with: headline business health status, top 3 financial metrics with MoM direction, compliance status in one line, pipeline summary in one line, and a prioritized action list of no more than 5 items. The brief is optimized for scanning — the user should be able to make decisions from it without clicking through to underlying reports unless they want detail.

## Triggers

- "business brief"
- "business status"
- "LLC update"
- "P&L summary"
- "revenue this month"
- "how is the business doing"
- "quick business update"

## Steps

1. Check vault/business/ exists; if not, direct to setup
2. Locate the most recent P&L brief in vault/business/02_briefs/ — if current month brief does not exist, call `aireadylife-business-op-pl-review` first
3. Extract key P&L figures: gross revenue, net income, profit margin, MoM direction for each
4. Call `aireadylife-business-flow-check-compliance-status`; extract the highest-urgency compliance item and overall status (all clear / X items need attention)
5. Locate most recent pipeline brief in vault/business/02_briefs/; extract total pipeline value and number of stale proposals
6. Read vault/business/open-loops.md; count 🔴 and 🟡 items; extract top 3 by priority
7. Assess overall business health: Healthy (profitable, no 🔴 flags, compliance current), Watch (marginal profitability or 1-2 🟡 flags), At Risk (net loss, 🔴 compliance or overdue invoice flags)
8. Format the brief with status, metrics table, and prioritized action list
9. Present brief to user; offer to drill into any section

## Input

- `~/Documents/aireadylife/vault/business/02_briefs/pl-{YYYY-MM}.md` — current or most recent P&L brief
- `~/Documents/aireadylife/vault/business/02_briefs/pipeline-{YYYY-MM}.md` — most recent pipeline brief
- `~/Documents/aireadylife/vault/business/00_current/compliance-checklist.md` — compliance data
- `~/Documents/aireadylife/vault/business/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/business/open-loops.md` — current action items
- `~/Documents/aireadylife/vault/business/config.md` — entity settings

## Output Format

```
# Business Brief — {Month} {Year}

**Health:** [Healthy / Watch / At Risk]

## Financials
| Metric        | This Month | MoM    |
|---------------|------------|--------|
| Revenue       | $X,XXX     | ▲ +X%  |
| Expenses      | $X,XXX     | ▼ -X%  |
| Net Income    | $X,XXX     | ▲ +X%  |
| Margin        | XX%        | +Xpp   |

## Compliance: [All current / X items need attention]
[Highest-urgency item if any]

## Pipeline: $X,XXX active | X proposals stale
[Most critical stale follow-up if any]

## Action Items
🔴 [Urgent — due {date}]
🟡 [Watch — due {date}]
🟢 [Info — no deadline]
```

## Configuration

Required in `~/Documents/aireadylife/vault/business/config.md`:
- `entity_name` — business name for brief header

Optional:
- `monthly_revenue_target` — enables target vs actual comparison in brief

## Error Handling

- If no P&L brief exists for the current or prior month: "No P&L data found. Run 'P&L review' first to generate financial data."
- If vault is in demo mode (vault-demo/): prefix all figures with "[DEMO]" and note the user is viewing sample data.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/business/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/business/02_briefs/`, `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/open-loops.md`, `~/Documents/aireadylife/vault/business/config.md`
- Writes to: `~/Documents/aireadylife/vault/business/02_briefs/brief-{YYYY-MM}.md` (if saving the brief)
