---
name: aireadylife-insurance-op-coverage-audit
type: op
cadence: annual
description: >
  Annual comprehensive insurance portfolio audit comparing all coverage limits to current assets, income, and liabilities. Applies 10-12x income life insurance adequacy rule, 60-70% income disability replacement check, net-worth vs. liability + umbrella gap analysis, and property replacement cost verification. Flags gaps by severity (minor/moderate/significant) with estimated premium impact. Triggers: "coverage audit", "insurance audit", "am I underinsured", "coverage gaps", "insurance review", "full coverage check".
---

## What It Does

Runs once per year (January is the standard timing) or immediately after a major life event that changes the coverage calculus: home purchase or sale, marriage or divorce, new child, significant salary change, acquisition of a new rental property, or net worth crossing a significant threshold. This is the most important insurance op — it determines whether you have the right coverage for your current life, not for who you were when you last shopped policies.

**Life insurance adequacy:** The calculation is not just 10x income. It starts there, then adjusts. Base need = annual gross income × 10 (or × 12 if multiple dependents or if spouse cannot cover household expenses). Debt adjustment = add outstanding mortgage balance + any other significant personal debt (student loans, car loans if large). Spouse income offset = if spouse earns significant income, the income replacement need is reduced by the present value of their earning capacity over the same period the insurance is meant to cover. Reads annual income from `vault/insurance/config.md`, outstanding mortgage from property records, and dependent status. Sums all active life insurance policies from `vault/insurance/00_current/life/`. Compares total to calculated need. A common finding: group employer life (1-2x salary) + supplemental employer life (1-2x salary) = 2-4x total, vs. a 12x need — a $1M+ shortfall for a $150K earner.

**Disability coverage adequacy:** Three checks. Check 1: STD waiting period vs. liquid emergency fund — if the STD waiting period is 14 days but the emergency fund only covers 1 week of expenses, there is a liquidity gap. Check 2: LTD income replacement rate — (LTD monthly benefit ÷ gross monthly salary) should be 60-70%. For high earners where employer LTD caps at $10,000-$15,000/month: calculate the effective replacement rate and flag if below 60%. Check 3: LTD policy definition — own-occupation is stronger than any-occupation. If the employer policy is any-occupation, flag the definition risk.

**Liability and umbrella analysis:** Reads auto liability limits (per-person bodily injury / per-accident / property damage) and home/renters liability limit from `vault/insurance/00_current/`. Reads current net worth from `vault/insurance/config.md` or linked Wealth plugin data. Umbrella gap: if net worth > combined auto liability + home liability, unprotected net worth exists. Calculate unprotected exposure = net worth − (auto per-accident BI + home liability). If umbrella exists: confirm umbrella coverage exceeds unprotected exposure. If no umbrella and net worth > $300K: flag missing umbrella. If umbrella exists but net worth has grown beyond umbrella limit: flag umbrella limit increase needed.

**Property insurance — replacement cost verification:** For homeowners policies: compare dwelling coverage limit to current estimated replacement cost (cost per square foot to rebuild × home square footage). Replacement cost typically runs $150-$300/sq ft depending on construction quality and location — significantly different from market value in appreciated markets. If dwelling coverage < 80% of replacement cost, most policies apply a coinsurance penalty. For rental properties: confirm landlord policy covers current replacement cost and has appropriate liability limits.

**Over-insurance check:** Identifies situations where coverage may be excessive relative to the risk and cost could be reduced. Example: collision and comprehensive on a vehicle worth under $4,000 may cost more in premiums than the vehicle is worth — dropping these coverages on old vehicles can save $500-$1,000/year.

## Triggers

- "coverage audit"
- "insurance audit"
- "am I underinsured"
- "coverage gaps"
- "annual insurance review"
- "check all my insurance"
- "do I have enough life insurance"
- "do I have enough liability coverage"

## Steps

