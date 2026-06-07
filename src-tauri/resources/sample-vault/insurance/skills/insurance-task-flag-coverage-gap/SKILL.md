---
name: aireadylife-insurance-task-flag-coverage-gap
type: task
description: >
  Writes a structured coverage gap flag to vault/insurance/open-loops.md with coverage type, current limit, recommended limit, financial exposure of the gap (in dollars), severity rating (minor/moderate/significant), estimated annual premium to close, and specific recommended action. Called by coverage-audit for each identified gap.
---

## What It Does

Called by `aireadylife-insurance-op-coverage-audit` for each gap identified in the coverage analysis. The flag is not a vague alert — it provides the complete picture needed to take action: what the gap is, how large it is in dollar terms, what it would cost to close, and exactly what to do.

**Financial exposure framing:** Every flag quantifies the exposure in concrete terms, not percentages. "Your life insurance covers $500K but your need is $1.5M — the $1M gap means your family would be $1M short of income replacement if you die today." "Your net worth is $800K and your liability coverage is $500K — the $300K of unprotected net worth could be lost in a single at-fault accident lawsuit." This framing drives action better than percentages or abstract coverage ratios.

**Severity definition:**
- *Minor:* Coverage gap exists but exposure is manageable. Examples: life insurance coverage 5-15% below need, property coverage at 75-80% of replacement cost (near but below coinsurance threshold), auto liability within $50K of net worth. Recommended action: address at next renewal or convenient time.
- *Moderate:* Material exposure gap that warrants action within 1-3 months. Examples: life insurance 25-50% below need, LTD replacement rate 50-60%, net worth $100K-$500K above total liability coverage. Recommended action: get quotes and purchase within 90 days.
- *Significant:* Large exposure gap or missing policy type entirely that creates substantial financial risk. Examples: life insurance more than 50% below need, no umbrella with net worth > $300K, LTD replacement rate below 50%, property coverage creating coinsurance penalty risk. Recommended action: address within 30 days.

**Deduplication:** Before writing a new flag, scans `vault/insurance/open-loops.md` for an existing gap flag of the same coverage type. If found: updates the existing entry with current numbers rather than creating a duplicate. If the severity has changed (escalated or de-escalated since last audit), the update notes the change. This ensures the file stays clean across annual audits without accumulating stale duplicates.

**Cross-plugin note:** For life insurance and disability gaps that are directly linked to income: notes that the Career plugin should be checked if salary has changed recently, and the Benefits plugin should be checked for employer-provided life/disability coverage updates.

## Steps

1. Receive gap data from calling op: coverage_type, current_limit, recommended_limit, financial_exposure, severity, estimated_premium_to_close, recommended_action.
2. Check `vault/insurance/open-loops.md` for existing gap flag of same coverage type.
3. If existing flag found: update with current data; note severity change if applicable.
4. If no existing flag: compose new flag entry with all fields.
5. Write (or update) flag in `vault/insurance/open-loops.md` under appropriate urgency section.
6. Return confirmation to calling op.

## Input

- Gap data from calling op (all fields required: type, current, recommended, exposure, severity, premium, action)
- `~/Documents/aireadylife/vault/insurance/open-loops.md` — for deduplication

## Output Format

Entry in `vault/insurance/open-loops.md`:

```
## [COVERAGE GAP] [Coverage Type] — [Severity: Minor/Moderate/Significant] — Updated [YYYY-MM-DD]

Coverage type: [life / disability-ltd / disability-std / umbrella / auto-liability / home-dwelling / property / other]
Current coverage: $X [description of current limit]
Recommended coverage: $X [based on: 10-12x income / 60% replacement / net worth / replacement cost]
Shortfall: $X
Financial exposure: $X [plain language: "family would be $X short of income replacement" / "$X of net worth unprotected from lawsuit"]
Severity: [Minor / Moderate / Significant]

Recommended action:
[Specific action — who to contact, what to buy, what coverage parameters to specify]
Estimated annual premium to close gap: $X–$X/year

Timeline: [30 days / 90 days / At next renewal]
Cross-plugin note: [if any — e.g., "Confirm Benefits plugin has current employer LTD data before purchasing individual policy"]

Status: Open — First flagged [date] / Updated [date]
Next audit: [date of next annual audit]
```

## Configuration

No configuration required. Reads and writes `vault/insurance/open-loops.md` only.

## Error Handling

- **Gap is zero or positive (no gap):** Do not write a gap flag. Optionally write a brief "coverage adequate" confirmation to the audit report.
- **Financial exposure cannot be quantified:** Write the flag with a qualitative description of the exposure and note that precise quantification requires additional data.
- **Severity not provided by calling op:** Default to "moderate" and note that severity was not determined by the calling analysis.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/insurance/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/insurance/open-loops.md`
