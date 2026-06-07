---
name: aireadylife-insurance-task-flag-renewal-within-60-days
type: task
description: >
  Writes a structured renewal alert to vault/insurance/open-loops.md with policy type, carrier, renewal date, current premium, prior year premium (if available for change detection), action category (shop/auto-renew/coverage-review), and specific action steps. Action-by date is set 30 days before renewal. Called by insurance-op-renewal-watch for each flagged renewal.
---

## What It Does

Called by `aireadylife-insurance-op-renewal-watch` for each policy renewal identified within 60 days. The renewal alert is structured to make action immediate and unambiguous — everything the user needs to act is in the flag, without looking up the policy or re-running an op.

**Action-by date logic:** The action-by date is always 30 days before the renewal date, not the renewal date itself. Insurance carriers typically require 30 days notice for mid-term cancellation; shopping, comparing quotes, and completing a carrier change realistically takes 1-2 weeks for most personal lines policies. An action-by date of 30 days before renewal builds in enough buffer for a smooth transition without rushing. For shop renewals, the flag also includes a quote request initiation date (45 days before renewal) as a softer prompt.

**Auto-renewal warning:** For policies categorized as "shop" or "coverage-review," the flag prominently notes that the policy WILL auto-renew on the renewal date if no action is taken. Most personal lines policies auto-renew at the new premium set by the carrier. Missing the action window means either paying a higher premium for another year or making a mid-term change later (which may involve cancellation fees or coverage gaps). This makes the cost of inaction explicit.

**Prior year premium comparison:** If prior year premium data is available in `vault/insurance/01_prior/`, includes the year-over-year premium change in the flag. A premium increase > 10% is highlighted because it is a market signal: the carrier may be exiting your area, re-pricing your risk class, or testing price sensitivity. In all of these cases, shopping is warranted regardless of the policy type.

**Quote parameters for shop renewals:** For shop-categorized renewals, the flag includes the exact coverage parameters to bring to quote comparison — not just "get quotes" but "get quotes for auto insurance with $300K/$500K/$100K liability limits, $500 collision deductible, $250 comprehensive deductible, for [year make model]." This specificity ensures quotes are apples-to-apples.

**Deduplication:** Checks for existing renewal alert for the same policy before writing. If existing flag found: updates the urgency and days-remaining but does not duplicate the entry.

## Steps

1. Receive renewal data from calling op: policy_type, carrier, policy_number, renewal_date, current_premium, prior_year_premium (if available), action_category (shop/auto-renew/coverage-review), coverage_parameters (if shop), coverage_review_details (if coverage-review).
2. Calculate days_until_renewal and action_by_date (renewal_date − 30 days).
3. Check `vault/insurance/open-loops.md` for existing renewal flag for this policy.
4. If existing flag found: update days_remaining and urgency; do not duplicate.
5. Determine urgency: > 30 days before action_by = watch; ≤ 30 days before action_by = urgent; ≤ 7 days before action_by = urgent + escalated auto-renewal warning.
6. Compose flag entry with all fields, action steps appropriate to category, and auto-renewal warning if shop/coverage-review.
7. Write (or update) flag in appropriate urgency section of `vault/insurance/open-loops.md`.
8. Return confirmation with urgency level and action-by date to calling op.

## Input

- Renewal data from calling op
- `~/Documents/aireadylife/vault/insurance/open-loops.md` — for deduplication check

## Output Format

Entry in `vault/insurance/open-loops.md`:

```
## [RENEWAL] [Policy Type] — [Carrier] — Renews [date] — [X days] — [Category]
[URGENT / WATCH]

Policy: [type] — [Carrier] — Policy #[number]
Renewal date: [date]
Current annual premium: $X [vs. prior year: $X — +/-X%]
Action category: Shop / Auto-Renew / Coverage Review
Action by: [date] (30 days before renewal)

[If Shop:]
  Auto-renewal will occur at $X if no action taken by [renewal date]
  To shop: request quotes with these parameters:
    [specific coverage parameters]
  Recommended carriers: [list for policy type]
  Quote initiation: by [45 days before renewal date]

[If Coverage Review:]
  Auto-renewal at current limits will occur if no review completed by [renewal date]
  Review needed: [specific coverage parameter and triggering change]
  Action: [specific steps to update coverage before renewal]

[If Auto-Renew:]
  No competitive action needed. Confirm payment method is current.
  Premium: $X/year (no change from prior year / $X change — within normal range)

Status: Open — Flagged [date]
```

## Configuration

No configuration required. All data passed by calling op. Reads/writes `vault/insurance/open-loops.md`.

## Error Handling

- **Renewal date unavailable:** Cannot write a time-sensitive renewal flag without a date. Return error; prompt user to add renewal date to policy record.
- **Prior year premium unavailable:** Omit year-over-year comparison; note that comparison is unavailable.
- **Action category unavailable:** Default to "shop" — getting a competing quote is never harmful.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/insurance/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/insurance/open-loops.md`
