---
name: aireadylife-wealth-task-flag-savings-milestone
type: task
cadence: called-by-op
description: >
  Writes a positive milestone flag to vault/wealth/open-loops.md when an account or
  metric crosses a meaningful financial threshold: emergency fund reaching 3 or 6 months,
  invested assets crossing $50k/$100k/$250k/$500k, a debt fully paid off, or a savings
  account hitting a configured target. Includes the goal achieved and a specific
  suggestion for where to redirect the freed cash flow or next savings priority.
---

# aireadylife-wealth-flag-savings-milestone

**Cadence:** Called by debt review and net worth review ops
**Produces:** Milestone entries in `vault/wealth/open-loops.md`

## What It Does

Called when an account or metric crosses a meaningful threshold. Milestones are positive events — the opposite of a warning flag — but they still warrant attention because they represent decision points: when a debt is paid off, the freed monthly payment should be redirected with intention; when an invested asset milestone is crossed, it's worth acknowledging and considering whether the allocation or contribution strategy should evolve.

**Default milestone thresholds.** Built-in milestones include:
- Emergency fund reaches 3 months of essential expenses — "Solid foundation. Consider building to 6 months if income is variable."
- Emergency fund reaches 6 months of essential expenses — "Emergency fund complete. Redirect excess savings to [next priority from config]."
- Invested assets cross $50,000 — "First major investing milestone. Time to review asset allocation."
- Invested assets cross $100,000 (The 'first $100k' milestone — behavioral finance research shows this is the hardest to reach; compound growth accelerates here)
- Invested assets cross $250,000
- Invested assets cross $500,000
- Individual debt fully paid off — "[$debt name] paid off. Redirect $X/month to [next debt or investment]."
- 401k YTD contributions hit the annual max ($23,500) — "401k maxed for the year. Any additional retirement savings should go to Roth IRA or taxable brokerage."
- IRA YTD contributions hit the annual max ($7,000)

**Custom milestones.** Additional milestones can be configured in `vault/wealth/config.md` under `savings_milestones`: e.g., `mortgage_below_300k: true`, `brokerage_above_150k: true`.

Each milestone entry contains: the goal achieved (in plain language), the account or metric that crossed the threshold, the date it was crossed, the amount, and a specific "next step" suggestion. Unlike warning flags, milestones are informational and positive in tone. They are marked with status MILESTONE (not OPEN) and do not appear in the "urgent items" section of the wealth brief. They are resolved automatically once read and acknowledged by the user.

## Apps

None

## Vault Output

- `vault/wealth/open-loops.md` — milestone entry appended
