---
name: aireadylife-records-op-subscription-review
type: op
cadence: monthly
description: >
  Monthly subscription review. Lists all active subscriptions with monthly cost, annual
  equivalent, last-used date, and usage flag. Identifies renewals within 30 days, unused
  services (no use in 60+ days), and duplicate categories. Calculates total recurring spend
  and potential annual savings from cancellations. Triggers: "subscription review",
  "recurring charges", "cancel subscriptions", "subscription audit", "what am I paying for".
---

# aireadylife-records-subscription-review

**Cadence:** Monthly (1st of month)
**Produces:** Subscription table with total recurring cost, usage flags, renewal alerts, and cancel recommendations

## What It Does

This op produces a complete, current picture of every recurring subscription charge — software, streaming, news, cloud storage, memberships, and services. Subscription creep is one of the most common sources of invisible household spending: the average US household has 12+ active subscriptions, and research consistently finds that people underestimate their monthly subscription spend by 2–3x. This op makes every subscription visible, with usage data to defend the ones worth keeping.

The op reads the subscription registry from the vault and calls the subscription summary flow to assemble the full table. It then applies a three-tier decision framework to each subscription:

**Keep:** The subscription is actively used (last used within 30 days) and is priced appropriately for the value delivered. No action required.

**Review:** The subscription hasn't been used in 31–60 days, or the price has increased since the last review, or a cheaper alternative exists. The user should consciously decide whether to keep or cancel. This tier is for subscriptions where the decision isn't obvious.

**Cancel:** The subscription hasn't been used in 60+ days, or it is a clear duplicate of another active subscription in the same category. The recommended action is to cancel before the next renewal date, with the cancellation link or process noted.

For annual subscriptions approaching renewal within 30 days, the op surfaces these first regardless of usage tier — the user needs to make the keep/cancel decision before being charged for another year. Missing a cancellation window on an annual subscription means paying for 12 months of a service you intended to cancel.

The op also identifies category duplicates: two cloud storage subscriptions (e.g., iCloud and Google One) where one could be eliminated, or two music streaming services, or two password managers. Duplicate detection prompts a consolidation decision. Consolidating one of two $10/month services saves $120/year.

The headline figure — total monthly subscription spend — is always shown prominently. Annual equivalent is shown alongside it, because $15.99/month feels small but $191.88/year is a more meaningful number when deciding whether a lightly-used service is worth keeping.

## Triggers

- "Subscription review"
- "What subscriptions do I have?"
- "What am I paying for every month?"
- "Cancel subscriptions audit"
- "Recurring charges review"
- "How much do I spend on subscriptions?"
- "What subscriptions should I cancel?"

## Steps

1. Read subscription registry from `~/Documents/aireadylife/vault/records/00_current/subscriptions.md`
2. Call `aireadylife-records-build-subscription-summary` to produce the full table
3. Apply keep/review/cancel tier to each subscription based on usage recency and price
4. Surface annual renewals within 30 days at the top of the output
5. Calculate total monthly spend, total annual spend, and potential savings from canceling all "cancel" tier subscriptions
6. Identify category duplicates; flag pairs
7. Write subscription review to `~/Documents/aireadylife/vault/records/00_current/YYYY-MM-subscription-review.md`
8. Call `aireadylife-records-update-open-loops` with any subscription flags (renewals approaching, unused services, large unused annual subscription)
9. Present full table sorted by monthly cost with headline totals and action items

## Input

- `~/Documents/aireadylife/vault/records/00_current/subscriptions.md`
- `~/Documents/aireadylife/vault/records/01_prior/` — prior period records for trend comparison

## Output Format

**Headline:** Total Monthly: $X | Total Annual: $X | Potential Annual Savings: $X

**Renewals Due Within 30 Days (action required):**
| Service | Renewal Date | Annual Charge | Usage | Decision |

**Full Subscription Table** (sorted by monthly cost):
| Service | Category | Monthly | Annual | Last Used | Tier | Action |

**Category Duplicates:**
| Category | Service A | Service B | Monthly Savings if Consolidated |

**Summary by Tier:**
- Keep: X services, $X/mo
- Review: X services, $X/mo
- Cancel: X services, $X/mo (total annual savings: $X)

## Configuration

Required in `~/Documents/aireadylife/vault/records/00_current/subscriptions.md`:
- Per subscription: `service_name`, `category`, `billing_amount`, `billing_cycle`, `renewal_date`, `last_used_date`, `essential`

## Error Handling

- If vault missing: direct to frudev.gumroad.com/l/aireadylife-records
- If subscription registry is empty: output setup guidance — explain how to add subscriptions to the vault
- If last-used dates are missing for all subscriptions: run usage-unknown mode — show costs and renewals without usage tier; prompt user to log usage dates

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/records/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/records/00_current/subscriptions.md`
- Writes to: `~/Documents/aireadylife/vault/records/00_current/YYYY-MM-subscription-review.md`
- Writes to: `~/Documents/aireadylife/vault/records/open-loops.md`
