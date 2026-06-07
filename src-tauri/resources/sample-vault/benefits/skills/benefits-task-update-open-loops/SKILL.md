---
name: aireadylife-benefits-task-update-open-loops
type: task
description: >
  Maintains vault/benefits/open-loops.md as the canonical list of outstanding benefits action items. Appends new flags from any benefits op (enrollment deadlines, 401k match gaps, HSA investment threshold actions, coverage gaps, FSA deadlines, ESPP/RSU calendar events). Resolves completed items. Prioritizes by severity. Called at the end of every benefits op.
---

## What It Does

The benefits open-loops file is the single source of truth for what needs your attention in the benefits domain. Every benefits op writes its flags here. The morning brief system reads this file. Without active maintenance, it fills with resolved items that clutter the view and cause the user to stop trusting it. This task keeps it current, clean, and prioritized.

**Flag types this task manages:**

- `ENROLLMENT` — open enrollment deadline with checklist (urgency escalates as deadline approaches)
- `401K-MATCH-GAP` — employee contribution rate below match threshold, forfeiting free money
- `401K-LIMIT-PACE` — contribution pace insufficient to reach IRS limit by year-end
- `401K-REBALANCE` — fund allocation drift > 5 percentage points in any fund
- `HSA-CONTRIBUTION` — HSA contribution pace below IRS limit trajectory
- `HSA-INVESTMENT` — cash balance above investment threshold, idle funds should be moved to investment sleeve
- `HSA-REIMBURSEMENTS` — pending qualified expenses with saved receipts, not yet submitted for reimbursement
- `COVERAGE-GAP` — life insurance below 10x income, disability below 60% replacement, or other coverage adequacy issue
- `COVERAGE-ADMIN` — administrative discrepancy between elected benefit and payroll deduction
- `FSA-DEADLINE` — FSA use-by deadline approaching (typically March 15 or December 31)
- `ESPP-WINDOW` — ESPP purchase date approaching within 30 days
- `RSU-VEST` — RSU vest date approaching; withholding adequacy check may be needed
- `BENEFICIARY` — annual reminder to confirm beneficiary designations are current

**Priority ordering:** Urgent items (enrollment deadline ≤14 days, COBRA election window) at the very top. High-priority items (match gap — real money being forfeited, active coverage administrative discrepancy) next. Watch items (contribution pace, investment threshold, pending reimbursements) in the middle. Informational items (upcoming RSU vest, beneficiary reminder, ESPP window) at the bottom.

**Resolution logic:** Checks vault data to resolve flags automatically where possible. A 401K-MATCH-GAP resolves when contribution rate meets or exceeds match threshold (confirmed from ADP/Workday statement). An HSA-INVESTMENT flag resolves when the cash balance drops back to or below the investment threshold. An ENROLLMENT flag resolves after the enrollment window end date passes (regardless of whether the user acted — the window has closed). An HSA-REIMBURSEMENTS flag updates monthly with the current count and total; it resolves when the pending reimbursements file is empty.

**Cross-domain notes:** Flags that generate events for other plugins (RSU-VEST → Tax and Wealth plugins, ESPP-WINDOW → Tax plugin) include a routing note indicating which domain should also be informed.

## Steps

1. Receive new flags from calling op — type, severity, description, action, due date, and any dollar amounts.
2. Read current `vault/benefits/open-loops.md`.
3. Check each existing flag against current vault state for resolution. Resolve where conditions are met.
4. Move resolved items to `[Resolved]` section with resolution date.
5. Append new flags in correct section based on type and severity.
6. Check for duplicates — update existing flags of same type rather than duplicating.
7. Re-sort file: urgent → high priority → watch → info.
8. Write updated file to `vault/benefits/open-loops.md`.
9. Return summary: X new flags added, X resolved, X updated.

## Input

- Flags from calling op
- `~/Documents/aireadylife/vault/benefits/open-loops.md` — current state
- `~/Documents/aireadylife/vault/benefits/config.md` — for resolution condition checks

## Output Format

`vault/benefits/open-loops.md` structure:

```
# Benefits Open Loops — Updated [YYYY-MM-DD]

## Urgent
- [ENROLLMENT] Closes [date] — X days remaining — run enrollment review op
- [COVERAGE-ADMIN] Medical deduction missing from paycheck — contact HR

## High Priority
- [401K-MATCH-GAP] Contributing X% — need X% for full match — forfeiting $X/paycheck ($X/year)
- [COVERAGE-GAP] Life insurance: $X vs. $X needed — add $X supplemental term life

## Watch
- [HSA-INVESTMENT] Cash $X above $X threshold — transfer $X to investment sleeve
- [401K-LIMIT-PACE] On pace for $X vs. $23,500 limit — increase contribution by $X/month
- [HSA-REIMBURSEMENTS] $X pending across X expenses — submit when ready

## Info
- [RSU-VEST] Next vest: X shares on [date] — route to Tax plugin for withholding check
- [ESPP-WINDOW] Purchase window closes [date] — ensure participation is active
- [BENEFICIARY] Annual review: confirm 401k and life insurance beneficiaries are current

## Resolved (last 30 days)
- [flag] — Resolved [date] — [how]
```

## Configuration

No configuration required. File auto-created on first run if it does not exist at `vault/benefits/open-loops.md`.

## Error Handling

- **open-loops.md does not exist:** Create with standard structure header on first write.
- **Flag type not in recognized list:** Log with type "MISC" and note unknown flag type from calling op.
- **Resolution check inconclusive:** Leave flag as open with a note that verification is needed.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/benefits/open-loops.md`, `~/Documents/aireadylife/vault/benefits/config.md`
- Writes to: `~/Documents/aireadylife/vault/benefits/open-loops.md`
