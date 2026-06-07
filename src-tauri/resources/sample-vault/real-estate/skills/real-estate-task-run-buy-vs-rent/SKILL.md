---
name: aireadylife-real-estate-task-run-buy-vs-rent
type: task
description: >
  Runs a time-value-adjusted buy vs. rent comparison for a specific purchase price and holding
  period, returning the break-even year, total cost-to-own vs. cost-to-rent at 5/7/10 years,
  price-to-rent ratio verdict, and a plain-language recommendation.
---

# aireadylife-real-estate-run-buy-vs-rent

**Trigger:** Called by affordability-review and review-brief ops, or directly on-demand
**Produces:** Buy vs. rent analysis saved to `~/Documents/aireadylife/vault/real-estate/00_current/`

## What It Does

This task runs a rigorous time-value-adjusted buy vs. rent comparison for a specific home purchase price and holding period. It answers the question that every affordability analysis ultimately needs to answer: given this specific market, at this price and rate, does buying make financial sense versus continuing to rent?

The cost-to-own side includes five components. First, the mortgage: principal and interest payments over the holding period at the configured 30-year fixed rate, computed from the amortized schedule. Second, property taxes: annual property value × local effective tax rate, escalated annually by the assumed appreciation rate. Third, homeowner's insurance: typically 0.5–1% of home value per year (use 0.7% as default if not configured). Fourth, maintenance and repair: 1% of home value per year as the standard assumption for a well-maintained home; 1.5% for homes older than 20 years. Fifth, PMI if applicable (loan-to-value above 80%): typically 0.8% of loan balance annually until the loan-to-value drops below 80% through a combination of appreciation and principal paydown — calculated automatically. Partially offsetting these costs: the mortgage interest deduction (estimated using the user's marginal tax bracket if configured), and home equity accumulated through principal paydown and appreciation.

The opportunity cost of the down payment is also calculated and added to the cost-to-own side. The down payment deployed into a home could otherwise have been invested at a market return rate (default 7% annually). This is often the overlooked factor that shifts the break-even year significantly — a $60,000 down payment growing at 7% annually becomes $118,000 in 10 years. That opportunity cost belongs on the buy side of the ledger.

The rent side uses the current monthly rent escalated by the assumed annual rent increase (default 3%). Cumulative rent paid over the holding period is straightforward — the renter also gets to invest the down payment amount (or whatever portion they don't spend on moving costs and deposits), which is tracked as a renter's wealth accumulation advantage in the early years.

The break-even year is the first year where cumulative net ownership cost (mortgage payments + taxes + insurance + maintenance + opportunity cost − equity gained) falls below cumulative net rental cost (rent paid − invested down payment growth). The model runs for years 1 through 15 to find this crossing point. Results are reported at the 5, 7, and 10 year marks as reference points.

The price-to-rent ratio verdict applies the simple heuristic: purchase price ÷ (annual rent) = price-to-rent ratio. Below 15: buy favored. 15–20: gray zone, depends on rate and appreciation assumptions. Above 20: renting is more cost-effective at most holding periods.

## Steps

1. Read purchase price, down payment, current 30-year rate from input or `~/Documents/aireadylife/vault/real-estate/config.md`
2. Read current monthly rent, assumed annual rent increase, assumed home appreciation, and marginal tax bracket from config.md
3. Build amortization schedule for the loan (purchase price minus down payment) at configured rate
4. Calculate annual ownership costs for years 1–15: P&I, property tax (escalating), insurance, maintenance, PMI (until eliminated)
5. Calculate annual opportunity cost of down payment at 7% (or configured market return rate)
6. Calculate annual equity gain: principal paydown + home appreciation
7. Calculate net cumulative cost to own at years 5, 7, 10, 15
8. Calculate cumulative rent at 3% annual escalation for same periods
9. Calculate renter's down payment investment growth at same market return rate
10. Calculate net cumulative cost to rent (rent paid minus investment growth) at years 5, 7, 10, 15
11. Find break-even year (first year where net own cost < net rent cost)
12. Calculate price-to-rent ratio; apply heuristic verdict
13. Write full analysis to `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-buy-vs-rent.md`

## Input

- Purchase price (from calling op or user input)
- `~/Documents/aireadylife/vault/real-estate/config.md`: down payment, rate, current rent, annual rent increase %, home appreciation %, marginal tax rate, market return rate

## Output Format

**Price-to-Rent Ratio:** X.X — [Favors buy / Gray zone / Favors rent]

**Cost Comparison Table:**
| Year | Cum. Cost to Own | Cum. Cost to Rent | Difference | Verdict |
| 5    | $X               | $X                | +/-$X      | [Buy/Rent] |
| 7    | $X               | $X                | +/-$X      | [Buy/Rent] |
| 10   | $X               | $X                | +/-$X      | [Buy/Rent] |

**Break-Even Year:** Year X

**Key Assumptions Used:** list of all rates and percentages applied

**Recommendation:** Plain-language sentence with the verdict and the most important supporting factor.

## Configuration

Required fields in `~/Documents/aireadylife/vault/real-estate/config.md`:
- `current_monthly_rent`, `assumed_annual_rent_increase` (default 3%)
- `assumed_home_appreciation` (default 3%)
- `market_return_rate` (default 7%)
- `marginal_tax_rate` (default 22% if not set)
- `local_property_tax_rate`

## Error Handling

- If current rent is not in config: prompt user to add it; cannot run rent side without it
- If purchase price not provided: use target market median price from most recent market snapshot
- If appreciation or rent increase not configured: use defaults (3%/3%) and note in assumptions

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/real-estate/config.md`
- Writes to: `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-buy-vs-rent.md`
