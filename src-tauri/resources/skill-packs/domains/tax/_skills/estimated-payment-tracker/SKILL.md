---
id: estimated-payment-tracker
runner: llm
trigger: on-demand
description: Track the year's four estimated payments, what was paid, what's due, and whether you're on safe harbor.
source: seed
---
# Estimated payment tracker

Run at the start of each quarter to keep the year's payments honest.

1. **The ledger.** List the four federal estimated deadlines (Apr/Jun/Sep/Jan) with what has actually been paid against each, plus any state obligation from the Arizona rental.
2. **On-pace check.** Compare cumulative payments-plus-withholding to the pro-rated safe-harbor target for the year-to-date. From data/income-summary-2026.csv, confirm withholding is keeping up as income grows.
3. **Adjust the remaining.** If income ran ahead of plan (an extra RSU vest, stronger rental income), recompute the remaining quarters so the shortfall doesn't compound into a penalty.
4. **Underpayment risk.** State plainly whether you are inside safe harbor or exposed, and the dollar gap to close.

Output: the four-quarter ledger, the on-pace verdict, and the amount for the next payment.
