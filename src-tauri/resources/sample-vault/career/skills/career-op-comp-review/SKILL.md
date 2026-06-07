---
name: aireadylife-career-op-comp-review
type: op
cadence: quarterly
description: >
  Quarterly total comp benchmarking vs. market P25/P50/P75 for your role, level, and location. Reads your full TC breakdown from vault, pulls live market data from Levels.fyi, Glassdoor, and LinkedIn Salary, identifies your percentile position, and flags comp gaps with a tiered action plan. Triggers: "comp review", "am I paid fairly", "check my salary", "salary benchmark", "how does my pay compare", "total comp analysis".
---

## What It Does

Runs quarterly to give a data-backed picture of exactly where your total compensation sits relative to the current market for your specific role, level, and geography. This is not a rough estimate — it computes your full TC as the sum of base salary, annual bonus (at target), annualized equity value (RSU grant divided by vesting period, adjusted for current stock price vs. grant price), and quantifiable benefits value (401k employer match, health insurance premium employer contribution). That full TC number is what gets compared to market benchmarks.

Market data is sourced in priority order from Levels.fyi (most granular for tech roles — breaks down by company, job family, and level with P25/P50/P75/P90), Glassdoor (broader market by title and metro area), and LinkedIn Salary (cross-validation for general market). For non-tech roles or mid-market positions, Payscale and Bureau of Labor Statistics Occupational Employment Survey data supplement the primary sources. The benchmark result shows your TC against market P25, P50, and P75 for your role family, seniority level, and metro area or remote equivalent.

When your TC falls below market P50, the comp gap flag is triggered with a tiered action plan calibrated to the severity of the gap. A gap under 10% below P50 is low severity — the recommended action is to target the gap in the next scheduled performance review cycle. A gap of 10-25% is medium severity — the plan includes initiating a compensation conversation with your manager backed by specific market data, or beginning passive market engagement to build awareness of alternatives. A gap above 25% is high severity — the recommended path is active market exploration with a 90-day timeline for external benchmarking offers. The quarterly cadence catches drift before it compounds: a 5% annual lag compounding over 4 years creates a 22% gap.

The review also checks whether your equity refresh cadence (typically annual refreshes for above-target performers) is keeping pace with market equity norms for your level. Under-market base is addressable at review; under-market equity often requires changing companies to reset.

All output is saved to `vault/career/02_briefs/` and all flags are appended to `vault/career/open-loops.md` via the flag-comp-gap task.

## Triggers

- "comp review"
- "am I paid fairly"
- "check my salary vs market"
- "salary benchmark"
- "what is my total comp"
- "how does my pay compare"
- "total compensation analysis"
- "am I underpaid"

## Steps

1. Read `vault/career/config.md` — confirm role title, level, company tier, and metro area are set.
2. Read current comp breakdown from `vault/career/00_current/` — extract base salary, bonus target %, annual RSU grant value, vesting schedule, and benefits value.
3. Calculate total annual compensation: base + (base × bonus target %) + (RSU grant ÷ vesting years × current price factor) + annual employer 401k match + annual health insurance employer contribution.
4. Identify market benchmark parameters: role title normalized to market equivalents, seniority level, company tier (FAANG / Series B+ / Fortune 500 / mid-market), and metro area or remote flag.
5. Pull Levels.fyi benchmark data for role, level, and company tier — extract P25, P50, P75 for TC and for each TC component (base, bonus, equity separately).
6. Pull Glassdoor salary data for role title and metro area — extract median and 25th/75th percentile.
7. Cross-validate with LinkedIn Salary data if available for role and location.
8. Calculate your market percentile position — where does your TC fall on the P25-P75 range?
9. Calculate the dollar gap vs. market P50 (positive = premium, negative = gap).
10. If gap exists (TC below P50): call `aireadylife-career-task-flag-comp-gap` with gap amount, severity tier, market data sources, and recommended action.
11. Append historical benchmark entry to the comp review time series in `vault/career/00_current/bench-history.md`.
12. Write dated comp review brief to `vault/career/02_briefs/YYYY-QN-comp-review.md`.
13. Call `aireadylife-career-task-update-open-loops` with all flags from this run.

## Input

- `~/Documents/aireadylife/vault/career/config.md` — role, level, company, metro, bonus structure
- `~/Documents/aireadylife/vault/career/00_current/` — pay stubs, equity grant docs, offer letter
- `~/Documents/aireadylife/vault/career/01_prior/` — prior period records for trend comparison
- Market data from Levels.fyi, Glassdoor, LinkedIn Salary (pulled live or from cached vault files)

## Output Format

**Comp Benchmarking Report** — saved as `vault/career/02_briefs/YYYY-QN-comp-review.md`

| Component | Your Value | Market P25 | Market P50 | Market P75 |
|-----------|-----------|-----------|-----------|-----------|
| Base Salary | $X | $X | $X | $X |
| Bonus (target) | $X | $X | $X | $X |
| Equity (annualized) | $X | $X | $X | $X |
| Benefits Value | $X | — | — | — |
| **Total Comp** | **$X** | **$X** | **$X** | **$X** |

**Your percentile position:** Xth percentile  
**Gap vs. market P50:** +/- $X (X%)  
**Severity:** Low / Medium / High  
**Action plan:** [specific tiered recommendation]  
**Data sources:** Levels.fyi (date), Glassdoor (date), LinkedIn Salary (date)

## Configuration

Required fields in `vault/career/config.md`:
- `role_title` — exact job title (e.g., "Senior Software Engineer")
- `level` — internal level or equivalent (e.g., "IC4", "L5", "Senior")
- `company_tier` — FAANG / Series B+ / Fortune 500 / mid-market / startup
- `metro_area` — city or "Remote"
- `base_salary` — current annual base
- `bonus_target_pct` — target bonus as percent of base
- `rsu_annual_grant_value` — current year RSU grant value at grant price
- `rsu_vesting_years` — total vesting period in years

## Error Handling

- **Config incomplete:** Prompt user to fill required fields before proceeding. Name exactly which fields are missing.
- **Market data unavailable:** Use most recent cached benchmark data in `vault/career/00_current/` and note the data age in the output. Flag if cached data is more than 90 days old.
- **Compensation docs missing from vault:** Ask user to provide base salary and bonus directly to proceed; note that equity benchmarking requires grant doc.
- **Role not found on Levels.fyi:** Fall back to Glassdoor + LinkedIn Salary; note that Levels.fyi data is most accurate for tech roles and unavailability may indicate role is outside their coverage.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/career/config.md`, `~/Documents/aireadylife/vault/career/00_current/`
- Writes to: `~/Documents/aireadylife/vault/career/02_briefs/`, `~/Documents/aireadylife/vault/career/open-loops.md`, `~/Documents/aireadylife/vault/career/00_current/bench-history.md`
