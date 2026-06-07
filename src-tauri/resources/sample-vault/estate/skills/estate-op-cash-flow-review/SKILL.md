---
name: aireadylife-estate-op-cash-flow-review
type: op
cadence: monthly
description: >
  Monthly cash flow review run after rent collection. Computes gross rent, EGI, NOI, debt service,
  and net cash flow per property. Flags negative cash flow, expense ratio above 50%, DSCR below
  1.25, and QoQ decline greater than 15%. Triggers: "cash flow review", "rental income", "NOI",
  "property cash flow", "how much am I making on my rentals".
---

# aireadylife-estate-cash-flow-review

**Cadence:** Monthly (5th of month — after rent collection window closes)
**Produces:** Cash flow report with per-property income statement, portfolio totals, and flagged anomalies

## What It Does

This op produces the monthly financial report for the rental portfolio. It is the landlord's equivalent of a monthly P&L — every dollar of rent collected, every dollar of expense paid, and the resulting net cash flow per property and across the portfolio. Running it on the 5th of the month gives the 3–5 day late-payment window time to resolve before cash flow is recorded.

The op reads all income and expense data that has been logged in the vault during the month, then calls the cash flow analysis flow to compute the full income statement. For most rental properties, the cash flow stack looks like this in a healthy scenario: gross rent collectable (e.g., $2,400/month) minus vacancy loss (5–8% assumed if not tracked explicitly, or actual if logged) minus operating expenses (property taxes ~$167/mo, insurance ~$100/mo, management fee ~$240/mo, maintenance ~$208/mo reserve) = NOI (~$1,485). NOI minus debt service (P&I on mortgage, e.g., $1,200/mo) = net cash flow (~$285/mo before CapEx reserve).

The op flags four specific conditions that warrant attention. Negative net cash flow: the property is cash-flow negative after debt service — the landlord is subsidizing the property out of pocket. This is sustainable only if equity appreciation is the strategy; otherwise it needs investigation. Expense ratio above 50%: operating expenses are consuming more than half of gross rent — typical healthy range is 35–45% for a professionally managed property. DSCR below 1.25: annual NOI covers debt service with less than 25% cushion — lenders use 1.25 as the minimum for investment property loans; falling below this signals financial stress. QoQ cash flow decline above 15%: a significant and sudden drop in net cash flow may indicate unreported vacancy, a large unlogged expense, or a rent payment that wasn't collected.

The op also computes the recommended monthly reserves that should be held back from cash flow but are often excluded in simple calculations: maintenance reserve (1% of current property value ÷ 12 months) and CapEx reserve (amortized replacement cost of roof, HVAC, water heater based on age and replacement cost estimates). Including reserves gives the true economic cash flow — which is often lower than accounting cash flow.

## Triggers

- "Run cash flow review"
- "How much did I make on my rentals this month?"
- "What's my NOI?"
- "Cash flow update"
- "Property income review"
- "Rental income this month"
- "Did rent get paid?"

## Steps

1. Confirm vault and config.md are present; halt if missing
2. Check rent payment logs in `~/Documents/aireadylife/vault/estate/00_current/` — flag any unit with no payment record for the current month
3. Call `aireadylife-estate-analyze-cash-flow` to produce per-property income statement
4. Read prior month cash flow from `~/Documents/aireadylife/vault/estate/00_current/` for QoQ comparison
5. Flag: negative NCF, expense ratio >50%, DSCR <1.25, QoQ decline >15%
6. Calculate recommended maintenance and CapEx reserves per property
7. Show "economic cash flow" (accounting cash flow minus reserves) alongside standard NCF
8. Write monthly cash flow report to `~/Documents/aireadylife/vault/estate/00_current/YYYY-MM-cashflow.md`
9. Call `aireadylife-estate-update-open-loops` with any flagged conditions
10. Present results with per-property table, portfolio totals, and plain-language summary

## Input

- `~/Documents/aireadylife/vault/estate/config.md`
- `~/Documents/aireadylife/vault/estate/00_current/` — rent payment records
- `~/Documents/aireadylife/vault/estate/00_current/` — expense logs and prior month report
- `~/Documents/aireadylife/vault/estate/00_current/` — mortgage, insurance, tax data
- `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records for trend comparison

## Output Format

**Monthly Cash Flow Report — [Month Year]**

**Per-Property Income Statement:**
| Property | Gross Rent | Vacancy | EGI | Oper Exp | NOI | Debt Svc | NCF | Reserve | Economic CF | Flags |

**Portfolio Totals:**
| Total Gross Rent | Total NOI | Total NCF | Economic CF | Expense Ratio |

**Flagged Properties:**
[Property address] — [Flag type] — [Recommended action]

**Prior Month Comparison:**
| Property | This Month NCF | Prior Month NCF | Change% |

## Configuration

Required in `~/Documents/aireadylife/vault/estate/config.md`:
- Property list with mortgage P&I, annual insurance, annual property taxes
- `management_fee_pct`
- Property current values (for reserve calculation)

## Error Handling

- If vault missing: direct to frudev.gumroad.com/l/aireadylife-estate
- If no expenses logged for a property: run with $0 variable expenses; flag "No expenses logged this month — confirm accuracy"
- If prior month report missing: skip QoQ comparison; note first run for this property

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`, `01_tenants/`, `03_cashflow/`
- Writes to: `~/Documents/aireadylife/vault/estate/00_current/YYYY-MM-cashflow.md`
- Writes to: `~/Documents/aireadylife/vault/estate/open-loops.md`
