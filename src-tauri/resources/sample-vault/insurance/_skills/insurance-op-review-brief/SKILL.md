---
name: aireadylife-insurance-op-review-brief
type: op
cadence: monthly
description: >
  Monthly insurance brief compiling all active policy premiums and renewal dates, policies renewing within 60 days with recommended action, active claims status, total annual premium spend, and top coverage gaps from the most recent audit. Formatted as a concise brief with action items sorted by urgency. Triggers: "insurance brief", "insurance review", "policy review", "coverage check", "insurance status", "insurance update".
---

## What It Does

Generates the monthly insurance brief — the one document that gives you a complete, current view of your entire insurance portfolio in under 5 minutes. Insurance is a domain where the critical information (renewals approaching, claims pending, coverage gaps) is scattered across multiple policy documents and accounts. The monthly brief consolidates everything into a single, prioritized view.

The brief has five sections. Active policies: a matrix of all current policies with carrier, coverage type, annual premium, and next renewal date — giving a complete portfolio view at a glance. Renewal watch: policies renewing within 60 days pulled from the most recent renewal watch output, with their assigned action category (shop/auto-renew/review) and action-by dates. Active claims: if any claims are in progress, their current stage and immediate next action. Coverage gaps: the top gaps from the most recent annual audit (or from open-loops.md if the audit has run recently), with severity ratings. Total premium spend: annual and monthly aggregate premium across all policies — useful for calibrating the overall insurance cost and identifying when premium creep warrants a portfolio review.

**Action items first:** Every section that has an outstanding action surfaces it at the top of the brief under "Requires Action," sorted by urgency. A renewal due in 14 days is more urgent than a coverage gap that has been in open loops for 6 months. A claim settlement deadline is more urgent than an annual premium total. The user should be able to read the "Requires Action" section and know exactly what to do today.

## Triggers

- "insurance brief"
- "insurance review"
- "policy review"
- "coverage check"
- "insurance status"
- "insurance update"
- "monthly insurance"
- "what insurance do I have"

## Steps

1. Check `vault/insurance/00_current/renewal-alerts.md` for most recent renewal watch output — note date of last run.
2. Read all active policies from `vault/insurance/00_current/` — extract carrier, policy type, annual premium, renewal date.
3. Check `vault/insurance/00_current/` for any open claims — extract stage and next action.
4. Read `vault/insurance/open-loops.md` — extract all open items by severity.
5. Check most recent coverage audit date from `vault/insurance/00_current/` — note if audit is more than 12 months old (flag for re-audit).
6. Sum all annual premiums for total annual and monthly premium spend.
7. Identify all policies renewing within 60 days from policy records.
8. Extract top 3 open coverage gaps from open-loops.md.
9. Synthesize all data into brief with "Requires Action" section first.
10. Write monthly brief to `vault/insurance/02_briefs/YYYY-MM-insurance-brief.md`.
11. Call `aireadylife-insurance-task-update-open-loops` if any new flags surfaced during synthesis.

## Input

- `~/Documents/aireadylife/vault/insurance/00_current/` — active policy records and renewal alerts
- `~/Documents/aireadylife/vault/insurance/00_current/` — active claims
- `~/Documents/aireadylife/vault/insurance/00_current/` — most recent coverage audit
- `~/Documents/aireadylife/vault/insurance/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/insurance/open-loops.md` — all outstanding flags

## Output Format

**Monthly Insurance Brief** — saved as `vault/insurance/02_briefs/YYYY-MM-insurance-brief.md`

```
# Insurance Brief — [Month Year]

## Requires Action
- [policy/claim/gap] — [action] — by [date]

## Active Policies
| Type | Carrier | Annual Premium | Next Renewal | Status |
|------|---------|---------------|-------------|--------|
| Auto | [Carrier] | $X | [date] | OK / Renewing in Xd |
| Home | [Carrier] | $X | [date] | SHOP in Xd |
| Life Term | [Carrier] | $X | [date] | Auto-renew |
| LTD | [Carrier] | $X | Employer | Employer-provided |
| Umbrella | [Carrier] | $X | [date] | OK |

Total annual premiums: $X ($X/month)

## Renewals in Next 60 Days
[Policy] — [date] — [Shop / Auto-renew / Review] — Action by [date]

## Active Claims
[Claim] — Stage: [stage] — Next action: [action] — By [date]
No active claims / X claim(s) in progress

## Coverage Gaps (from [date] audit)
1. [Gap description] — Severity: [Minor/Moderate/Significant] — Est. cost to close: $X/year
2. ...

## Coverage Audit
Last audit: [date] — [Current / Due for renewal (12+ months since last audit)]
```

## Configuration

No additional configuration beyond standard `vault/insurance/config.md`. Brief references sub-domain op outputs; if renewal watch or coverage audit have not run recently, brief notes data freshness.

## Error Handling

- **No policy records in vault:** Cannot produce meaningful brief. Prompt user to complete vault setup.
- **Renewal watch not run recently:** Note that renewal dates are from policy records directly; run renewal watch for categorized action recommendations.
- **Coverage audit more than 12 months old or never run:** Flag as overdue in brief. Recommend running annual coverage audit.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/insurance/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/insurance/02_briefs/YYYY-MM-insurance-brief.md`, `~/Documents/aireadylife/vault/insurance/open-loops.md`
