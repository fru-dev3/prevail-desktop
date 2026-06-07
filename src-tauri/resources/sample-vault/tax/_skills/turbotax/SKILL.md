---
name: turbotax
type: app
description: >
  Accesses TurboTax Online for prior year return downloads (PDF), current year filing
  status, imported W-2 and 1099 data summary, estimated refund or amount owed, and
  key return metrics (AGI, effective tax rate, total deductions). Used by the tax agent
  for document sync (downloading completed returns), prior year AGI retrieval for safe
  harbor calculations, and annual review. Prior year returns are available in TurboTax
  for 7 years. Configure Intuit credentials and Chrome profile in vault/tax/config.md.
---

# TurboTax

**Auth:** Intuit account login via Playwright + Chrome cookies (headless=False)
**URL:** https://turbotax.intuit.com (online version)
**Configuration:** Set Intuit email and Chrome profile in `vault/tax/config.md`

## Data Available

| Data Type | Navigation Path | Use |
|-----------|----------------|-----|
| Prior year returns (PDF) | My TurboTax → Tax Home → [Year] → Download/Print → Full return PDF | Annual return archive; prior year AGI for safe harbor |
| Filing status | Tax Home | Current year filing status: Not started / In progress / Filed |
| Estimated refund/amount due | Current year return → Continue → summary screen | Current year tax position estimate |
| AGI (prior year) | Prior year return PDF → Form 1040, line 11 | Required for 110% safe harbor rule |
| Prior year total tax | Prior year return PDF → Form 1040, line 24 | Required for safe harbor quarterly estimate |
| Imported documents | Wages & Income section → imported W-2, 1099s | Which documents TurboTax has auto-imported (cross-reference with vault checklist) |

## Configuration

Add to `vault/tax/config.md`:
```
turbotax_email: YOUR_INTUIT_EMAIL
turbotax_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

If the user files with a CPA instead of TurboTax, the prior year return PDF can be obtained directly from the CPA and placed in `vault/tax/01_prior/YYYY/` — the IRS skill's transcript download is an alternative source for key figures (prior year AGI, prior year tax liability).

## Prior Year Return Archive

After filing (or receiving the filed return from CPA), download the complete return PDF:
- TurboTax: Tax Home → [Year] → Download or print your return → Full federal return
- Save as: `vault/tax/01_prior/YYYY/1040-YYYY-complete.pdf`
- Save state return separately: `vault/tax/01_prior/YYYY/state-return-YYYY.pdf`

## Key Figures for Safe Harbor Calculation

From the prior year return PDF (Form 1040):
- **Line 11** — Adjusted Gross Income (AGI): determines whether 110% safe harbor applies (>$150,000)
- **Line 24** — Total Tax: the baseline for safe harbor calculation
- **Line 37** — Federal income tax withheld: already captured for current year; prior year withholding not needed

## Notes

- TurboTax Online stores returns for 7 years in the portal
- If using TurboTax Desktop (installed software), export the PDF before the tax year window closes in the desktop app
- The "Intuit account" credentials are shared between TurboTax and QuickBooks — the same Chrome profile can be used for both if logged in as the same Intuit account

## Used By

- `aireadylife-tax-document-sync` — download completed return PDFs for archive and future reference
- `aireadylife-tax-build-estimate` — read prior year AGI (line 11) and total tax (line 24) for safe harbor calculation

## Vault Output

- `vault/tax/01_prior/YYYY/1040-YYYY-complete.pdf` — complete federal return PDF
- `vault/tax/01_prior/YYYY/state-return-YYYY.pdf` — state return PDF
- `vault/tax/config.md` — updated with prior year AGI and total tax after download (manual update prompt)
