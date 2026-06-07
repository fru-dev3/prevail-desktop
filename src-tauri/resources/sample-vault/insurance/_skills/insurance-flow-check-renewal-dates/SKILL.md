---
name: aireadylife-insurance-flow-check-renewal-dates
type: flow
trigger: called-by-op
description: >
  Reads all policy renewal dates, calculates days until renewal, filters to policies renewing within 60 days, and categorizes each as shop/auto-renew/coverage-review. For shop renewals: generates specific quote comparison parameters and carrier list. For coverage-review renewals: identifies the specific limit or coverage type needing reassessment. Returns categorized renewal timeline to calling op.
---

## What It Does

Called by `aireadylife-insurance-op-renewal-watch` to perform the renewal date scan and action categorization. This flow handles the data layer — reading dates, categorizing renewals, and generating specific action steps — while the op handles brief writing and open loop flagging.

**Renewal scan:** Reads all active policy records from `vault/insurance/00_current/` and calculates days_until_renewal for each as of today. Policies renewing within 60 days are included in the output. Policies renewing in 31-60 days are "upcoming" (time to shop or review). Policies renewing in ≤30 days are "urgent" (action must happen now — typically shopping takes 1-2 weeks).

**Categorization rules:**

*Shop:* Policy types where competitive quoting is worthwhile and recommended: auto insurance (shop annually — significant premium variation between carriers), home and renters insurance (shop every 1-2 years or when premium increases > 10%), landlord property insurance (competitive market). Also triggered when: current year premium is > 10% higher than prior year for any policy type (insurer is signaling risk repricing or testing price sensitivity), or the current carrier received a significant premium increase. When shop is assigned: the flow generates the specific coverage parameters to bring to quotes (exact limits, deductibles, endorsements), a recommended carrier list for the policy type, and notes the current premium as the comparison baseline.

*Auto-renew:* No action needed beyond confirming the payment will go through. Applied to: term life insurance (locked premium; the renewal is administrative), employer disability coverage (not individually shopped), pet insurance (limited competitive alternatives for existing conditions). When auto-renew is assigned: note the renewal date and premium so the user can confirm payment.

*Coverage review:* The coverage parameters need to be assessed before renewal because something in the user's life has changed that affects what limits are appropriate. Applied to: home insurance when a major renovation has occurred since the last renewal (replacement cost has increased), life insurance after a salary change or new dependent (coverage need has changed), rental property insurance after property purchase or major renovation, auto insurance after adding a driver (teen driver, spouse) or new vehicle. When coverage review is assigned: the flow identifies the specific change that triggered the review and the specific coverage parameter that needs updating.

**Prior year premium comparison:** Reads the prior year premium from `vault/insurance/01_prior/` if available. If current year renewal premium is > 10% higher: adds shop categorization regardless of policy type (the insurer may be exiting your area or re-pricing your risk class — this is a signal to shop).

## Steps

1. Read all active policy records from `vault/insurance/00_current/`.
2. Calculate days_until_renewal for each policy.
3. Filter to policies with days_until_renewal ≤ 60.
4. For each upcoming renewal: check prior year premium from `vault/insurance/01_prior/`.
5. Apply primary categorization rule based on policy type.
6. Apply override to "shop" if current premium is > 10% higher than prior year.
7. Apply override to "coverage-review" based on life events in `vault/insurance/config.md` that have occurred since the last renewal.
8. For each "shop" renewal: compile current coverage parameters; generate carrier recommendation list for that policy type.
9. For each "coverage-review" renewal: identify specific changed parameter and triggering event.
10. Sort all upcoming renewals by days_until_renewal (most urgent first).
11. Return categorized renewal timeline with action parameters to calling op.

## Input

- `~/Documents/aireadylife/vault/insurance/00_current/` — active policy records with renewal dates and current premiums
- `~/Documents/aireadylife/vault/insurance/01_prior/` — prior year premium data
- `~/Documents/aireadylife/vault/insurance/config.md` — recent life events for coverage-review trigger

## Output Format

Structured categorized renewal timeline returned to calling op:

```
Upcoming Renewals (within 60 days):

[URGENT — X days] Auto Insurance — [Carrier] — Renews [date]
  Category: Shop
  Current premium: $X/year (prior year: $X — +X% change)
  Coverage parameters for quotes:
    - Liability: $X/$X/$X (BI per person / per accident / property)
    - Collision deductible: $X
    - Comprehensive deductible: $X
    - Vehicles: [year make model]
  Recommended carriers to quote: Progressive, State Farm, GEICO, Nationwide
  Action by: [30 days before renewal date]

[UPCOMING — X days] Home Insurance — [Carrier] — Renews [date]
  Category: Coverage Review
  Current premium: $X/year
  Review trigger: [Renovation completed YYYY-MM increased replacement cost; dwelling coverage may be insufficient]
  Specific parameter to update: Dwelling coverage limit — current: $X, estimated needed: $X
  Action by: [30 days before renewal date]

[UPCOMING — X days] Life Insurance — [Carrier] — Renews [date]
  Category: Auto-Renew
  Current premium: $X/year
  Note: Term locked at original issue premium — no action needed beyond confirming payment

No renewals in days 61+: Next upcoming after this window is [Policy] on [date]
```

## Configuration

Policy records in `vault/insurance/00_current/` require `renewal_date` and `annual_premium` fields for renewal watch. Prior year premiums stored in `vault/insurance/01_prior/prior-year-premiums.md` with format: `{policy_type}: {prior_year_premium}`.

Life events stored in `vault/insurance/config.md` under `recent_life_events` list with event type and date for coverage-review trigger logic.

## Error Handling

- **No policies with renewal dates:** Return empty renewal list. Flag that renewal dates must be added to policy records in `vault/insurance/00_current/` to enable renewal watch.
- **Prior year premium unavailable:** Skip the > 10% change check; note comparison unavailable for that policy.
- **Renewal date already passed:** Exclude from the upcoming list; note as "renewal date in past — confirm policy was renewed or obtain new policy."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/01_prior/`, `~/Documents/aireadylife/vault/insurance/config.md`
- Writes to: None (returns data to calling op)
