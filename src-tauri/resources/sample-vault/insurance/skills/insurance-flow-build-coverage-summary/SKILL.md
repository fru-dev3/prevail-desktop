---
name: aireadylife-insurance-flow-build-coverage-summary
type: flow
trigger: called-by-op
description: >
  Compiles a full coverage matrix from all active insurance policies: carrier, policy type, coverage limits (per-occurrence and aggregate), deductible, annual premium, and renewal date. Checks the assembled coverage set against the expected minimum baseline and flags any missing policy types. Returns the matrix and missing-policy flags to the calling op.
---

## What It Does

Called by `aireadylife-insurance-op-review-brief` and `aireadylife-insurance-op-claims-review` to produce the core coverage inventory table. This flow is the data assembly layer — it reads all policy records and organizes them into a structured, comparable format. The calling ops use this table for brief writing, gap identification, and claims context.

**Policy inventory:** Reads all policy files from `vault/insurance/00_current/` and `vault/insurance/00_current/`. For each active policy, extracts: carrier name, policy type (auto, home/renters, life-term, life-group, LTD, STD, umbrella, landlord, dental, vision, health), policy number, coverage limits appropriate to the policy type (per-accident and property for auto, dwelling and personal property for home, face value for life, monthly benefit for disability, liability limit for umbrella), deductible (per-claim or per-occurrence as applicable), monthly and annual premium (employee-paid portion), and policy renewal date.

**Coverage matrix assembly:** Formats all policies into a side-by-side matrix table. Each row is a policy line; columns are the key comparison fields. This gives the calling op a clean table to embed in briefs or gap analysis reports without re-reading each policy file.

**Baseline coverage check:** After assembling the inventory, checks the coverage set against the expected minimum baseline for the user's life profile. The baseline is determined by the user's situation in `vault/insurance/config.md`: has dependents → life insurance should exist; renter (not owner) → renters insurance should exist (not homeowners); owner → homeowners should exist; net worth > $300K → umbrella should exist; owns vehicles → auto insurance should exist; owns rental properties → landlord policy should exist for each property. Any policy type in the expected baseline that has no corresponding active policy in the vault is flagged as a missing policy — distinct from a coverage amount gap (the policy exists but the limit is insufficient) vs. a missing policy (the policy type does not exist at all).

**Data freshness check:** Notes the date each policy record was last updated in the vault. Policy records more than 12 months old without a recent confirmation may have stale limits or premium data — flags these for refresh.

## Steps

1. Read all policy records from `vault/insurance/00_current/` (summary records) and `vault/insurance/00_current/` (detail documents).
2. For each policy: extract carrier, type, limits, deductible, annual premium, and renewal date.
3. Format into coverage matrix table with consistent column headers.
4. Determine expected coverage baseline from `vault/insurance/config.md` (dependents, homeowner/renter, vehicle count, net worth, rental properties).
5. Check each baseline policy type against the assembled matrix — flag types with no matching active policy.
6. Check data freshness: flag policy records with last_updated date more than 12 months ago.
7. Calculate total annual premium across all policies.
8. Return coverage matrix, missing-policy flags, freshness flags, and total premium to calling op.

## Input

- `~/Documents/aireadylife/vault/insurance/00_current/` — active policy summary records
- `~/Documents/aireadylife/vault/insurance/00_current/` — policy documents for limit details
- `~/Documents/aireadylife/vault/insurance/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/insurance/config.md` — user profile for baseline determination

## Output Format

Structured data returned to calling op:

```
Coverage Matrix:
| Policy Type | Carrier | Policy # | Key Limits | Deductible | Annual Premium | Renewal Date | Data Age |
|-------------|---------|---------|-----------|-----------|---------------|------------|---------|
| Auto | [carrier] | [#] | $100K/$300K/$100K | $500 collision | $X | [date] | X months |
| Home | [carrier] | [#] | $X dwelling / $X personal property / $X liability | $X | $X | [date] | X months |
| Life - Term | [carrier] | [#] | $X face value | N/A | $X | [date] | X months |
| LTD | [carrier] | [#] | $X/month max / 60% | N/A | Employer-paid | Employer | X months |
| Umbrella | [carrier] | [#] | $X coverage | $0 (excess) | $X | [date] | X months |

Total annual premium: $X

Missing Policy Flags:
- [policy type] — expected based on profile (dependents / net worth / property ownership) but not found in vault

Data Freshness Flags:
- [policy] — record last updated [date] (X months ago) — confirm limits are still current

Coverage Lines Found: X of X expected in baseline
```

## Configuration

Policy records in `vault/insurance/00_current/` should use consistent format:
```yaml
policy_type: auto / home / renters / life-term / life-group / ltd / std / umbrella / landlord
carrier: "[name]"
policy_number: "[#]"
renewal_date: "YYYY-MM-DD"
annual_premium: X
deductible: X
last_updated: "YYYY-MM-DD"
```

Detailed policy documents (declarations pages, full policies) stored in `vault/insurance/00_current/{type}/`.

## Error Handling

- **No policy records in vault:** Return empty matrix with full missing-policy flag list. Direct user to populate vault with policy information.
- **Policy type unrecognized:** Include in matrix with type as listed; do not exclude. Flag for user review.
- **Premium marked as employer-paid:** Note in matrix row; exclude from total premium sum (employer-paid premiums are not user expenditure).

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/insurance/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/config.md`
- Writes to: None (returns data to calling op)
