---
id: year-end-tax-moves
runner: llm
trigger: on-demand
description: The December checklist of moves that must happen before Dec 31 to count for this tax year.
source: seed
---
# Year-end tax moves

Run in early December, most of these expire at midnight on the 31st.

1. **Max the buckets.** From data/income-summary-2026.csv and the wealth holdings, check remaining room in 401k, HSA, and IRA, and decide what to top up before the deadline (some allow until April, some don't).
2. **Loss harvesting.** Review taxable lots in data/holdings.csv for positions underwater. Realize losses to offset RSU and other gains, minding the 30-day wash-sale window before rebuying.
3. **Timing income and deductions.** Decide whether to pull deductions into this year or push income out, bunch charitable gifts, prepay the rental's deductible expenses, or defer a discretionary sale into January.
4. **Withholding true-up.** If under-withheld, a final-paycheck bump or a January estimated payment can still cover the gap; coordinate with the estimated-payment tracker.

Output: a dated December checklist of moves, each with its dollar impact and hard deadline.
