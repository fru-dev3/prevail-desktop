---
name: aireadylife-benefits-op-enrollment-review
type: op
cadence: annual
description: >
  Annual open enrollment planner comparing medical, dental, vision, FSA/HSA plan options by modeling total annual cost under three utilization scenarios (healthy year, moderate, worst-case hitting OOP max). Recommends optimal election set with side-by-side plan comparison table. Runs October-November when enrollment window opens. Triggers: "open enrollment", "benefits enrollment", "pick my benefits plan", "compare health plans", "enrollment review", "which plan should I choose".
---

## What It Does

Open enrollment is the single most financially consequential benefits decision most employees make each year — and most people make it in 10 minutes by clicking "keep same elections." This op replaces the default with a structured, data-driven decision based on your actual situation and the real plan options available.

**Total cost modeling:** Compares plans by total annual cost, not just premium. Total cost = (monthly employee premium × 12) + expected out-of-pocket spend. Expected OOP is estimated from the user's historical claims data in `vault/benefits/` (EOBs, prior year spending) and family health situation. The op models three scenarios: (1) healthy year — minimal claims, primarily preventive care and prescription maintenance; (2) moderate year — 1-2 significant events such as a specialist visit, outpatient procedure, or urgent care episode; (3) worst-case year — hitting the annual out-of-pocket maximum (plan's OOP max). For each plan option, the total cost in each scenario is calculated so the user can see both the best-case and worst-case cost profile, not just the average.

**HDHP + HSA analysis:** When an HDHP option is available, the cost comparison must include the HSA tax benefit. An HDHP with HSA has lower premiums but higher deductibles — but the HSA provides pre-tax contributions (reducing FICA, not just income tax), tax-free growth, and tax-free withdrawals. For a user in the 22% federal bracket plus state taxes plus 7.65% FICA, the effective HSA tax benefit is roughly 35-40% on contributions. This frequently makes the HDHP + HSA combination cheaper than a PPO on a total-cost basis in healthy to moderate years, even with the higher deductible.

**FSA vs. HSA decision:** If an HDHP is selected, a Health FSA is not permitted (except Limited Purpose FSA for dental/vision only). If a non-HDHP plan is selected, a Health FSA is available for up to $3,200 in 2025 (estimate your likely medical expenses and elect that amount — use-it-or-lose-it applies). This decision must be locked in at enrollment; FSA elections cannot be changed mid-year without a qualifying life event.

**Dental and vision planning:** Dental typically has an annual maximum benefit (commonly $1,000-$2,000). If major dental work is planned (crown, implant, orthodontia), check whether the dental plan maximum covers it and whether benefit year timing affects the strategy. Vision is typically straightforward — compare exam and allowance amounts against anticipated needs.

**Life and disability supplemental elections:** Open enrollment is also the opportunity to add supplemental life insurance or adjust disability coverage without medical underwriting (guaranteed issue amounts are higher during initial enrollment). If life insurance gaps exist from the coverage review, enrollment is the time to purchase supplemental coverage at group rates.

## Triggers

- "open enrollment"
- "benefits enrollment"
- "pick my benefits plan"
- "compare health plans"
- "enrollment review"
- "which plan should I choose this year"
- "help me pick my 401k and benefits"

## Steps

