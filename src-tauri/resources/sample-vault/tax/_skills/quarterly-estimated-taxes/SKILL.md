---
id: quarterly-estimated-taxes
runner: llm
trigger: on-demand
description: Quarterly estimate check: income to date, safe-harbor math, and the payment to make.
source: seed
---

# Quarterly estimated taxes

Run two weeks before each quarterly deadline (Apr/Jun/Sep/Jan).

1. **Income to date.** From data/income-summary-2026.csv: salary, RSU vests
   (coordinate with the wealth domain), and any other income year-to-date.
2. **Withholding gap.** Compare tax withheld so far against the projected full-
   year liability. RSU under-withholding is the usual culprit.
3. **Safe harbor.** Compute the safe-harbor floor (prior-year based) and the
   current-year projection. Pay the smaller amount that still avoids penalty.
4. **Schedule it.** The payment amount, the deadline, and a one-line record in
   the ledger.

Output: the gap, the safe-harbor number, and the payment with its date.
