---
id: tax-document-organizer
runner: llm
trigger: on-demand
description: Build the year's document checklist, mark what has arrived, and flag what is still missing.
source: seed
---
# Tax document organizer

Run in January and again two weeks before filing.

1. **Build the expected list.** From data/income-summary-2026.csv and last year's return, list every form you should receive: W-2s, 1099s, RSU/brokerage statements, mortgage interest (1098), the Schedule E rental file, and the FBAR inputs from data/fbar-2026.json.
2. **Mark arrived vs missing.** Tick off what has landed in the tax folder. Most forms arrive by end of January; brokerage consolidated 1099s often come later and get corrected, note which are still provisional.
3. **Cross-border pieces.** Confirm the foreign-account records needed for FinCEN 114 are complete, since those rarely arrive on a US schedule and are easy to forget.
4. **Chase the gaps.** For each missing item, name the issuer and where to retrieve it, so nothing stalls the return in April.

Output: the document checklist with arrived/missing status and the chase list for the gaps.
