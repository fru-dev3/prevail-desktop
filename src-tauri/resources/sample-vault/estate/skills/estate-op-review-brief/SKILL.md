---
name: aireadylife-estate-op-review-brief
type: op
cadence: monthly
description: >
  Monthly portfolio review brief. Compiles net cash flow per property, open maintenance items,
  lease expirations within 90 days, property tax deadlines, insurance renewal dates, and equity
  positions into a single briefing document with action items sorted by urgency.
  Triggers: "estate brief", "estate review", "portfolio review", "rental property status".
---

# aireadylife-estate-review-brief

**Cadence:** Monthly (1st of month) or on-demand
**Produces:** Portfolio brief — cash flow, maintenance, tenant lease timeline, tax deadlines, equity summary

## What It Does

This op generates the monthly estate briefing document — a concise, decision-ready summary of the rental portfolio's current status across all dimensions. It is designed to give a landlord everything they need to know about their properties in a single read, with action items already surfaced and sorted by urgency.

The brief opens with a portfolio headline: total monthly cash flow across all properties (net after debt service), total equity across the portfolio, and a one-line comparison to the prior month. This is followed by a per-property cash flow section showing each property's gross rent, expense total, NOI, debt service, and net cash flow for the month — flagging any property with negative cash flow or a significant change from prior month.

The maintenance section consolidates all open maintenance items across all properties, sorted by urgency and age. Emergency items surface at the top; routine items are grouped by property and only shown if approaching or overdue. Seasonal tasks due within the next 30 days are listed separately so they can be scheduled before becoming overdue.

The tenant section shows every active lease with the tenant name (or unit identifier), monthly rent, lease expiration date, and number of days until expiration. Leases expiring within 90 days are flagged — this is the window when renewal outreach should begin. If the tenant has had any late payments in the past 3 months, this is noted. Leases expiring within 30 days without a signed renewal are flagged as high urgency (vacancy risk).

The deadlines section lists: upcoming property tax due dates (typically twice per year — May and October or per local schedule), insurance renewal dates, and any mortgage escrow review notices.

Action items are compiled from open-loops.md and sorted: critical (emergency maintenance, lease expiring in <30 days, property tax due within 14 days), high (urgent maintenance, lease expiring in 30–90 days, cash flow negative), medium (overdue routine maintenance, vendor follow-up needed), monitor (quarterly review due, market value update suggested).

## Triggers

- "Estate brief"
- "Give me my portfolio update"
- "Rental property status"
- "What's happening with my rentals?"
- "Monthly estate review"
- "Landlord update"

## Steps

1. Read current month cash flow report from `~/Documents/aireadylife/vault/estate/00_current/YYYY-MM-cashflow.md` (or run cash-flow-review if not yet generated)
2. Read all open maintenance items from `~/Documents/aireadylife/vault/estate/00_current/` and sort by urgency
3. Read tenant records from `~/Documents/aireadylife/vault/estate/00_current/` — calculate days to lease expiration and flag <90 days
4. Read payment history from tenant records; flag any tenant with late payment in past 3 months
5. Read property tax and insurance renewal dates from `~/Documents/aireadylife/vault/estate/00_current/`; flag due within 60 days
6. Read open-loops.md for existing unresolved flags; include in action items
7. Compile all sections into brief structure
8. Write brief to `~/Documents/aireadylife/vault/estate/02_briefs/YYYY-MM-estate-brief.md`
9. Call `aireadylife-estate-update-open-loops` with any new flags from the brief

## Input

- `~/Documents/aireadylife/vault/estate/00_current/YYYY-MM-cashflow.md`
- `~/Documents/aireadylife/vault/estate/00_current/`
- `~/Documents/aireadylife/vault/estate/00_current/`
- `~/Documents/aireadylife/vault/estate/00_current/`
- `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/estate/open-loops.md`

## Output Format

```
# Estate Brief — [Month Year]

## Portfolio Headline
Total Cash Flow: $X/mo | Total Equity: $X | vs. Last Month: +/-$X

## Cash Flow by Property
| Property | Gross Rent | Expenses | NOI | Debt Svc | NCF | Flag |

## Maintenance — Open Items
| Property | Item | Urgency | Due | Status |

## Maintenance — Seasonal Tasks (Next 30 Days)
| Property | Task | Due Month | Last Done |

## Tenant & Lease Status
| Property | Unit | Rent | Lease Expires | Days | Payment History | Flag |

## Upcoming Deadlines
| Property | Item | Due Date | Days |

## Action Items — Critical
## Action Items — High
## Action Items — Medium
## Watching
```

## Configuration

Required: vault populated, config.md complete, at least one monthly sync completed.

## Error Handling

- If vault missing: direct to frudev.gumroad.com/l/aireadylife-estate
- If monthly cash flow report not yet generated: offer to run cash-flow-review first
- If no tenant records: note "No tenant data — add leases to vault/estate/00_current/ to enable lease tracking"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`, `02_maintenance/`, `01_tenants/`, `00_properties/`, `open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/estate/02_briefs/YYYY-MM-estate-brief.md`
- Writes to: `~/Documents/aireadylife/vault/estate/open-loops.md`
