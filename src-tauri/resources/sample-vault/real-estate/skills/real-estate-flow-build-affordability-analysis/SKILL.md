---
name: aireadylife-real-estate-flow-build-affordability-analysis
type: flow
trigger: called-by-op
description: >
  Calculates home affordability based on income, debts, down payment savings, and current
  mortgage rates using 28/36 DTI rules. Produces a complete affordability worksheet including
  max purchase price, required down payment, monthly PITI breakdown, and PMI cost if applicable.
---

# aireadylife-real-estate-build-affordability-analysis

**Trigger:** Called by `aireadylife-real-estate-affordability-review`
**Produces:** Affordability worksheet with max purchase price, PITI breakdown, down payment required, and PMI status

## What It Does

This flow applies standard mortgage underwriting rules to the user's financial snapshot to determine the maximum home purchase price they can support at current interest rates. It reads gross income from all sources logged in the vault — W-2 salary, rental income, side income, and any documented bonus — and sums all existing monthly debt obligations: car loans, student loans, credit card minimums, and any other installment debt. This complete income and debt picture drives two parallel calculations: the 28% front-end rule and the 36% back-end rule.

The 28% front-end rule caps total housing costs (principal, interest, property taxes, and homeowner's insurance — together called PITI) at 28% of gross monthly income. For example, if gross monthly income is $12,000, the maximum PITI payment is $3,360. The 36% back-end rule caps all debt payments (PITI plus all other monthly debts) at 36% of gross income. If existing monthly debts are $800, the maximum PITI under the back-end rule is ($12,000 × 0.36) − $800 = $3,520. The flow uses the more restrictive result — in this example, the front-end limit of $3,360.

From the maximum PITI, the flow subtracts estimated monthly property taxes (using the local effective tax rate configured in the vault) and estimated homeowner's insurance (typically $100–$200/month for most single-family homes, or 0.5–1% of purchase price annually). The remainder is the maximum monthly principal and interest (P&I) payment. The flow then solves for the maximum loan amount that produces that P&I payment at the current 30-year fixed rate pulled from the vault config (updated monthly). The maximum purchase price equals the max loan amount divided by (1 − down payment percentage). If the down payment is less than 20%, PMI is added to the monthly payment — typically 0.5–1.5% of the loan amount annually, divided by 12.

The flow also calculates the 20% down payment amount required to avoid PMI, so the user knows both scenarios: what they qualify for today with their available cash, and what purchase price they could reach if they waited to reach 20% down.

## Steps

1. Read gross monthly income (all sources) from `~/Documents/aireadylife/vault/real-estate/config.md`
2. Read all monthly debt obligations from `~/Documents/aireadylife/vault/real-estate/config.md`
3. Apply 28% front-end DTI: max PITI = gross monthly income × 0.28
4. Apply 36% back-end DTI: max PITI = (gross monthly income × 0.36) − total monthly debts
5. Take the lower of the two max PITI figures as the binding constraint
6. Read local property tax rate and estimated insurance from `~/Documents/aireadylife/vault/real-estate/config.md`
7. Calculate max P&I = max PITI − monthly property tax accrual − monthly insurance estimate
8. Solve for max loan amount at current 30-year fixed rate using standard amortization formula
9. Calculate max purchase price at user's configured down payment percentage
10. If down payment < 20%, calculate PMI cost and add to monthly payment; show 20%-down scenario as alternative
11. Write completed affordability worksheet to `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-affordability.md`

## Input

- `~/Documents/aireadylife/vault/real-estate/config.md` — gross monthly income, monthly debts, available down payment, target down payment %, current 30-year fixed rate, local property tax rate
- `~/Documents/aireadylife/vault/real-estate/00_current/` — prior month worksheet (for MoM comparison)
- `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records for trend comparison

## Output Format

Markdown table with the following sections:

**Income & Debt Summary**
| Source | Monthly Amount |
| All debts | Monthly Amount |
| Gross Monthly Income | Total |
| Total Monthly Debts | Total |

**DTI Calculation**
| Rule | Limit | Max PITI | Binding? |
| 28% front-end | $X | $X | Yes/No |
| 36% back-end | $X | $X | Yes/No |

**Affordability Result**
| Field | Value |
| Max PITI | $X |
| Est. Monthly Tax | $X |
| Est. Monthly Insurance | $X |
| Max P&I | $X |
| Current 30yr Rate | X.XX% |
| Max Loan Amount | $X |
| Down Payment | $X (X%) |
| Max Purchase Price | $X |
| PMI (if <20% down) | $X/mo |

## Configuration

Required fields in `~/Documents/aireadylife/vault/real-estate/config.md`:
- `gross_monthly_income` — total monthly gross from all sources
- `monthly_debts` — itemized list of recurring debt payments with amounts
- `available_down_payment` — cash available for down payment today
- `target_down_payment_pct` — preferred down payment percentage (e.g., 20)
- `current_30yr_rate` — current 30-year fixed mortgage rate (update monthly)
- `local_property_tax_rate` — effective annual property tax rate for target market (%)
- `target_market` — city and state for the purchase search

## Error Handling

- If `gross_monthly_income` is missing: prompt user to add income to config.md before running
- If `current_30yr_rate` is blank or older than 60 days: warn that rate may be stale; prompt user to update before relying on results
- If `monthly_debts` is blank: assume $0 and note assumption in output; result may be optimistic
- If calculated max purchase price is negative or zero: output indicates the user does not currently meet underwriting requirements and explains which constraint is binding

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/real-estate/config.md`
- Reads from: `~/Documents/aireadylife/vault/real-estate/00_current/`
- Writes to: `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-affordability.md`