1. Read `vault/insurance/config.md` — extract annual gross income, net worth, outstanding mortgage, number of dependents, property list, vehicle list.
2. Read all active policies from `vault/insurance/00_current/` — extract coverage limits, deductibles, premiums, and renewal dates for each policy line.
3. Calculate life insurance need: (income × 10-12) + outstanding_mortgage + other_debt − spouse_income_offset.
4. Sum all life insurance face values. Calculate gap vs. need.
5. Read LTD benefit amount and employer LTD cap from benefits vault or policy docs. Calculate income replacement rate.
6. Read STD waiting period. Compare to emergency fund months from config. Flag liquidity gap if STD waiting period > emergency fund coverage.
7. Read auto liability per-accident limit and home liability limit. Sum = total underlying liability.
8. Compare net worth to total underlying liability + umbrella (if any). Calculate unprotected exposure.
9. Check for umbrella policy. If missing and net worth > $300K, flag as significant gap. If present, check limit sufficiency.
10. For each property: compare dwelling coverage to estimated replacement cost. Flag coinsurance risk if coverage < 80% of replacement cost.
11. Check for flood and earthquake coverage flags based on property location (stored in config).
12. Identify potential over-insurance (old vehicles with collision, excess personal property coverage).
13. Call `aireadylife-insurance-flow-analyze-coverage-gaps` for the detailed gap scoring.
14. Call `aireadylife-insurance-task-flag-coverage-gap` for each identified gap with severity and dollar impact.
15. Write coverage audit report to `vault/insurance/00_current/coverage-audit-YYYY.md`.
16. Call `aireadylife-insurance-task-update-open-loops` with all findings.

## Input

- `~/Documents/aireadylife/vault/insurance/config.md` — income, net worth, dependents, properties, vehicles
- `~/Documents/aireadylife/vault/insurance/00_current/` — all active policy documents
- `~/Documents/aireadylife/vault/insurance/01_prior/` — prior period records for trend comparison

## Output Format

**Coverage Audit Report** — saved as `vault/insurance/00_current/coverage-audit-YYYY.md`

```
## Insurance Coverage Audit — [Year]

### Life Insurance
Coverage need: $X ([X]x income + $X debt)
Current coverage: $X ([source breakdown])
Gap: $X — Severity: [Minor/Moderate/Significant]
Action: Purchase $X [term/years] term policy — estimated annual premium: $X–$X

### Disability
LTD income replacement: X% — [Adequate at 60%+ / Below 60% threshold]
STD waiting period: X days — Emergency fund covers: X days — [Adequate / Liquidity gap]
LTD definition: [Own-occupation / Any-occupation — flag if any-occ]
Action: [specific if gap]

### Liability and Umbrella
Net worth: $X
Auto liability (per accident): $X | Home liability: $X | Umbrella: $X
Total liability coverage: $X
Unprotected exposure: $X
Action: [Add umbrella / Increase umbrella / No action needed]

### Property Coverage
[Property] — Coverage: $X | Est. replacement cost: $X | Coinsurance risk: Yes/No
Flood coverage: Yes/No [flag if property in flood zone without flood policy]
Earthquake coverage: Yes/No

### Over-Insurance Opportunities
[Item] — estimated annual savings: $X

### Total Annual Premium
$X/year across all policies

### Summary
Gaps identified: X (Significant: X, Moderate: X, Minor: X)
Estimated cost to close gaps: $X–$X/year
```

## Configuration

Required in `vault/insurance/config.md`:
- `annual_gross_income` — for life insurance and disability calculations
- `estimated_net_worth` — for liability/umbrella gap analysis
- `outstanding_mortgage` — for life insurance need calculation
- `dependents_count` — for life insurance multiplier
- `emergency_fund_months` — for STD liquidity check
- `properties` — list with address, sq footage, construction type, flood zone, earthquake zone
- `vehicles` — list with year, make, model, current value (for over-insurance check)

## Error Handling

- **Policy documents missing from vault:** Cannot audit without policy data. List which policies are missing and instruct user to download declarations pages from carrier portals.
- **Net worth not configured:** Cannot perform liability/umbrella analysis. Prompt for estimated net worth.
- **Replacement cost unknown for property:** Use industry estimates ($200/sq ft default, note assumption) and flag that a proper replacement cost estimate requires an appraisal or contractor quote.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/insurance/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/insurance/config.md`, `~/Documents/aireadylife/vault/insurance/00_current/`
- Writes to: `~/Documents/aireadylife/vault/insurance/00_current/coverage-audit-YYYY.md`, `~/Documents/aireadylife/vault/insurance/open-loops.md`
