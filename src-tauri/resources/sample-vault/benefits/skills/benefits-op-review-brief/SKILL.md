---
name: aireadylife-benefits-op-review-brief
type: op
cadence: monthly
description: >
  Monthly benefits brief compiling 401k match capture status, YTD vs. limit progress, HSA balance and investment threshold status, coverage flags, open enrollment timing, and all outstanding benefit action items into a single prioritized briefing document. Triggers: "benefits brief", "show my benefits", "401k status", "HSA balance", "benefits summary", "benefits update".
---

## What It Does

Generates the monthly benefits brief — a single-page snapshot of your entire employer benefits picture. The brief is the benefits domain's equivalent of a dashboard: it does not replace the detailed individual reviews, but it ensures you always have a current, consolidated view of your benefits status without running each review separately.

The brief synthesizes data from across the benefits vault: 401k contribution pace and match capture from the most recent 401k review, HSA balance and contribution status from the most recent HSA review, coverage health from the most recent quarterly audit (flagging any open coverage gaps), open enrollment timing and status, and all open loop items from `vault/benefits/open-loops.md`. It presents the information in priority order — urgent items that require action by a specific date at the top, watch items (coverage gaps, contribution optimization opportunities) in the middle, and informational status updates at the bottom.

**What makes this different from individual reviews:** The individual ops (401k review, HSA review, coverage review) produce detailed, domain-specific outputs with full calculations. The monthly brief is the compressed executive view. If everything is on track, the brief is short — a green status across all lines with no action items. If something needs attention, the brief surfaces it with a specific, dated action item and a pointer to the detailed review for context. The brief is intentionally scannable in under 3 minutes.

The brief also monitors the benefits calendar for upcoming events: enrollment windows, FSA use-by deadlines, ESPP purchase dates, RSU vest dates, and beneficiary review reminders. These calendar events are shown in the brief when they are within 60 days.

## Triggers

- "benefits brief"
- "show my benefits"
- "benefits summary"
- "benefits update"
- "what's my 401k status"
- "HSA balance"
- "benefits status"
- "monthly benefits review"

## Steps

1. Check for most recent 401k review file in `vault/benefits/00_current/` — if more than 30 days old, note stale data.
2. Check for most recent HSA review file in `vault/benefits/00_current/` — if more than 30 days old, note stale data.
3. Check for most recent coverage audit in `vault/benefits/02_briefs/` — note quarter and any open gaps.
4. Read `vault/benefits/open-loops.md` — categorize all open items by severity (urgent / watch / info).
5. Read `vault/benefits/config.md` — check benefits calendar for upcoming events within 60 days (enrollment, FSA deadline, ESPP purchase, RSU vest, beneficiary review).
6. Extract 401k summary: current contribution rate, match capture status, YTD vs. limit, projected year-end.
7. Extract HSA summary: current balance, YTD contributions vs. limit, investment threshold status, pending reimbursements count and total.
8. Extract coverage summary: all active coverage lines with status, any flagged gaps from coverage audit.
9. Extract upcoming calendar events within 60 days with action-by dates.
10. Synthesize all data into brief with sections ordered by priority.
11. Write monthly brief to `vault/benefits/00_current/brief-YYYY-MM.md`.
12. Call `aireadylife-benefits-task-update-open-loops` if any new items were identified during synthesis.

## Input

- `~/Documents/aireadylife/vault/benefits/00_current/` — most recent 401k review
- `~/Documents/aireadylife/vault/benefits/00_current/` — most recent HSA review
- `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/benefits/02_briefs/` — most recent coverage audit
- `~/Documents/aireadylife/vault/benefits/open-loops.md` — all outstanding flags
- `~/Documents/aireadylife/vault/benefits/config.md` — benefits calendar events

## Output Format

**Monthly Benefits Brief** — saved as `vault/benefits/00_current/brief-YYYY-MM.md`

```
# Benefits Brief — [Month Year]

## Urgent (action required)
- [item with specific action and deadline]

## Watch (monitor)
- [item with context and suggested response]

## 401k Status
Contribution rate: X% | Match threshold: X% | Match capture: [Full / Partial — leaving $X/month]
YTD contributions: $X of $23,500 (X%) | Projected year-end: $X
Allocation: On target / Drift detected — [fund needing rebalance]

## HSA Status
Cash balance: $X | Invested: $X | Total: $X
YTD contributions: $X of $4,300/$8,550 (X%) | Projected year-end: $X
Investment threshold: [Within threshold / Transfer $X to investments]
Pending reimbursements: $X across X expenses

## Coverage Status
Medical: [Plan] — Active
Dental: [Plan] — Active
Vision: [Plan] — Active
Life: $X coverage | LTD: X% income replacement
Coverage gaps: None / [description]

## Upcoming Events (next 60 days)
- [Event] — [date] — [action needed]

## Info
[Any informational benefits notes]
```

## Configuration

No additional configuration beyond standard `vault/benefits/config.md`. If sub-domain reviews have not run recently, the brief notes stale data and recommends running the relevant op.

## Error Handling

- **Vault empty or missing:** Direct user to purchase and install the vault from frudev.gumroad.com/l/aireadylife-benefits.
- **No recent sub-domain reviews:** Generate brief from config.md data with prominent note that data may be outdated. Flag each section as estimated vs. verified.
- **Open loops file missing:** Create it fresh; note that no prior flags are tracked.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/benefits/00_current/`, `~/Documents/aireadylife/vault/benefits/00_current/`, `~/Documents/aireadylife/vault/benefits/02_briefs/`, `~/Documents/aireadylife/vault/benefits/open-loops.md`, `~/Documents/aireadylife/vault/benefits/config.md`
- Writes to: `~/Documents/aireadylife/vault/benefits/00_current/brief-YYYY-MM.md`, `~/Documents/aireadylife/vault/benefits/open-loops.md`
