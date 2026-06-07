---
name: aireadylife-career-flow-build-comp-summary
type: flow
trigger: called-by-op
description: >
  Builds a total compensation comparison table showing your current TC broken down by component (base, bonus, equity, benefits) versus market P25/P50/P75 for your role, level, and location. Pulls live benchmark data from Levels.fyi, Glassdoor, and LinkedIn Salary. Returns structured table to calling op.
---

## What It Does

Called by `aireadylife-career-op-comp-review` to produce the core compensation benchmarking table. Reads the full current compensation picture from `vault/career/00_current/` and computes a component-level TC comparison against market benchmarks.

**Reading current comp:** Pulls base salary, annual bonus target (as a percent of base), current RSU grant value and vesting schedule, and employer benefits contributions from the vault. The bonus component uses target (not actual) because actual fluctuates; target is the stable plan design metric. For RSU equity: annualized value = (total grant shares × current stock price) ÷ remaining vesting years. If the stock is below the grant price (underwater), the annualized equity value is still calculated at current price — economic value is what matters, not the paper gain/loss vs. grant price. Benefits value is quantified as: annual 401k employer match (contribution rate × salary × match rate, capped at employer match cap) + annual health insurance employer premium contribution.

**Pulling market benchmarks:** Queries Levels.fyi for the configured role, level, and company tier. Levels.fyi data provides P25/P50/P75/P90 for total comp and separately for base, bonus, and equity for tech roles — this level of granularity enables component-level gap identification, not just TC-level. Cross-validates with Glassdoor salary data for the same role and metro area. If Levels.fyi data is unavailable (non-tech roles), falls back to Glassdoor as primary and LinkedIn Salary as secondary.

**Producing the comparison table:** Formats the result as a structured table with current values in the left column and market percentiles across the top. Calculates the user's approximate market percentile position (interpolating between P25 and P50, or P50 and P75) and the dollar gap vs. P50 for each component and for total TC. A time series of prior quarterly TC benchmarks is appended to the historical log — this is the only way to see whether your market position is improving (if TC is growing faster than market median) or eroding (if market is outpacing your comp growth).

## Steps

1. Read base salary from `vault/career/config.md` or most recent pay stub in `vault/career/00_current/pay-stubs/`.
2. Read bonus target percent from `vault/career/config.md`. Calculate bonus component: base × bonus_target_pct.
3. Read RSU grant details from `vault/career/00_current/equity/`. Calculate annualized equity value: (shares × current_price) ÷ vesting_years.
4. Calculate 401k match value: base × 401k_contribution_rate × employer_match_rate (capped at employer match maximum).
5. Read health insurance employer premium contribution from `vault/career/00_current/` or config.
6. Sum all components to produce total annual compensation.
7. Query Levels.fyi for market P25/P50/P75 for configured role, level, and company tier — extract component-level breakdown where available.
8. Query Glassdoor for market P25/P50/P75 for role title and metro area — use as cross-validation.
9. Build comparison table with current values and market percentiles per component.
10. Calculate user's percentile position (linear interpolation between available percentile data points).
11. Calculate dollar gap vs. P50 for each component and for total TC.
12. Append current TC and percentile to time series in `vault/career/00_current/bench-history.md`.
13. Return completed table to calling op.

## Input

- `~/Documents/aireadylife/vault/career/config.md` — role, level, company tier, metro, salary, bonus target, RSU grant info
- `~/Documents/aireadylife/vault/career/00_current/` — pay stubs, equity grant docs
- `~/Documents/aireadylife/vault/career/01_prior/` — prior period records for trend comparison
- Levels.fyi (live query or cached data not more than 90 days old)
- Glassdoor salary data (live query or cached)

## Output Format

Structured table returned to calling op:

| TC Component | Your Value | Mkt P25 | Mkt P50 | Mkt P75 | Your Gap vs P50 |
|---|---|---|---|---|---|
| Base Salary | $X | $X | $X | $X | +/-$X |
| Bonus (target) | $X | $X | $X | $X | +/-$X |
| Equity (annualized) | $X | $X | $X | $X | +/-$X |
| Benefits value | $X | — | — | — | — |
| **Total Comp** | **$X** | **$X** | **$X** | **$X** | **+/-$X** |

Percentile position: Xth (interpolated between P__ and P__)
Data sources: Levels.fyi (YYYY-MM-DD), Glassdoor (YYYY-MM-DD)

## Configuration

Required in `vault/career/config.md`: `base_salary`, `bonus_target_pct`, `rsu_shares_granted`, `rsu_grant_price`, `rsu_vesting_years`, `current_stock_price` (or ticker for live lookup), `employer_401k_match_rate`, `employer_401k_match_cap`, `health_insurance_employer_monthly`.

## Error Handling

- **Stock price unavailable:** Prompt user to provide current stock price for equity calculation. Do not omit equity from TC calculation — it is material.
- **Levels.fyi data unavailable for role:** Fall back to Glassdoor as primary, note in output that Levels.fyi was unavailable and data may be less granular.
- **Bonus structure is non-standard (e.g., project-based, discretionary):** Use target bonus if stated in offer letter or comp statement; note that actual bonus may vary significantly.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/career/config.md`, `~/Documents/aireadylife/vault/career/00_current/`
- Writes to: `~/Documents/aireadylife/vault/career/00_current/bench-history.md`
