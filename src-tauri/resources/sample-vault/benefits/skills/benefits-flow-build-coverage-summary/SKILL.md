---
name: aireadylife-benefits-flow-build-coverage-summary
type: flow
trigger: called-by-op
description: >
  Compiles a structured coverage table for all active employer benefits — medical plan with deductible and OOP limits + YTD spend, dental, vision, 401k match rate and YTD, HSA contribution pace, life insurance face value, and disability income replacement rate. Returns a formatted table to the calling op.
---

## What It Does

Called by `aireadylife-benefits-op-enrollment-review`, `aireadylife-benefits-op-coverage-review`, and `aireadylife-benefits-op-review-brief` to produce the core benefits coverage table. This is the inventory and status layer — it compiles what coverage exists and where you stand on utilization of each limit. The calling ops use this table for enrollment comparisons, gap analysis, and monthly briefing.

**Medical coverage:** Reads the active medical plan from `vault/benefits/00_current/` — extracts plan name, plan type (HMO / PPO / HDHP / EPO), calendar year deductible (individual and family amounts), out-of-pocket maximum (individual and family), coinsurance rate after deductible, and monthly employee premium. Pulls YTD deductible spend and YTD OOP spend from claim records in `vault/benefits/00_current/` (EOBs filed during the plan year). Calculates remaining deductible and remaining OOP max for the plan year.

**Dental and vision:** Reads plan names and key limits — dental annual maximum, orthodontia lifetime maximum if applicable, vision exam allowance and frame/lens allowance. Pulls any YTD dental benefit usage from EOBs.

**401k:** Reads employer match rate, YTD employee contribution, YTD employer match contribution from most recent 401k data in `vault/benefits/00_current/`. Calculates YTD employer match as a percentage of the available match (match capture rate).

**HSA:** Reads current HSA balance (cash + invested), YTD contributions, and IRS limit for the coverage tier from `vault/benefits/00_current/`. Calculates remaining contribution room for the year.

**Life insurance:** Reads the face value of employer-provided group life, supplemental life (if elected), and combined total. Reads annual salary from config to calculate current income multiple (coverage ÷ income).

**Disability:** Reads short-term disability (waiting period, benefit percentage, maximum benefit period) and long-term disability (waiting period, benefit percentage, own-occupation vs. any-occupation definition, benefit period, monthly benefit cap) from plan documents in `vault/benefits/00_current/`. Calculates effective income replacement rate: (monthly LTD benefit ÷ monthly gross salary) × 100.

## Steps

1. Read active medical plan from `vault/benefits/00_current/` — extract plan type, deductible, OOP max, premium.
2. Sum YTD deductible and OOP spend from EOBs in `vault/benefits/00_current/` for current plan year.
3. Calculate remaining deductible room: deductible − YTD_deductible_spend (floor at 0).
4. Calculate remaining OOP room: OOP_max − YTD_OOP_spend (floor at 0).
5. Read dental plan name and limits from `vault/benefits/00_current/`.
6. Read vision plan name and limits from `vault/benefits/00_current/`.
7. Read 401k match rate and YTD contribution data from `vault/benefits/00_current/`.
8. Read HSA balance, YTD contributions, and coverage tier from `vault/benefits/00_current/`.
9. Calculate HSA remaining contribution room: limit − (YTD_employee_contributions + YTD_employer_contributions).
10. Read life insurance face values from `vault/benefits/00_current/` — sum all active policies.
11. Read disability plan details from `vault/benefits/00_current/` — extract benefit percentages and caps.
12. Calculate disability income replacement rate.
13. Format all values into a coverage table.
14. Return complete coverage table to calling op.

## Input

- `~/Documents/aireadylife/vault/benefits/00_current/` — all active plan documents
- `~/Documents/aireadylife/vault/benefits/00_current/` — EOBs and claim records for YTD spend
- `~/Documents/aireadylife/vault/benefits/00_current/` — 401k data
- `~/Documents/aireadylife/vault/benefits/00_current/` — HSA data
- `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/benefits/config.md` — annual salary, coverage tier

## Output Format

Coverage table returned to calling op:

```
Medical: [Plan Name] — [HMO/PPO/HDHP]
  Deductible: $X individual / $X family | YTD: $X | Remaining: $X
  OOP Max: $X individual / $X family | YTD: $X | Remaining: $X
  Monthly premium (employee): $X

Dental: [Plan Name]
  Annual max: $X | YTD used: $X | Remaining: $X

Vision: [Plan Name]
  Exam allowance: $X | Frame/lens allowance: $X

401k:
  Match rate: [formula] | YTD employee: $X | YTD employer match: $X
  Match capture: X% of available match

HSA:
  Balance (cash + invested): $X | YTD contributions: $X | Remaining limit: $X

Life Insurance:
  Total coverage: $X | Income multiple: X.Xx annual salary

Disability:
  STD: X% income replacement for up to X months (X-day waiting period)
  LTD: $X/month (X% income replacement) — [own-occupation / any-occupation]
```

## Configuration

Plan documents must be saved to `vault/benefits/00_current/` in legible text or PDF format with clearly labeled limit fields. YTD claim data requires EOBs to be filed in `vault/benefits/00_current/` with the plan year in the filename.

## Error Handling

- **EOBs not filed:** YTD spend for deductible and OOP will show as $0 (unknown). Note that YTD spend data is unavailable and direct user to file EOBs.
- **Disability plan document missing:** Report disability section as "Plan document not available — add to vault/benefits/00_current/ to enable disability coverage analysis."
- **Multiple medical plans (e.g., mid-year change):** Use the plan in effect as of the current date; note the change date.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/benefits/00_current/`, `~/Documents/aireadylife/vault/benefits/00_current/`, `~/Documents/aireadylife/vault/benefits/00_current/`, `~/Documents/aireadylife/vault/benefits/00_current/`, `~/Documents/aireadylife/vault/benefits/config.md`
- Writes to: None (returns data to calling op)
