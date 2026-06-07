---
name: aireadylife-insurance-op-renewal-watch
type: op
cadence: monthly
description: >
  Monthly renewal watch scanning all policy renewal dates and flagging anything renewing within 60 days. Categorizes each renewal as shop (get competing quotes), auto-renew (no action needed), or coverage-review (limits need reassessment before renewal). Generates specific action steps and action-by dates 30 days before renewal. Triggers: "insurance renewals", "policy renewals", "renewal check", "insurance due", "upcoming renewals", "renewal dates".
---

## What It Does

Runs monthly to ensure no insurance policy auto-renews without your awareness and intentional decision. The most common and costly insurance mistake is allowing policies to auto-renew year after year without reviewing whether: (1) the terms and premium are still competitive, (2) the coverage limits are still appropriate for your current assets and income, or (3) a life event since the last renewal requires coverage changes. This op catches all of that 60 days before it becomes a crisis.

**60-day horizon:** The op scans all renewal dates and flags any policy renewing in the next 60 days. 60 days is the right window because it provides enough time to: get competing quotes (which take 1-5 business days each), review and compare offers, make a coverage decision, and process any carrier changes before the renewal date. Waiting until 2 weeks before renewal leaves insufficient time to switch carriers if a better option exists.

**Action categorization:** Each upcoming renewal is classified into one of three categories. The categorization determines what you should do, not just what is happening.

*Shop:* Get competing quotes before deciding to renew. Applied to: auto insurance (very competitive market, premium variation of 30-50% between carriers for identical coverage is common; most carriers give best rates to new customers), home/renters insurance (competitive, especially in areas where carriers have raised rates significantly after weather losses), any policy where the current year's renewal premium is more than 10% higher than the prior year. When categorized as "shop": the output includes the current coverage parameters to bring to quote comparison, a list of recommended carriers to approach, and the current premium as the baseline. Action-by date is 30 days before renewal.

*Auto-renew:* No competitive action needed; continue with current carrier and terms. Applied to: term life insurance (premium is locked at policy issue; the renewal is simply paying the same amount; the only "action" is confirming the payment goes through), group disability insurance through employer (no individual shopping needed), and policies where last competitive review was recent (within 18 months) and no coverage changes are needed.

*Coverage review:* Coverage parameters need reassessment before renewing — the policy may need to be changed, not just continued. Applied to: home insurance when property value has changed significantly (renovation, appreciation in a fast-moving market), life insurance after a salary change or new dependent, rental property insurance after renovation or a new tenant situation, auto insurance after adding or removing a driver or vehicle. When categorized as "coverage review": the output specifies which coverage parameter needs reassessment and why.

## Triggers

- "insurance renewals"
- "policy renewals"
- "renewal check"
- "what insurance is coming due"
- "insurance upcoming"
- "renewal dates"
- "any policies renewing soon"

## Steps

1. Read all active policies from `vault/insurance/00_current/` — extract policy type, carrier, renewal date, and current annual premium for each.
2. Calculate days_until_renewal for each policy as of today.
3. Filter to policies with days_until_renewal ≤ 60.
4. For each upcoming renewal: apply categorization rules (shop / auto-renew / coverage-review) based on policy type and signals.
5. Check for premium increase signal: read prior year premium from `vault/insurance/01_prior/` if available; flag if current year premium is >10% higher.
6. For "shop" categorized renewals: compile current coverage parameters (limits, deductible, endorsements) and generate competing quote action steps.
7. For "coverage-review" categorized renewals: identify the specific coverage parameter needing reassessment and the triggering life event or change.
8. Call `aireadylife-insurance-flow-check-renewal-dates` for the detailed renewal timeline analysis.
9. Call `aireadylife-insurance-task-flag-renewal-within-60-days` for each flagged renewal.
10. Write renewal watch summary to `vault/insurance/00_current/renewal-alerts.md`.
11. Call `aireadylife-insurance-task-update-open-loops` with all renewal flags.

## Input

- `~/Documents/aireadylife/vault/insurance/00_current/` — all active policy records with renewal dates
- `~/Documents/aireadylife/vault/insurance/01_prior/` — prior year premiums for change detection
- `~/Documents/aireadylife/vault/insurance/config.md` — life events and changes since last renewal

## Output Format

**Renewal Watch Summary** — saved as `vault/insurance/00_current/renewal-alerts.md`

```
## Renewal Watch — [Month Year]

Policies renewing within 60 days: X

### ACTION: Shop
[Policy Type] — [Carrier] — Renews [date] ([X days])
  Current annual premium: $X [+X% vs. prior year]
  Action: Get competing quotes by [action-by date]
  Coverage to bring to quotes: [specific parameters]
  Recommended carriers to quote: [list]

### ACTION: Coverage Review
[Policy Type] — [Carrier] — Renews [date] ([X days])
  Current annual premium: $X
  Review needed: [specific coverage parameter and why]
  Action: Run coverage audit for [policy line] before [action-by date]

### AUTO-RENEW (no action)
[Policy Type] — [Carrier] — Renews [date]
  Current premium: $X — no changes needed

### No Renewals in Next 60 Days
Next renewal: [Policy] on [date] ([X days])
```

## Configuration

Required in `vault/insurance/config.md`:
- All active policies listed with renewal dates, carrier, policy number, and current premium
- Life events since last renewal (salary change, new dependent, renovation, new vehicle, etc.)

## Error Handling

- **No renewal dates in vault:** Cannot run renewal watch. Prompt user to populate renewal dates in policy records in `vault/insurance/00_current/`.
- **Prior year premium unavailable:** Skip premium change calculation; note that year-over-year comparison is unavailable.
- **Policy type not in categorization rules:** Default to "shop" — getting a competing quote is never a bad outcome.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/01_prior/`, `~/Documents/aireadylife/vault/insurance/config.md`
- Writes to: `~/Documents/aireadylife/vault/insurance/00_current/renewal-alerts.md`, `~/Documents/aireadylife/vault/insurance/open-loops.md`
