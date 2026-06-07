---
name: aireadylife-estate-op-tenant-review
type: op
cadence: monthly
description: >
  Monthly tenant review: lease expiration countdown, rent payment history, security deposit
  tracking, vacancy planning, and renewal decision workflow. Flags leases expiring within 90
  days for renewal outreach. Triggers: "tenant review", "lease review", "rent status", "tenant update".
---

# aireadylife-estate-tenant-review

**Cadence:** Monthly (1st of month)
**Produces:** Tenant status report in `~/Documents/aireadylife/vault/estate/00_current/` with lease timelines, payment history, security deposit summary, and renewal/vacancy flags

## What It Does

This op reviews every active tenancy across the portfolio and evaluates it across four dimensions: lease timeline, rent payment behavior, security deposit status, and renewal or vacancy planning. Running this monthly keeps the landlord ahead of the most common and costly rental property problem: unexpected vacancy.

**Lease timeline review:** For each active lease, the op calculates the number of days until the lease expiration date and applies a three-tier alert system. 91–180 days: informational — note lease approaching. 31–90 days: flag for renewal outreach. Renewal outreach should include a decision on whether to renew the current tenant (and at what rent — a rent increase at renewal is standard and expected) or allow the lease to expire and prepare for a vacancy. 0–30 days: high urgency — if no renewal is signed and no move-out notice received, the tenancy may convert to month-to-month (legal in most states, but risky — tenant can leave with 30 days notice at any time). Vacancy prep includes scheduling a move-out inspection, lining up turn vendors (cleaning, paint), and listing the unit.

**Rent payment history review:** The op reads logged payment records for the past 3 months per unit and checks for patterns. On-time defined as received by the 5th of the month (standard grace period). Late (6th–10th of month): flag as single late event. Chronic late (2+ late payments in 3 months): flag as pattern — this tenant is a collection risk at renewal. Missed payment: flag immediately and recommend sending a formal late rent notice (typically required before initiating legal remedies). Note: state-specific laws govern late fees and eviction notice timelines — Texas requires 3-day notice to vacate, Minnesota requires 14 days for non-payment. The op notes the state and reminds the landlord to verify local requirements.

**Security deposit tracking:** Each unit's security deposit amount is compared against the lease agreement. Some states cap security deposits (e.g., California: 2× monthly rent for unfurnished; Minnesota: no statutory cap). The op checks that the held deposit matches the lease agreement and flags any discrepancy. It also checks whether the deposit is held in a separate escrow account (required in several states including Massachusetts, New York) or co-mingled with operating funds.

**Renewal and rent increase analysis:** For leases expiring within 90 days, the op pulls the current rent, checks it against the current local rental market median (from the vault's real-estate module if connected), and calculates a recommended renewal rent. In most markets, annual rent increases of 3–5% are standard and expected. In strong rental markets, increases of 5–10% at renewal are common. Some jurisdictions have rent control ordinances capping annual increases — the op notes these if the jurisdiction is recorded in config.md.

## Triggers

- "Review my tenants"
- "Lease status update"
- "Rent payment review"
- "Any leases expiring soon?"
- "Tenant update across all properties"
- "Security deposit check"
- "Should I raise rents?"

## Steps

1. Read all tenant records from `~/Documents/aireadylife/vault/estate/00_current/`
2. Calculate days to lease expiration for each active lease; apply 3-tier alert (91–180/31–90/0–30 days)
3. Read payment records for past 3 months per unit; identify on-time, late, chronic-late, or missed
4. Verify security deposit amount matches lease agreement; flag discrepancies
5. Call `aireadylife-estate-build-portfolio-summary` to get current rent-to-market comparison
6. For leases expiring within 90 days: calculate recommended renewal rent and rent increase %
7. For vacant units: calculate days vacant; flag if >30 days without signed lease
8. Flag any units requiring move-out inspection scheduling (lease ending within 30 days)
9. Write tenant status report to `~/Documents/aireadylife/vault/estate/00_current/YYYY-MM-tenant-report.md`
10. Call `aireadylife-estate-update-open-loops` with all tenant flags

## Input

- `~/Documents/aireadylife/vault/estate/00_current/` — all tenant records, lease dates, payment history, security deposit amounts
- `~/Documents/aireadylife/vault/estate/00_current/` — property state/jurisdiction for rent control check
- `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records for trend comparison

## Output Format

**Tenant Review — [Month Year]**

| Property | Unit | Tenant | Rent | Lease Expires | Days | Payment 3mo | Deposit | Renewal Flag |

**Leases Expiring <90 Days (Detailed):**
Per unit: current rent, recommended renewal rent, market median, % increase suggested, renewal outreach status

**Payment Concerns:**
| Unit | Issue | Months Late | Recommended Action |

**Security Deposit Issues:**
| Unit | Lease Amount | Held Amount | Issue |

**Vacant Units:**
| Unit | Days Vacant | Listing Status | Est. Turn Cost |

**Action Items:** Sorted by urgency

## Configuration

Required in `~/Documents/aireadylife/vault/estate/config.md`:
- Per property/unit: lease start date, lease end date, monthly rent, security deposit amount, tenant name, payment records
- `state` for each property (used for late notice and deposit law reference)

## Error Handling

- If no tenant records in vault: note "Add lease data to vault/estate/00_current/ to enable tenant review"
- If payment history not logged: note "No payment records found — log payments monthly using estate-task-log-expense to enable payment trend analysis"
- If vault missing: direct to frudev.gumroad.com/l/aireadylife-estate

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Writes to: `~/Documents/aireadylife/vault/estate/00_current/YYYY-MM-tenant-report.md`
- Writes to: `~/Documents/aireadylife/vault/estate/open-loops.md`
