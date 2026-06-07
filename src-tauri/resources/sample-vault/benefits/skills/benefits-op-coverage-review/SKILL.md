---
name: aireadylife-benefits-op-coverage-review
type: op
cadence: quarterly
description: >
  Quarterly benefits coverage audit verifying active elections match what was chosen at enrollment and checking coverage limits against current assets, liabilities, and income. Flags life insurance shortfall (below 10x income), disability replacement below 60%, and elections that may have been accidentally dropped. Triggers: "benefits audit", "coverage review", "am I covered", "check my benefits elections", "coverage gaps", "benefits coverage check".
---

## What It Does

Runs quarterly to catch two distinct types of coverage problems: administrative errors (elections that were supposed to be in place but got dropped or misconfigured) and strategic gaps (coverage amounts that are technically in place but insufficient given current income, assets, or dependent situation).

**Administrative verification:** Reads current benefit elections from `vault/benefits/00_current/` — the coverage confirmation or benefits summary document from the most recent enrollment — and cross-checks against payroll deduction data from `vault/benefits/` pay stub records. If a benefit is elected, the corresponding deduction should appear on every paycheck. A missing deduction for medical, dental, vision, life, disability, or FSA is a signal that the election may not have been processed correctly by HR. Catches this type of administrative error — which happens more often than it should, particularly after a job transition, open enrollment system migration, or life event change.

**Coverage adequacy analysis:** For each active coverage line, checks whether the coverage amount is sufficient given the user's current situation:

*Life insurance:* Applies the 10-12x annual gross income rule. Total life coverage from all sources (employer group life + any supplemental life elected + any individual term policies) compared to the target. If dependents are present, the multiplier should be at the high end of the range (12x). Outstanding mortgage or other significant debt is added to the income replacement need. A common gap: employer group life of 1-2x salary, supplemental life of 1x salary = 2-3x total, vs. a 10-12x need. The shortfall must be covered by individual term life insurance.

*Disability insurance:* Checks that short-term and long-term disability coverage combined replace at least 60% of gross income. Notes whether the LTD policy uses "own-occupation" or "any-occupation" definition — own-occupation is the stronger definition. Checks that the STD waiting period is within the user's liquid emergency fund coverage window. For high earners where the employer LTD caps at $10,000-$15,000/month: calculates the effective income replacement rate and flags if below 60%.

*Health coverage:* Verifies medical, dental, and vision are all active. Cross-checks selected plan vs. current elections document.

*Dependent coverage:* If dependents are on the plan, confirms dependent status and coverage tier match (employee+spouse, family, etc.).

The quarterly cadence catches administrative issues early (not 11 months after the enrollment error) and ensures coverage keeps pace with income and family changes.

## Triggers

- "benefits audit"
- "coverage review"
- "am I covered"
- "check my benefits elections"
- "do I have the right coverage"
- "benefits coverage gaps"
- "verify my elections are correct"

## Steps

1. Read current elections from `vault/benefits/00_current/` — extract all active benefit elections with coverage amounts and tiers.
2. Read most recent pay stub from `vault/benefits/` — extract all benefit deductions to cross-check against elections.
3. For each elected benefit line: verify corresponding deduction appears in pay stub. Flag any discrepancy.
4. Read coverage targets from `vault/benefits/00_current/coverage-targets.md` (if exists) or use standard thresholds (life 10x income, disability 60% income).
5. Calculate life insurance coverage need: (annual gross income × 10) + outstanding mortgage + other significant debts.
6. Sum all life insurance from vault (group life, supplemental life). Compare to need. Calculate shortfall.
7. Calculate disability income replacement rate: (monthly LTD benefit ÷ monthly gross salary) × 100. Flag if below 60%.
8. Check STD waiting period vs. liquid emergency fund in config — flag if emergency fund is shorter than STD waiting period.
9. Verify health, dental, and vision elections are all active.
10. Check dependent coverage tier matches actual dependent status.
11. Call `aireadylife-benefits-flow-build-coverage-summary` for structured coverage table.
12. Write coverage audit to `vault/benefits/02_briefs/coverage-audit-QN-YYYY.md` with per-line status and gap analysis.
13. Call `aireadylife-benefits-task-update-open-loops` with all identified gaps and any administrative discrepancies.

## Input

- `~/Documents/aireadylife/vault/benefits/00_current/` — enrollment confirmation, SBCs, coverage documents
- `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/benefits/` — pay stubs for deduction verification
- `~/Documents/aireadylife/vault/benefits/config.md` — income, dependents, mortgage balance

## Output Format

**Coverage Audit** — saved as `vault/benefits/02_briefs/coverage-audit-QN-YYYY.md`

```
## Benefits Coverage Audit — [Quarter] [Year]

### Administrative Verification
| Benefit | Elected | Deduction Found | Status |
|---------|---------|----------------|--------|
| Medical | [plan] | $X/paycheck | OK / DISCREPANCY |
| Dental | [plan] | $X/paycheck | OK |
| Vision | [plan] | $X/paycheck | OK |
| Life | [amount] | $X/paycheck | OK |
| LTD | [amount] | $X/paycheck | OK |

### Coverage Adequacy
Life Insurance:
  Coverage need: $X (10x income + $X debt)
  Current coverage: $X
  Gap: $X — [action: purchase $X term life policy]

Disability:
  LTD benefit: $X/month ($X annual)
  Gross income: $X/month
  Replacement rate: X% [Target: 60%+]
  Status: Adequate / Insufficient — [action]

### Summary
  Issues requiring action: X
  Administrative discrepancies: X
  Coverage gaps: X
```

## Configuration

Required in `vault/benefits/config.md`:
- `annual_gross_salary` — for life insurance and disability adequacy calculations
- `outstanding_mortgage` — for life insurance need calculation
- `dependents` — number and ages (affects life insurance multiplier)
- `emergency_fund_months` — for STD waiting period comparison

Optional: `vault/benefits/00_current/coverage-targets.md` with custom multipliers if different from standard thresholds.

## Error Handling

- **No enrollment confirmation in vault:** Cannot verify elections. Prompt user to download the benefits confirmation from their HR portal (Workday, ADP, etc.) and save to `vault/benefits/00_current/`.
- **Income not configured:** Cannot calculate coverage needs. Request annual gross salary before proceeding.
- **Deduction discrepancy found:** Flag immediately with specific benefit and discrepancy. Recommend user contact HR benefits team within 5 business days.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/benefits/00_current/`, `~/Documents/aireadylife/vault/benefits/`, `~/Documents/aireadylife/vault/benefits/config.md`
- Writes to: `~/Documents/aireadylife/vault/benefits/02_briefs/coverage-audit-QN-YYYY.md`, `~/Documents/aireadylife/vault/benefits/open-loops.md`
