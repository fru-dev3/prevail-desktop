---
name: aireadylife-estate-op-portfolio-review
type: op
cadence: quarterly
description: >
  Quarterly portfolio performance review: cap rates, cash-on-cash return, equity positions,
  depreciation schedule, hold vs. sell analysis, and capital improvement ROI modeling per
  property. The strategic read on whether each property is performing and where capital should move.
  Triggers: "portfolio review", "property performance", "cap rate", "rental return", "hold or sell".
---

# aireadylife-estate-portfolio-review

**Cadence:** Quarterly (first week of January, April, July, October)
**Produces:** Comprehensive quarterly portfolio report in `~/Documents/aireadylife/vault/estate/00_current/` with per-property financials, equity positions, hold/sell analysis, and open loop flags

## What It Does

This is the most important recurring operation in the estate plugin. It runs quarterly to produce a complete strategic assessment of every property in the portfolio — not just whether cash flow is positive, but whether each property is the best use of the capital deployed in it. It answers: is this property earning its keep, or should the equity be redeployed into a higher-performing asset?

For each property, the review calculates the four key performance metrics. Cap rate: annual NOI divided by current market value. The cap rate tells you what you'd earn if you bought this property for cash today. A cap rate below the local market average (typically 5–8% for residential) signals the property may be overpriced relative to its income, or expenses are too high. Cash-on-cash return: annual pre-tax cash flow after debt service divided by total cash invested. This is the actual return on the capital you put in. A 6–8% cash-on-cash return is considered healthy for residential rentals; below 4% warrants a hold vs. sell discussion. Equity position: current market value minus outstanding mortgage balance. Equity is capital — capital that could be redeployed through a cash-out refinance or property sale. Annual depreciation benefit: (purchase price minus land value) ÷ 27.5 years. Depreciation is a non-cash tax deduction that reduces taxable rental income — a $200,000 improvement value generates $7,273/year in depreciation deductions, worth roughly $1,600–$2,200/year in tax savings at a 22–30% marginal rate.

The hold vs. sell analysis per property is a simplified decision framework applied to each asset. Sell signals: cap rate has dropped below 4% (likely appreciated significantly), equity is large enough to redeploy into 2+ properties through a 1031 exchange, deferred maintenance is projected to cost more than 2 years of cash flow, or cash-on-cash return has fallen below 3% and the market is at peak pricing. Hold signals: cash-on-cash return above 6%, strong and stable tenant, remaining mortgage amortization building significant equity, local rent growth strong. If a sell signal is triggered, the op calculates estimated net proceeds (current value minus mortgage payoff minus estimated 6% selling costs minus capital gains tax at 15% federal rate, less $250k/$500k primary residence exclusion if applicable).

Capital improvement ROI modeling: for each property where significant deferred maintenance or value-add opportunities exist (kitchen remodel, bathroom addition, HVAC replacement), the op models the investment required, the projected rent increase achievable (typically $25–$75/month per $5,000 invested in kitchen/bath improvements), the payback period (investment ÷ annual rent increase), and the post-improvement cap rate.

## Triggers

- "Run the quarterly portfolio review"
- "How are my rental properties performing?"
- "Should I sell [property address]?"
- "Cap rate review"
- "Cash-on-cash return for my rentals"
- "Portfolio performance update"
- "Hold or sell analysis"
- "What's my equity in my rentals?"

## Steps

1. Call `aireadylife-estate-build-portfolio-summary` to pull current values, equity, and tenant data
2. Call `aireadylife-estate-analyze-cash-flow` for the detailed quarterly expense breakdown and NCF per property
3. Calculate cap rate and cash-on-cash return per property
4. Calculate annual depreciation benefit per property using (purchase price minus land value) ÷ 27.5
5. Apply hold vs. sell decision framework to each property; flag sell signals if criteria met
6. For any flagged sell: calculate estimated net proceeds including selling costs (6%) and estimated capital gains tax
7. Check if a 1031 exchange is viable for any sell scenario (flag if equity ≥ $50,000 and comparable properties are available in target markets)
8. For each property with deferred maintenance or value-add opportunities: model capital improvement ROI
9. Call `aireadylife-estate-update-open-loops` with hold/sell flags and strategic recommendations
10. Write quarterly portfolio report to `~/Documents/aireadylife/vault/estate/00_current/YYYY-Q{N}-portfolio-review.md`
11. Present full report with per-property analysis and portfolio-level strategic summary

## Input

- `~/Documents/aireadylife/vault/estate/00_current/` — all property records
- `~/Documents/aireadylife/vault/estate/00_current/` — current tenant and rent data
- `~/Documents/aireadylife/vault/estate/00_current/` — quarterly cash flow data
- `~/Documents/aireadylife/vault/estate/00_current/` — deferred maintenance records
- `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records for trend comparison

## Output Format

**Quarterly Portfolio Review — Q[N] [Year]**

**Per-Property Performance Table:**
| Address | Cap Rate | Cash-on-Cash | Equity | Annual Depr. | NCF/mo | Signal |

**Hold/Sell Analysis:**
Per property: hold/sell verdict with supporting data and estimated net proceeds if sell

**Portfolio-Level Summary:**
Total equity, blended cap rate, total annual cash flow, YoY equity growth

**Capital Improvement Opportunities:**
| Property | Improvement | Cost | Rent Increase | Payback | Post-Improvement Cap Rate |

**Strategic Recommendations:**
Prioritized action items based on portfolio analysis

## Configuration

Required in `~/Documents/aireadylife/vault/estate/config.md`:
- All property records with purchase price, loan data, current value, total cash invested, land value estimate
- `owner_marginal_tax_rate` for depreciation benefit calculation

## Error Handling

- If vault missing: direct to frudev.gumroad.com/l/aireadylife-estate
- If current property values not updated within 6 months: flag as stale; continue with available data and note in report
- If a property has no cash flow records: report equity position only; note cash flow data is missing

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`, `01_tenants/`, `03_cashflow/`, `02_maintenance/`
- Writes to: `~/Documents/aireadylife/vault/estate/00_current/YYYY-Q{N}-portfolio-review.md`
- Writes to: `~/Documents/aireadylife/vault/estate/open-loops.md`
