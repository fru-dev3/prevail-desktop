---
name: aireadylife-estate-flow-analyze-cash-flow
type: flow
trigger: called-by-op
description: >
  Detailed cash flow analysis per rental property: gross rent, vacancy loss, all operating
  expenses, NOI, debt service, net cash flow, cash-on-cash return, and expense ratio.
  Flags properties with negative cash flow, expense ratio above 50%, or >15% QoQ decline.
---

# aireadylife-estate-analyze-cash-flow

**Trigger:** Called by `aireadylife-estate-cash-flow-review`, `aireadylife-estate-portfolio-review`
**Produces:** Per-property income statement and portfolio-level cash flow summary returned to the calling op

## What It Does

This flow produces the complete income statement for every rental property in the vault. It reads all income and expense data from the current period and calculates the full cash flow stack from gross rent down to net cash flow after debt service.

On the income side, the flow reads monthly rent collected per unit, late fees collected, and any ancillary income (laundry, parking, storage fee, pet fees). It compares collected rent against scheduled rent — any month where a unit collected less than scheduled rent is flagged as a shortfall, classified as either vacancy (unit was empty), late payment (payment received late), or partial payment (tenant paid less than full rent). These shortfalls reduce gross rent to effective gross income (EGI), with a vacancy rate calculated as the ratio of shortfall months to total scheduled months across all units.

On the expense side, the flow reads two tiers of expenses. Fixed expenses (same each month per property): mortgage principal and interest, property insurance premium (prorated monthly), property taxes (prorated monthly from annual bill), and HOA fees if applicable. Variable expenses (differ month to month): maintenance and repair costs logged via the estate-task-log-expense skill, property management fees (typically 8–12% of collected gross rent — use 10% as default if managed externally), landscaping, pest control, and any utilities paid by the landlord (common in multi-family).

From these inputs, the flow calculates: gross rent, effective gross income (EGI = gross rent minus vacancy loss), total operating expenses (all expenses except mortgage P&I), net operating income (NOI = EGI minus total operating expenses), annual debt service (12 months of P&I), debt service coverage ratio (DSCR = annual NOI ÷ annual debt service — lenders typically require ≥1.25 for investment properties), and net cash flow after debt service (NCF = NOI minus annual debt service ÷ 12 for monthly).

Key health metrics calculated: expense ratio (total operating expenses ÷ gross rent — above 50% indicates the property is consuming more than half its income in costs, warranting review); cash-on-cash return (annual NCF ÷ total cash invested, where total cash invested = down payment + closing costs + any initial capital improvements). Reserves are factored in as a recommended holdback even if not yet spent: maintenance reserve at 1% of property value per year (e.g., a $250,000 property reserves $2,500/year = $208/month), and CapEx reserve based on remaining useful life of major systems (roof 20-year life, HVAC 15-year, water heater 10-year — each prorated monthly).

## Steps

1. Read all property records from `~/Documents/aireadylife/vault/estate/00_current/` (address, purchase price, current value, mortgage P&I, insurance, taxes)
2. Read tenant records from `~/Documents/aireadylife/vault/estate/00_current/` (scheduled rent per unit, payment history)
3. Read expense records for the period from `~/Documents/aireadylife/vault/estate/00_current/{property-slug}-expenses.md`
4. For each property: calculate gross rent, shortfalls, EGI, and vacancy rate
5. Sum fixed and variable operating expenses per property; calculate expense ratio
6. Calculate NOI, DSCR, and net cash flow per property
7. Calculate cash-on-cash return using total cash invested from property record
8. Calculate recommended maintenance reserve (1% of current value ÷ 12) and CapEx reserve per property
9. Flag any property with: negative NCF, expense ratio >50%, DSCR <1.25, or NCF declined >15% QoQ
10. Calculate portfolio-level totals: total gross rent, total NOI, total NCF, blended expense ratio
11. Return complete analysis to calling op

## Input

- `~/Documents/aireadylife/vault/estate/00_current/` — property records (purchase price, current value, mortgage P&I, insurance premium, annual taxes, total cash invested)
- `~/Documents/aireadylife/vault/estate/00_current/` — scheduled rent and payment history per unit
- `~/Documents/aireadylife/vault/estate/00_current/{property-slug}-expenses.md` — logged variable expenses for the period
- `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records for trend comparison

## Output Format

**Per-Property Cash Flow Table:**
| Property | Gross Rent | Vacancy | EGI | Oper. Exp | NOI | Debt Svc | NCF | Cash-on-Cash | Expense Ratio | Flags |

**Portfolio Summary:**
| Metric | Value |
| Total Gross Rent | $X |
| Total NOI | $X |
| Total NCF | $X |
| Blended Expense Ratio | X% |
| Blended Cash-on-Cash | X% |

**Flagged Properties:** List with issue type and recommended action

## Configuration

Required in `~/Documents/aireadylife/vault/estate/config.md`:
- `properties` list with address, purchase price, current value, mortgage P&I, insurance premium, annual taxes, total cash invested
- `management_fee_pct` (default 10% if external PM; 0% if self-managed)

## Error Handling

- If a property has no expense records for the period: use $0 variable expenses; flag "No expenses logged — verify completeness"
- If scheduled rent is missing for a unit: use prior month's rent and note assumption
- If total cash invested is not set for a property: omit cash-on-cash return for that property; note missing field

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Writes to: `~/Documents/aireadylife/vault/estate/00_current/YYYY-MM-cashflow.md`
