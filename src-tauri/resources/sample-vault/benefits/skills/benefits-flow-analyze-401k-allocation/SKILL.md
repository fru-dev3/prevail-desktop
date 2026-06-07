---
name: aireadylife-benefits-flow-analyze-401k-allocation
type: flow
trigger: called-by-op
description: >
  Analyzes 401k fund allocation against target, checks employer match capture, calculates allocation drift per fund (flagging drift > 5 percentage points), runs a retirement balance projection at assumed 7% average annual return, and returns structured results to the calling op.
---

## What It Does

Called by `aireadylife-benefits-op-401k-review` to produce the investment allocation analysis layer of the 401k review. This flow handles the quantitative analysis — allocation drift calculations, match capture verification, and retirement projection — while the op handles overall synthesis and brief writing.

**Match capture verification:** Reads the employer match formula from `vault/benefits/config.md` (e.g., "50% match on first 6% of salary"). Reads the employee's current contribution rate from the 401k statement. Calculates the minimum contribution rate required to capture the full match. If the employee contribution rate is below this threshold, calculates: (a) the unvested match forfeited per paycheck, (b) the unvested match forfeited per year, and (c) the match capture percentage (what fraction of available match is being captured).

**Allocation drift analysis:** Reads the current fund allocation from the 401k statement in `vault/benefits/00_current/` — each fund with its name, current balance, and current allocation percentage. Reads target allocation from `vault/benefits/00_current/target-allocation.md`. For each fund, calculates drift as (current_pct − target_pct). Flags any fund with drift greater than 5 percentage points in either direction. For flagged funds, calculates the dollar amount that would need to move between funds to restore target allocation. This is not a recommendation to trade — it is a flag for the user to review and execute manually in their 401k portal if they agree with the rebalancing.

**Retirement projection:** Runs a simple compound growth projection: (current_balance + ongoing_annual_contributions) growing at 7% per year until target retirement age. This is intentionally a single-point estimate, not a Monte Carlo simulation. The purpose is directional context — is the current pace likely to produce a retirement balance in the right neighborhood, or is there a significant shortfall that warrants increasing contributions now?

**Vesting calculation:** For employers with a vesting schedule on match contributions, calculates the user's vested percentage based on tenure and the vesting schedule type (cliff: 0% until cliff date, then 100%; graded: linear percentage increase per year). The unvested employer contribution dollar amount is the amount that would be forfeited upon immediate employment termination — relevant context if the user is considering a job change.

## Steps

1. Read employer match formula and vesting schedule from `vault/benefits/config.md`.
2. Read employee contribution rate and YTD contributions from 401k statement in `vault/benefits/00_current/`.
3. Calculate match capture: compare contribution rate to match threshold; compute forfeited match per paycheck and per year if below threshold.
4. Read current fund holdings from 401k statement: fund name, balance, current allocation percentage.
5. Read target allocation from `vault/benefits/00_current/target-allocation.md`.
6. For each fund: calculate drift = current_pct − target_pct. Flag drift > 5 percentage points.
7. For each flagged fund: calculate rebalancing dollar amount = |drift_pct| × total_401k_balance.
8. Determine rebalancing direction: funds above target (sell/exchange to reduce) and funds below target (buy/exchange to increase). Ensure rebalancing amounts net to zero.
9. Calculate years to retirement from config.
10. Run retirement projection: balance_at_retirement = (current_balance + annual_contribution / 0.07) × (1.07 ^ years_to_retirement) − annual_contribution / 0.07. Report projected balance.
11. Calculate vested percentage based on tenure and vesting schedule type; calculate unvested employer contribution balance.
12. Return all calculations to calling op.

## Input

- `~/Documents/aireadylife/vault/benefits/config.md` — match formula, vesting schedule, tenure, target retirement age
- `~/Documents/aireadylife/vault/benefits/00_current/` — most recent 401k statement
- `~/Documents/aireadylife/vault/benefits/00_current/target-allocation.md` — desired fund allocation
- `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records for trend comparison

## Output Format

Structured results returned to calling op:

```
Match Capture:
  Required contribution rate: X%
  Actual rate: X%
  Capture status: [Full / X% — forfeiting $X/paycheck]

Allocation Drift:
  | Fund | Target | Current | Drift | Action |
  | [Fund A] | X% | X% | +X% | Sell $X |
  | [Fund B] | X% | X% | -X% | Buy $X |
  Rebalance needed: Yes / No

Retirement Projection:
  Current balance: $X
  Annual contribution (employee + employer): $X
  Years to retirement: X
  Projected balance at retirement: $X (assumes 7% average annual return)

Vesting:
  Vesting schedule: [Cliff at X years / Graded X% per year]
  Vested percentage: X%
  Unvested employer contributions: $X
```

## Configuration

Required in `vault/benefits/config.md`:
- `employer_match_formula` — match formula text
- `employer_match_threshold_pct` — contribution % required to get full match
- `vesting_schedule_type` — cliff or graded
- `vesting_cliff_years` — if cliff type
- `vesting_graded_schedule` — if graded type
- `employment_start_date` — for vesting calculation
- `target_retirement_age` — for projection

`vault/benefits/00_current/target-allocation.md` format:
```yaml
- fund: "[Fund Name]"
  target_pct: X
```

## Error Handling

- **No target allocation configured:** Skip drift analysis; return match capture and projection only. Flag that target allocation is needed for drift monitoring.
- **Retirement age not configured:** Default to age 67 for projection; note assumption.
- **Statement balance and contribution data inconsistent:** Flag for user review before relying on projection.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/benefits/config.md`, `~/Documents/aireadylife/vault/benefits/00_current/`
- Writes to: None (returns data to calling op)