1. Confirm enrollment window dates from `vault/benefits/00_current/` or user input. Call `aireadylife-benefits-task-flag-enrollment-window` with start and end dates.
2. Read all available plan options from `vault/benefits/00_current/` — extract for each medical option: monthly employee premium (by tier: employee / employee+spouse / family), annual deductible (individual and family), OOP max (individual and family), coinsurance rate after deductible, copay structure, HSA-eligible flag.
3. Read user's family situation from `vault/benefits/config.md` — dependents, coverage tier needed, any known planned medical expenses for next year.
4. Read historical claims/spending data from `vault/benefits/` if available — estimate annual OOP spending per scenario.
5. For each medical plan option × each scenario: calculate total annual cost = (premium × 12) + estimated OOP for scenario.
6. If HDHP option exists: calculate HSA tax benefit (pre-tax contribution × effective tax rate) and subtract from HDHP total cost in each scenario.
7. Build plan comparison table sorted by total cost in each scenario.
8. Identify recommended plan: lowest total cost in the user's most likely scenario, acceptable worst-case.
9. Model FSA vs. HSA decision based on recommended plan type.
10. Review dental and vision options — flag if major dental work planned that affects plan selection.
11. Check supplemental life and disability options — cross-reference coverage gaps from most recent quarterly audit.
12. Generate election recommendation: medical plan, coverage tier, HSA contribution election (if HDHP), FSA election (if non-HDHP), dental plan, vision plan, supplemental life/disability if needed.
13. Write enrollment analysis to `vault/benefits/02_briefs/enrollment-YYYY.md` with comparison table and recommended elections.
14. Call `aireadylife-benefits-task-update-open-loops` with enrollment deadline and recommended actions.

## Input

- `~/Documents/aireadylife/vault/benefits/00_current/` — plan documents, SBCs for all options
- `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/benefits/config.md` — income, tax bracket, dependents, planned expenses
- `~/Documents/aireadylife/vault/benefits/` — prior year EOBs and claims data for OOP estimation

## Output Format

**Enrollment Analysis** — saved as `vault/benefits/02_briefs/enrollment-YYYY.md`

```
## Open Enrollment Analysis — [Plan Year]

Enrollment window: [start date] – [end date]
Coverage tier needed: [Employee / Employee+Spouse / Family]

### Medical Plan Comparison — Annual Total Cost

| Plan | Monthly Premium | Annual Premium | Deductible | OOP Max | Healthy Year | Moderate Year | Worst Case |
|------|---------------|---------------|-----------|---------|-------------|--------------|-----------|
| [Plan A - PPO] | $X | $X | $X | $X | $X | $X | $X |
| [Plan B - HDHP] | $X | $X | $X | $X | $X-HSA benefit | $X | $X |

HSA tax benefit (HDHP): ~$X/year assuming $X contribution at X% effective tax rate

### Recommendation
Medical: [Plan name] — reason
HSA election: $X/year ($X/paycheck biweekly) — or N/A
FSA election: $X/year — or N/A
Dental: [Plan name]
Vision: [Plan name]
Supplemental life: [Add $X / No change] — reason

### Enrollment Deadline
Complete elections by: [date]
Effective date: January 1, [year]
```

## Configuration

Required in `vault/benefits/config.md`:
- `federal_tax_bracket` — for HSA tax benefit calculation
- `state_tax_rate` — for HSA benefit calculation
- `coverage_tier` — employee / employee+spouse / employee+children / family
- `planned_medical_expenses` — known expenses for next year (elective procedures, etc.)
- `fica_applicable` — Y/N (FICA savings on HSA contributions apply to employees, not partners or self-employed)

## Error Handling

- **Plan documents not in vault:** Cannot compare plans without plan details. Prompt user to download SBCs (Summary of Benefits and Coverage) from HR portal and save to `vault/benefits/00_current/`.
- **No claims history available:** Use standard utilization estimates by age group and family size as proxies for OOP estimation. Note that estimates are less accurate without historical data.
- **Enrollment window missed:** Note that elections are locked for the plan year. Flag any coverage gaps to address via qualifying life event (marriage, birth, adoption, loss of other coverage) if applicable.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/benefits/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/benefits/00_current/`, `~/Documents/aireadylife/vault/benefits/config.md`, `~/Documents/aireadylife/vault/benefits/` (claims history)
- Writes to: `~/Documents/aireadylife/vault/benefits/02_briefs/enrollment-YYYY.md`, `~/Documents/aireadylife/vault/benefits/00_current/`, `~/Documents/aireadylife/vault/benefits/open-loops.md`
