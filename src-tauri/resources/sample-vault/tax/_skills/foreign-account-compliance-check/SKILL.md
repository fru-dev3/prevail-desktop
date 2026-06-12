---
id: foreign-account-compliance-check
runner: llm
trigger: on-demand
description: Check whether foreign bank accounts trigger FBAR and FATCA filing obligations for the year.
source: seed
---

# Foreign-account compliance check

Run this whenever a foreign account balance changes materially or at tax time.

1. **Aggregate the max balance.** Sum the highest balance of every foreign
   financial account at any point during the year (in USD equivalent).
2. **FBAR threshold.** If the aggregate exceeded $10,000 at any time, FinCEN
   Form 114 (FBAR) is required. Deadline April 15, automatic extension to
   October 15.
3. **FATCA threshold.** Check Form 8938 thresholds (higher, and they vary by
   filing status and residency). This is separate from and additional to FBAR.
4. **Document the trail.** Note account institution, account number, and the
   peak balance for each — you'll need them on the forms.
5. **Flag penalties.** Non-willful FBAR penalties are steep; if a prior year
   was missed, surface the streamlined-filing option rather than ignoring it.

Output which forms are required this year, the deadlines, and any gaps to fix.
