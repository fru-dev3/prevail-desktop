---
name: aireadylife-benefits-op-401k-review
type: op
cadence: monthly
description: >
  Monthly 401k review covering employer match capture rate, YTD contribution progress vs. the 2025 IRS limit of $23,500, investment fund allocation drift vs. target, projected year-end balance, and withholding adequacy check. Flags any shortfall in match capture or contribution pace. Triggers: "401k review", "retirement contribution check", "employer match", "401k allocation", "am I maxing my 401k", "retirement savings update".
---

## What It Does

Runs monthly to ensure your 401k is capturing every employer match dollar available and tracking toward the IRS annual limit at an appropriate pace. The 401k is the highest-return investment most employees have access to — the employer match component is a guaranteed 50-100% return before any market performance, and the tax-deferred compounding over decades is the engine of retirement wealth. Missing match dollars or under-contributing for multiple months creates compounding shortfalls that are hard to recover from.

**Match capture check:** Reads your current contribution rate from `vault/benefits/00_current/` and calculates whether it meets or exceeds the threshold required to capture the full employer match. For a common employer structure (50% match on up to 6% of salary), the required employee contribution is 6% — anything below this leaves match money on the table. Calculates the exact dollar amount being forfeited per pay period if contribution rate is insufficient.

**YTD vs. IRS limit tracking:** The 2025 employee contribution limit is $23,500 (plus $7,500 catch-up for age 50+). Tracks YTD contributions against this limit and projects the year-end total at the current contribution rate. Two risk scenarios: (1) under-contributing — on pace to end the year well short of the limit, leaving tax-deferred space unused; (2) over-contributing to front-load (some high earners max out early in the year) — if the employer match is calculated per-paycheck rather than annually, front-loading can cause missed match in the back half of the year if contributions cease after hitting the limit.

**Investment allocation drift:** Reads the current fund allocation from the most recent 401k statement in `vault/benefits/00_current/` and compares to the target allocation stored in `vault/benefits/00_current/target-allocation.md`. Flags any fund that has drifted more than 5 percentage points from its target (a common rebalancing threshold). Calculates the dollar amounts that would need to move between funds to restore target allocation.

**Retirement projection:** Uses current account balance, current contribution pace (employee + employer), and an assumed 7% average annual return to estimate account balance at the user's target retirement age. This is a rough projection — not a financial plan — but it contextualizes whether the current contribution pace is likely to produce the retirement balance the user is targeting.

**Vesting check:** If employer contributions have a vesting schedule, calculates the user's current vested percentage and the dollar amount of unvested employer contributions that would be forfeited if employment ended today.

## Triggers

- "401k review"
- "retirement contribution check"
- "employer match check"
- "401k allocation review"
- "am I maxing my 401k"
- "retirement savings update"
- "am I leaving match money on the table"

## Steps

1. Read `vault/benefits/config.md` — confirm employer name, payroll frequency, employer match formula, match cap, vesting schedule, and contribution limits (employee, catch-up if applicable).
2. Read most recent 401k statement from `vault/benefits/00_current/` — extract current balance, YTD employee contributions, YTD employer contributions, current contribution rate, and fund holdings with allocation percentages.
3. Calculate match capture rate: if employee contribution rate ≥ match threshold → 100% capture; if below → calculate forfeited match per pay period and annualized.
4. Calculate YTD contribution pace: (YTD employee contributions ÷ pay periods elapsed) × total pay periods in year = projected year-end contribution.
5. Compare projected year-end contribution to IRS limit ($23,500 for 2025, or $31,000 if catch-up eligible).
6. Check for front-load risk: if projected to hit IRS limit before year-end and employer calculates match per-paycheck, flag potential match loss in remaining periods.
7. Read target allocation from `vault/benefits/00_current/target-allocation.md` — compare each fund's current percentage to target; flag drift > 5 percentage points.
8. Calculate rebalancing amounts: for each drifted fund, compute dollar amount to buy or sell to restore target allocation.
9. Run retirement projection: (current_balance + ongoing_annual_contributions) × (1.07 ^ years_to_retirement) — display as estimated balance at target retirement age.
10. Calculate vested employer contribution percentage based on vesting schedule and tenure.
11. Write 401k review to `vault/benefits/00_current/401k-review-YYYY-MM.md`.
12. Call `aireadylife-benefits-task-update-open-loops` with any flags (match gap, contribution shortfall, rebalancing needed).

## Input

- `~/Documents/aireadylife/vault/benefits/config.md` — employer, match formula, match cap, vesting schedule
- `~/Documents/aireadylife/vault/benefits/00_current/` — 401k statements, target-allocation.md
- `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records for trend comparison

## Output Format

**401k Review** — saved as `vault/benefits/00_current/401k-review-YYYY-MM.md`

```
## 401k Review — [Month Year]

### Match Capture
Employee contribution rate: X%
Required rate for full match: X%
Match capture: [100% / X% — leaving $X/paycheck ($X/year) on the table]
Employer match formula: [e.g., 50% match on up to 6% of salary]

### Contribution Pace
YTD employee contributions: $X of $23,500 limit (X%)
Projected year-end: $X at current rate
Status: On track / Under-contributing / Over-contributing (front-load risk)

### Investment Allocation
| Fund | Target % | Current % | Drift | Action |
|------|---------|---------|-------|--------|
| [Fund] | X% | X% | +/-X% | Rebalance / Hold |
Rebalancing needed: Yes / No — [specific instructions if yes]

### Retirement Projection
Current balance: $X
Projected balance at age [X]: $X (assumes 7% average annual return)

### Vesting Status
Tenure: X years X months
Vested percentage: X%
Unvested employer contributions: $X

### Action Items
- [specific action if any]
```

## Configuration

Required in `vault/benefits/config.md`:
- `employer_match_formula` — e.g., "50% on up to 6% of salary"
- `employer_match_cap_pct` — max percentage matched
- `vesting_schedule` — cliff date or graded schedule
- `payroll_frequency` — biweekly / semimonthly / monthly
- `target_retirement_age` — for projection calculation

Maintain `vault/benefits/00_current/target-allocation.md` with desired fund allocation percentages summing to 100%.

## Error Handling

- **No 401k statement in vault:** Prompt user to download the most recent statement from their 401k provider portal (Fidelity, Vanguard, Empower, Principal, etc.) and save it to `vault/benefits/00_current/`.
- **Target allocation not configured:** Skip drift analysis and note that target allocation must be configured for drift analysis to work.
- **Contribution rate unavailable:** Request current contribution rate from user directly to proceed with match capture calculation.
- **Catch-up eligibility unclear:** Ask user's age if not in config — catch-up contributions apply starting the calendar year you turn 50.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/benefits/config.md`, `~/Documents/aireadylife/vault/benefits/00_current/`
- Writes to: `~/Documents/aireadylife/vault/benefits/00_current/401k-review-YYYY-MM.md`, `~/Documents/aireadylife/vault/benefits/open-loops.md`
