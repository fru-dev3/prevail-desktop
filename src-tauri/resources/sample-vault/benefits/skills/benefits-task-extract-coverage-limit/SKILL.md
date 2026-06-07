---
name: aireadylife-benefits-task-extract-coverage-limit
type: task
description: >
  Reads a specific coverage limit value — deductible, OOP max, HSA IRS limit, life insurance face value, disability benefit amount, dental annual max — from vault/benefits/00_current/ plan documents. Returns the exact value, plan year, coverage tier, and source document to the calling flow or op.
---

## What It Does

A precision data retrieval task for the benefits domain. Benefits flows and ops frequently need a single specific limit value — the individual deductible for the current plan, the family OOP max, the life insurance face value, the LTD monthly cap — without re-reading the entire plan document. This task handles parameterized lookups so flows can retrieve exactly what they need without parsing complexity.

**Supported limit types:**
- `deductible-individual` — medical plan individual calendar year deductible
- `deductible-family` — medical plan family calendar year deductible
- `oop-max-individual` — medical plan individual annual out-of-pocket maximum
- `oop-max-family` — medical plan family annual out-of-pocket maximum
- `hsa-limit-self` — IRS annual HSA contribution limit, self-only (2025: $4,300)
- `hsa-limit-family` — IRS annual HSA contribution limit, family (2025: $8,550)
- `hsa-catchup` — HSA catch-up contribution for age 55+ (2025: $1,000)
- `life-face-value` — group life insurance face value (group + supplemental combined)
- `supplemental-life-amount` — supplemental life insurance face value only
- `disability-ltd-monthly-max` — long-term disability monthly benefit cap
- `disability-ltd-benefit-pct` — long-term disability benefit as percent of salary
- `disability-std-waiting-days` — short-term disability waiting period in days
- `dental-annual-max` — dental insurance annual maximum benefit
- `fsa-limit` — Health FSA annual contribution limit (IRS: $3,200 for 2025)
- `hsa-investment-threshold` — configured investment threshold from vault

**Priority lookup order:** First checks `vault/benefits/00_current/config.md` for a structured key-value index of limit values — this is the fastest lookup path. If not found in the index, reads the relevant plan document or SBC from `vault/benefits/00_current/` to extract the value. Returns the value along with the source (config index or specific document filename) and plan year so the caller can assess data freshness.

**IRS limits:** For HSA limit types, returns the current year's IRS limit from an internal lookup table (updated annually) rather than from plan documents, since these are set by IRS regulation, not the employer plan.

## Steps

1. Receive limit_type parameter from calling flow or op.
2. Check if limit_type is an IRS-regulated limit (hsa-limit-self, hsa-limit-family, hsa-catchup, fsa-limit) — if so, return from internal IRS limit table for current plan year.
3. Check `vault/benefits/00_current/config.md` for a key matching the requested limit_type. If found, return value with source = "config index".
4. If not in config index: identify which plan document contains the requested limit (e.g., SBC for medical limits, plan certificate for life/disability limits).
5. Read the identified document from `vault/benefits/00_current/` and locate the requested field.
6. Extract the value with plan year and coverage tier context.
7. Return structured response to caller.

## Input

- Limit type parameter (from list of supported types above)
- `~/Documents/aireadylife/vault/benefits/00_current/` — plan documents and optional config index

## Output Format

```
Limit type: [requested type]
Value: $X
Plan year: YYYY
Coverage tier: Individual / Family / N/A
Source: config index / [document filename]
Notes: [any relevant context — e.g., "this is the in-network deductible; out-of-network deductible is $X"]
```

## Configuration

Recommend maintaining a `vault/benefits/00_current/config.md` key-value index for frequently requested limits:
```yaml
deductible_individual: 1500
deductible_family: 3000
oop_max_individual: 5000
oop_max_family: 10000
life_group_face_value: 150000
life_supplemental_face_value: 200000
disability_ltd_monthly_max: 10000
disability_ltd_benefit_pct: 60
disability_std_waiting_days: 7
dental_annual_max: 1500
hsa_investment_threshold: 1000
```

## Error Handling

- **Limit type not recognized:** Return error with list of supported limit types.
- **Plan document not in vault:** Return error with filename that should be present and prompt to add it.
- **Value found but plan year is prior year:** Return value with warning that the plan document appears to be from a prior plan year and may not reflect current limits.
- **Multiple matching values found (e.g., in-network and out-of-network deductible):** Return the in-network value by default and note that an out-of-network value also exists.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/benefits/00_current/`
- Writes to: None (returns value to caller)
