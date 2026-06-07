---
name: aireadylife-estate-flow-build-portfolio-summary
type: flow
trigger: called-by-op
description: >
  Generates a complete portfolio snapshot: all properties with address, purchase price,
  current value, equity, outstanding mortgage balance, monthly cash flow, cap rate, and
  cash-on-cash return. Includes portfolio-level totals and YoY performance comparison.
---

# aireadylife-estate-build-portfolio-summary

**Trigger:** Called by `aireadylife-estate-portfolio-review`, `aireadylife-estate-tenant-review`
**Produces:** Structured portfolio snapshot with per-property financials and portfolio-level summary returned to the calling op

## What It Does

This flow assembles the most comprehensive single-view of the user's rental portfolio — every property, every key financial metric, and the aggregate picture. It is the foundation of the quarterly portfolio review and is also called by the tenant review op to provide the financial context needed to evaluate hold vs. sell decisions alongside lease renewal timing.

For each property in the vault, the flow extracts: address, purchase date, purchase price, current estimated market value (from the most recent appraisal or Zillow/Redfin estimate logged in the vault), outstanding mortgage balance (calculated from the amortization schedule using purchase date, original loan balance, rate, and term — or read directly from the property record if manually updated), and current tenant occupancy status and rent.

The financial metrics calculated per property are:

**Equity:** current market value minus outstanding mortgage balance. For example, a property purchased for $200,000 with a $160,000 original loan, now worth $260,000 with $145,000 remaining on the mortgage, has equity of $115,000.

**Cap rate (capitalization rate):** annual net operating income (NOI) divided by current market value, expressed as a percentage. NOI = gross rent × 12 × (1 − vacancy rate) − annual operating expenses (taxes, insurance, maintenance, management fees — does not include mortgage debt service). A cap rate of 6% on a $250,000 property implies NOI of $15,000. Industry benchmark: 5–8% is typical for single-family residential rentals in most US markets; below 4% suggests the property is overpriced relative to its income, or expenses are too high.

**Cash-on-cash return:** annual pre-tax net cash flow (after debt service) divided by total cash invested (down payment + closing costs + initial capital improvements). A property with $6,000 annual cash flow and $50,000 total cash invested has a 12% cash-on-cash return. This is the truest measure of actual return on capital deployed — unlike cap rate, it accounts for the cost of debt.

**Depreciation value:** residential rental properties are depreciated over 27.5 years for tax purposes. Annual depreciation = (purchase price minus land value) ÷ 27.5. This is a non-cash expense that reduces taxable income — a major benefit of rental ownership tracked here for reference when coordinating with the Tax Agent for Schedule E.

The portfolio-level summary aggregates across all properties: total portfolio equity, total monthly cash flow, total annual NOI, blended cap rate (total NOI ÷ total current value), total units, total monthly gross rent, and year-over-year change in total equity.

## Steps

1. Read all property records from `~/Documents/aireadylife/vault/estate/00_current/`
2. Read tenant records from `~/Documents/aireadylife/vault/estate/00_current/` for current rent and occupancy per property
3. Read most recent cash flow data from `~/Documents/aireadylife/vault/estate/00_current/` for actual monthly NCF per property
4. Calculate current mortgage balance for each property using amortization schedule or manual update date
5. Calculate equity per property: current value minus outstanding balance
6. Calculate cap rate: (annual NOI) ÷ current value
7. Calculate cash-on-cash return: annual NCF ÷ total cash invested
8. Calculate annual depreciation: (purchase price minus estimated land value) ÷ 27.5
9. Read prior quarter's summary from `~/Documents/aireadylife/vault/estate/00_current/` for YoY comparison
10. Calculate portfolio-level totals and blended metrics
11. Return full snapshot to calling op

## Input

- `~/Documents/aireadylife/vault/estate/00_current/` — all property records
- `~/Documents/aireadylife/vault/estate/00_current/` — current rent and occupancy
- `~/Documents/aireadylife/vault/estate/00_current/` — most recent cash flow data
- `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records for trend comparison

## Output Format

**Per-Property Table:**
| Address | Purchase Price | Current Value | Equity | Mortgage Bal | Monthly Rent | Monthly NCF | Cap Rate | Cash-on-Cash | Annual Depreciation |

**Portfolio Totals Table:**
| Metric | Value |
| Total Properties | X |
| Total Units | X |
| Total Equity | $X |
| Total Monthly Cash Flow | $X |
| Blended Cap Rate | X% |
| Total Monthly Gross Rent | $X |
| YoY Equity Change | +/-$X |

## Configuration

Required in `~/Documents/aireadylife/vault/estate/config.md`:
- Each property: `address`, `purchase_date`, `purchase_price`, `original_loan`, `loan_rate`, `loan_term_years`, `current_value`, `total_cash_invested`, `land_value_estimate`

## Error Handling

- If current value is not updated within 12 months: use last known value with a stale-data warning
- If cash flow data is missing for current month: use prior month and note
- If mortgage balance not tracked manually and amortization cannot be calculated (missing rate/term): flag as "balance unknown — update property record"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Writes to: `~/Documents/aireadylife/vault/estate/00_current/YYYY-MM-portfolio-snapshot.md`
