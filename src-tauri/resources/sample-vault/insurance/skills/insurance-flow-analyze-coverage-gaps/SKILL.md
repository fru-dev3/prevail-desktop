---
name: aireadylife-insurance-flow-analyze-coverage-gaps
type: flow
trigger: called-by-op
description: >
  Compares all coverage limits to current assets, income, and liabilities to identify meaningful gaps. Applies 10-12x income life insurance rule, 60-70% disability replacement check, net-worth vs. combined liability + umbrella analysis, and 80% replacement cost property coinsurance threshold. Rates each gap by severity (minor/moderate/significant) and estimates annual premium impact to close.
---

## What It Does

Called by `aireadylife-insurance-op-coverage-audit` to perform the quantitative gap analysis. Reads coverage limits from `vault/insurance/00_current/` and applies domain-specific adequacy rules to produce a scored, ranked gap list with financial exposure quantification and estimated cost to resolve.

**Life insurance gap calculation:** Life insurance need = (annual_gross_income × multiplier) + outstanding_mortgage + significant_debts − spouse_income_offset. Multiplier: 10 for no dependents or single-income household, 12 for multiple dependents or if coverage must support stay-at-home partner. Sum all active life policies (group life, supplemental life, individual term). Gap = need − total_coverage. If gap > 0: severity is minor for gaps under 25% of need, moderate for 25-50% of need, significant for > 50% of need. Premium estimate to close: term life premiums roughly $500-$800/year per $500K of coverage for a healthy 35-year-old (varies significantly with age and health class).

**Disability gap analysis:** STD liquidity check: if STD_waiting_period_days > (emergency_fund_months × 30), there is a liquidity gap — the user would need to cover expenses between incident and first STD payment from a depleted emergency fund. LTD replacement rate: (monthly_LTD_benefit ÷ monthly_gross_salary) × 100. If < 60%: gap = (monthly_gross_salary × 0.60) − monthly_LTD_benefit. Annualized disability income gap = gap_monthly × 12. Severity: minor if replacement rate 55-60%, moderate if 45-55%, significant if below 45% or if no LTD coverage exists. LTD definition quality: any-occupation is a significant coverage quality gap even if the math shows 60%+ replacement — flag separately.

**Liability and umbrella analysis:** Total liability coverage = min(auto_per_accident_BI, auto_property_damage) + home_or_renters_liability. Compare to estimated net worth. If net worth > total_underlying_liability: unprotected_exposure = net_worth − total_underlying_liability. If umbrella exists: effective_liability = total_underlying_liability + umbrella_limit. If net worth > effective_liability: umbrella gap = net_worth − effective_liability. Severity thresholds: minor = unprotected exposure < $100K; moderate = $100K-$500K; significant = > $500K or missing umbrella with net worth > $300K.

**Property coinsurance analysis:** For each property with homeowners or landlord insurance: compare dwelling_coverage to estimated_replacement_cost. If dwelling_coverage < (replacement_cost × 0.80): coinsurance_risk exists. The coinsurance penalty calculation: (coverage_limit ÷ (replacement_cost × 0.80)) × claim_amount = insurer payment. A $300K coverage on a $500K replacement cost home (80% threshold = $400K) means a $100K partial loss is only paid at 300/400 = 75% → insurer pays $75K, you absorb $25K shortfall. Severity: minor if coverage is 75-80% of replacement cost, moderate if 65-75%, significant if below 65% or if coverage shortfall is > $100K.

**Premium impact estimation:** For each identified gap, estimates annual premium range to close it based on market averages. Life insurance: $500-$1,500/year per $500K of 20-year term coverage depending on age and health class. Disability (individual LTD to fill group LTD gap): $1,000-$3,000/year depending on benefit amount and occupation class. Umbrella: $200-$400/year per $1M in coverage. Property coverage increase: relatively low — typically $10-$25 per $10,000 of additional dwelling coverage.

## Steps

1. Read all coverage limits from `vault/insurance/00_current/` or from policy records in `vault/insurance/00_current/`.
2. Read financial benchmarks from `vault/insurance/config.md`: income, net worth, mortgage, dependents, emergency fund months.
3. Calculate life insurance need and gap. Rate severity.
4. Calculate LTD replacement rate and STD liquidity check. Rate severity for each.
5. Check LTD policy definition — flag if any-occupation.
6. Calculate total underlying liability coverage. Compare to net worth. Calculate unprotected exposure. Check umbrella.
7. For each property: compare dwelling coverage to estimated replacement cost. Check 80% coinsurance threshold.
8. Check for missing flood coverage (if property is in flood zone per config).
9. Check for missing earthquake coverage (if property is in seismic zone per config).
10. For each identified gap: estimate annual premium impact to close.
11. Rank all gaps by severity (significant first) then by financial exposure.
12. Return ranked gap list with severity, financial exposure quantification, and premium estimates.

## Input

- `~/Documents/aireadylife/vault/insurance/00_current/` — current coverage limits
- `~/Documents/aireadylife/vault/insurance/00_current/` — policy documents for limit verification
- `~/Documents/aireadylife/vault/insurance/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/insurance/config.md` — income, net worth, mortgage, dependents, properties

## Output Format

Structured gap analysis returned to calling op:

```
Gap 1: Life Insurance
  Coverage need: $X ([X]x income + $X debt)
  Current coverage: $X
  Shortfall: $X
  Financial exposure: $X of income replacement uncovered
  Severity: Significant
  Est. premium to close: $X–$X/year (20-year term)

Gap 2: Umbrella Liability
  Net worth: $X
  Total underlying liability: $X
  Unprotected exposure: $X
  Severity: Significant (net worth > $300K with no umbrella)
  Est. premium: $200–$400/year for $1M umbrella

[repeat for each gap]

Over-Insurance:
  [Item] — could reduce coverage without meaningful risk increase; est. savings $X/year

No Gap:
  [Policy line] — coverage is adequate relative to current benchmarks
```

## Configuration

All required data comes from `vault/insurance/config.md` and `vault/insurance/00_current/` or `vault/insurance/00_current/`. No additional configuration required.

## Error Handling

- **Coverage limits unknown for a policy line:** Cannot gap-analyze that line. Note as "data unavailable" and flag that the policy document must be in vault.
- **Net worth not configured:** Skip liability/umbrella analysis with note that net worth is required.
- **Property replacement cost unknown:** Use $200/sq ft × sq footage as default estimate; flag as estimated.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/insurance/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/config.md`
- Writes to: None (returns data to calling op)
