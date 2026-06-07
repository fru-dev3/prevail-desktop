---
name: aireadylife-records-flow-build-subscription-summary
type: flow
trigger: called-by-op
description: >
  Builds a complete subscription table: service name, billing cycle, monthly equivalent,
  annual equivalent, last-used date, usage flag (unused >2 months), annual renewal approaching
  within 30 days, and keep/cancel recommendation. Sorted by monthly cost descending.
---

# aireadylife-records-build-subscription-summary

**Trigger:** Called by `aireadylife-records-subscription-review`
**Produces:** Subscription summary table sorted by monthly cost with usage flags, renewal alerts, and keep/cancel recommendations

## What It Does

This flow reads the complete subscription registry from the vault and assembles a summary table that makes total recurring spend and usage patterns immediately visible. It answers the two most important subscription questions: what am I paying for, and am I actually using it?

The flow reads every active subscription from the vault — software-as-a-service, streaming services, news publications, cloud storage, gym memberships, professional associations, insurance premiums billed annually, and any other recurring charge. For each subscription, it normalizes the cost to a monthly equivalent (an annual plan billed at $120/year becomes $10/month) and an annual equivalent (a $12.99/month service costs $155.88/year). These normalized figures make cross-service comparison meaningful regardless of billing cycle.

Last-used date is the most important data field for the keep/cancel recommendation. If a subscription has a logged last-used date, the flow calculates how many days have elapsed. If no usage has been logged in more than 60 days (2 months), the subscription is flagged with a "low usage" indicator. Services flagged as low usage get a default recommendation of "cancel" unless the user has manually marked them as essential (e.g., insurance, professional license). Services actively used within 30 days are flagged as "active."

Annual renewal approaching: the flow checks each subscription's renewal date and flags any subscription renewing within the next 30 days. Subscriptions with annual billing cycles are the most important to catch before renewal — missing the cancellation window means paying for another full year. The flag includes the specific renewal date and estimated annual charge so the user can make a renewal vs. cancel decision with full information.

Duplicate detection: the flow checks for subscriptions in the same service category (e.g., two cloud storage services, two music streaming services) and flags any apparent duplicates as candidates for consolidation.

The output table is sorted by monthly cost descending — this prioritization ensures the most expensive unused subscriptions are at the top of the list and reviewed first. The total monthly and annual recurring spend across all active subscriptions is calculated as a headline figure.

## Steps

1. Read all active subscriptions from `~/Documents/aireadylife/vault/records/00_current/subscriptions.md`
2. For each subscription: calculate monthly equivalent and annual equivalent cost
3. Check last-used date; flag subscriptions with no use in >60 days as "low usage"
4. Check renewal date; flag any subscription renewing within 30 days
5. Check for duplicate services in the same category; flag pairs
6. Apply keep/cancel recommendation: low-usage + not-marked-essential = cancel; active-use = keep; annual-renewal-due = "decide before [date]"
7. Calculate total monthly spend and total annual spend across all active subscriptions
8. Calculate potential annual savings from canceling all low-usage subscriptions
9. Sort table by monthly cost descending
10. Return formatted table to calling op

## Input

- `~/Documents/aireadylife/vault/records/00_current/subscriptions.md` — active subscription registry
- `~/Documents/aireadylife/vault/records/01_prior/` — prior period records for trend comparison

## Output Format

**Headline:** Total Monthly Recurring: $X | Total Annual: $X | Potential Savings (cancel low-usage): $X/yr

**Subscription Table:**
| Service | Category | Billing | Monthly Equiv | Annual Equiv | Last Used | Usage | Renewal Date | Recommendation |
|---------|----------|---------|---------------|--------------|-----------|-------|--------------|----------------|
| Netflix | Streaming | $15.49/mo | $15.49 | $185.88 | 2024-10-01 | active | ongoing | keep |
| Adobe CC | Software | $54.99/mo | $54.99 | $659.88 | 2024-08-15 | low usage | ongoing | cancel |
| WSJ | News | $38.99/mo | $38.99 | $467.88 | 2024-06-01 | low usage | 2025-01-15 | cancel before Jan 15 |

**Renewal Alerts — Next 30 Days:**
| Service | Renewal Date | Annual Charge | Decision |

**Duplicate Services:**
| Category | Service 1 | Service 2 | Monthly Savings from Consolidating |

## Configuration

Required in `~/Documents/aireadylife/vault/records/00_current/subscriptions.md`:
- For each subscription: `service_name`, `category`, `billing_amount`, `billing_cycle`, `renewal_date`, `last_used_date`, `essential` (true/false)

## Error Handling

- If no subscriptions are logged: output "No subscriptions tracked — add subscriptions to vault/records/00_current/"
- If last-used date is missing for a subscription: flag as "usage unknown — no log"
- If renewal date is missing: note "no renewal date — may be month-to-month"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/records/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/records/00_current/subscriptions.md`
- Writes to: `~/Documents/aireadylife/vault/records/00_current/YYYY-MM-subscription-summary.md`
