---
name: aireadylife-insurance-task-update-open-loops
type: task
description: >
  Maintains vault/insurance/open-loops.md as the canonical list of outstanding insurance action items. Appends new flags from any insurance op (renewals, coverage gaps, active claims, missing policies). Resolves completed items with resolution notes. Archives resolved items to open-loops-archive.md. Called at the end of every insurance op.
---

## What It Does

The insurance open-loops file is the domain's single source of truth for what needs attention. All insurance ops write their flags here. The calendar agent reads this file for renewal action-by dates. The morning brief reads this file for insurance urgency items. If this file is cluttered with stale items, the signal-to-noise ratio drops and the user stops acting on it. This task keeps it clean, current, and reliably prioritized.

**Flag types managed:**
- `RENEWAL` — policy renewal within 60 days, with shop/auto-renew/coverage-review action
- `COVERAGE-GAP` — coverage amount shortfall identified in annual audit (life, disability, liability, property)
- `MISSING-POLICY` — policy type expected in baseline but not found in vault (no umbrella, no renters, etc.)
- `CLAIM-ACTION` — active claim requiring a specific action by a specific date (file, follow up, submit documents, respond to settlement)
- `CLAIM-STALLED` — claim open 30+ days with no status update — escalation needed
- `PREMIUM-INCREASE` — renewal premium > 10% higher than prior year — shopping recommended
- `COVERAGE-DATA-STALE` — policy record more than 12 months old — verify limits are current

**Priority ordering:** Claims with imminent deadlines (settlement response, appeal filing) are at the top — these have real deadlines with real consequences. Urgent renewals (action-by date within 14 days) are next. Active coverage gaps (significant) follow. Moderate and minor gaps, stale data, and informational items at the bottom.

**Resolution logic:** Scans existing flags against current vault state before appending new ones. Resolution conditions: RENEWAL resolves when renewal date passes (policy either renewed or note added that it was cancelled); COVERAGE-GAP resolves when policy record in vault shows the coverage has been updated to meet the threshold; CLAIM-ACTION resolves when the claim log shows the action was completed; MISSING-POLICY resolves when the policy type appears in vault. Resolved items are moved to `vault/insurance/open-loops-archive.md` with resolution date and method — maintaining audit history for the user to review.

**Calendar integration note:** RENEWAL flags with action-by dates are formatted so the calendar agent (if installed) can parse the date and create a calendar reminder. The action-by date field uses ISO 8601 format (YYYY-MM-DD) for machine readability.

## Steps

1. Receive new flags from calling op with type, severity, description, action, due date.
2. Read current `vault/insurance/open-loops.md`.
3. For each existing flag: check resolution conditions against current vault data.
4. Move resolved flags to `vault/insurance/open-loops-archive.md` with resolution timestamp.
5. Append new flags in correct urgency section.
6. Check for duplicate flag entries of same type and subject — update rather than duplicate.
7. Re-sort by priority: claim deadlines → urgent renewals → significant gaps → moderate gaps → coverage-review → minor gaps → stale data.
8. Write updated file to `vault/insurance/open-loops.md`.
9. Return summary: X new flags added, X resolved and archived, X updated.

## Input

- Flags from calling op
- `~/Documents/aireadylife/vault/insurance/open-loops.md` — current state
- `~/Documents/aireadylife/vault/insurance/` — vault data for resolution checks

## Output Format

`vault/insurance/open-loops.md` structure:

```
# Insurance Open Loops — Updated [YYYY-MM-DD]

## Urgent (action required)
- [CLAIM-ACTION] [Claim #] [Policy Type] — [action] — by [YYYY-MM-DD]
- [RENEWAL] [Policy Type] — [Carrier] — action by [YYYY-MM-DD] — [Shop/Review]

## High Priority
- [COVERAGE-GAP] Life Insurance — $X shortfall — Significant — [action]
- [MISSING-POLICY] Umbrella — missing with net worth $X — add $1M umbrella

## Watch
- [RENEWAL] [Policy Type] — [Carrier] — action by [YYYY-MM-DD] — [Shop]
- [COVERAGE-GAP] Home dwelling — moderate coinsurance risk — update before renewal

## Info
- [COVERAGE-DATA-STALE] [Policy] — record last updated [date] — confirm limits
- [CLAIM-ACTION] [Claim] — awaiting adjuster response — follow up if no contact by [date]

## Resolved (last 30 days)
- [flag] — Resolved [date] — [how resolved]
```

## Configuration

No configuration required. File auto-created on first run. Archive file at `vault/insurance/open-loops-archive.md` auto-created when first item is archived.

## Error Handling

- **open-loops.md does not exist:** Create with header structure on first write.
- **Resolution condition check fails (vault data inaccessible):** Leave item as open with note "verification needed."
- **Unknown flag type from calling op:** Log as MISC type with calling op name and full flag content.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/insurance/open-loops.md`, `~/Documents/aireadylife/vault/insurance/` (for resolution checks)
- Writes to: `~/Documents/aireadylife/vault/insurance/open-loops.md`, `~/Documents/aireadylife/vault/insurance/open-loops-archive.md`
