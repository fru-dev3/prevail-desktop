---
name: aireadylife-real-estate-op-affordability-review
type: op
cadence: on-demand
description: >
  On-demand affordability analysis that calculates max purchase price, monthly PITI payment,
  required down payment, PMI exposure, and break-even horizon for buying vs. renting at the
  current income, debt, and interest rate environment. Triggers: "can I afford", "affordability",
  "how much house can I buy", "buy vs rent", "what can I qualify for".
---

# aireadylife-real-estate-affordability-review

**Cadence:** On-demand (when evaluating a purchase, after a rate change, or when income changes)
**Produces:** Affordability analysis with max purchase price, payment breakdown, and buy vs. rent recommendation

## What It Does

This op calculates home-buying power based on the current financial snapshot in the vault and the current 30-year fixed mortgage rate. It is the primary tool for answering the question "can I afford to buy?" and for tracking how affordability changes over time as rates move, income changes, or savings grow.

The op applies the two standard underwriting constraints simultaneously and uses whichever is more restrictive. The 28% front-end DTI rule: PITI (principal + interest + property taxes + homeowner's insurance) must not exceed 28% of gross monthly income. The 36% back-end DTI rule: all debt payments combined must not exceed 36% of gross monthly income. These ratios are the conventional loan standard used by Fannie Mae and Freddie Mac; FHA loans allow up to 31%/43%, but conventional is the default calculation.

From the maximum allowable PITI, the op back-calculates the maximum supportable loan amount at the current 30-year fixed rate, then the maximum purchase price given the user's available down payment. If the down payment represents less than 20% of the purchase price, PMI is calculated and added to the monthly payment (typically 0.5–1.5% of the loan balance annually, or $50–$200/month on a $300,000 loan). The op shows how much additional savings would be needed to clear the 20% threshold and eliminate PMI.

Beyond the raw affordability numbers, this op also runs the buy vs. rent comparison at the computed maximum purchase price. The comparison shows cumulative cost of ownership versus renting over 5, 7, and 10 years — including opportunity cost of the down payment at a 7% annual market return — and identifies the break-even year when cumulative ownership cost drops below cumulative rental cost. A market with a price-to-rent ratio below 15 will typically break even within 5 years; above 20, break-even may stretch beyond 10 years.

The op also applies the 3–5x income rule as a secondary sanity check: most financial planners recommend keeping the purchase price within 3x–5x gross annual income. If the calculated maximum purchase price exceeds 5x gross annual income, this is flagged as a risk indicator even if DTI rules are technically satisfied.

## Triggers

- "Can I afford to buy a house?"
- "How much house can I buy right now?"
- "Run affordability analysis"
- "What's my max purchase price?"
- "Update my buy vs. rent analysis"
- "How do mortgage rates affect what I can afford?"
- "Do I have enough for a down payment?"
- "Affordability check"

## Steps

1. Read gross monthly income and monthly debts from `~/Documents/aireadylife/vault/real-estate/config.md`
2. Confirm current 30-year fixed rate in config.md is up-to-date; warn if older than 60 days
3. Call `aireadylife-real-estate-build-affordability-analysis` to calculate max purchase price and PITI breakdown
4. Apply 3–5x income rule to max purchase price; flag if purchase price exceeds 5x annual gross
5. Calculate PMI if down payment < 20%; show savings needed to reach 20% down at the max price
6. Call `aireadylife-real-estate-run-buy-vs-rent` for break-even analysis at 5, 7, and 10 years
7. Read target market median price from `~/Documents/aireadylife/vault/real-estate/00_current/` and compare to user's max purchase price
8. Write affordability report to `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-affordability.md`
9. Call `aireadylife-real-estate-update-open-loops` to log any flags (DTI tight, PMI exposure, market above affordability ceiling)
10. Present results as a narrative summary with the table, then state a plain-language verdict

## Input

- `~/Documents/aireadylife/vault/real-estate/config.md`
- `~/Documents/aireadylife/vault/real-estate/00_current/` (target market median prices)
- `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records for trend comparison

## Output Format

**Header:** Affordability Review — [Month Year]

**Key Numbers** (bold summary box):
- Max Purchase Price: $X
- Required Down Payment: $X (X% of purchase price)
- Monthly PITI: $X
- PMI (if applicable): $X/mo
- Break-Even Year: Year X

**DTI Analysis table:** front-end rule, back-end rule, binding constraint

**Buy vs. Rent Comparison table:** 5-year, 7-year, 10-year cumulative cost of buying vs. renting

**Verdict:** Plain-language sentence: "At the current rate of X.XX%, you can support a purchase price of up to $X. At today's median price of $X in [market], buying [does/does not] make financial sense on a 7-year horizon."

**Action Items:** Any open loops written (e.g., "Save $X more to reach 20% down and eliminate PMI")

## Configuration

Required fields in `~/Documents/aireadylife/vault/real-estate/config.md`:
- `gross_monthly_income`, `monthly_debts`, `available_down_payment`
- `current_30yr_rate`, `local_property_tax_rate`
- `current_monthly_rent` (for buy vs. rent comparison)
- `assumed_annual_rent_increase` (default: 3%)
- `assumed_home_appreciation` (default: 3%)

## Error Handling

- If vault is missing: direct user to frudev.gumroad.com/l/aireadylife-real-estate
- If config.md income field is blank: do not guess; ask user for gross monthly income before running
- If rate is stale: warn prominently; provide approximate result with disclaimer
- If market data is missing for comparison: run affordability analysis only; note market comparison is unavailable

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/real-estate/config.md`
- Reads from: `~/Documents/aireadylife/vault/real-estate/00_current/`
- Writes to: `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-affordability.md`
- Writes to: `~/Documents/aireadylife/vault/real-estate/open-loops.md`
