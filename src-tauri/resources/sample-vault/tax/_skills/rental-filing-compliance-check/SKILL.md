---
id: rental-filing-compliance-check
runner: llm
trigger: on-demand
description: Check the Phoenix rental's Schedule E and Arizona nonresident filing obligations for the year.
source: seed
---

# Rental filing compliance check

Run this whenever the rental's income or status changes materially or at tax time.

1. **Confirm Schedule E coverage.** The Phoenix condo income and expenses report
   on Schedule E: rent received, the 8% PM fee, insurance, property tax,
   mortgage interest, repairs, and depreciation.
2. **Land vs. building split.** Depreciation applies to the building only, not
   the land. Use the Maricopa County assessor ratio against the purchase basis.
3. **Depreciation, allowed or allowable.** Claim it every year. The IRS
   recaptures depreciation at sale whether or not it was taken, so skipping it
   is the worst of both worlds.
4. **Arizona nonresident return.** Arizona-source rental income generally
   requires Form 140NR even though Texas levies no income tax. Check the gross-
   income filing threshold for the year.
5. **Passive-loss bucket.** A paper loss may be suspended and carried forward at
   this income level. Note which bucket applies so the value of the loss is clear.

Output which forms are required this year, the deadlines, and any gaps to fix.
