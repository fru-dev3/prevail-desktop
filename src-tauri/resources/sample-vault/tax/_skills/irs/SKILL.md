---
name: irs
type: app
description: >
  Accesses IRS.gov for account transcripts (payments applied, balance due, prior
  year tax summary), IRS Direct Pay for estimated tax payments (1040-ES), and
  notice/letter downloads via Playwright with ID.me authentication. Also accesses
  EFTPS (Electronic Federal Tax Payment System) for scheduled estimated payments.
  Used by the tax agent for verifying prior quarterly payments and confirming payment
  received on the IRS transcript. Requires headless=False (ID.me MFA). Configure
  ID.me email and Chrome profile in vault/tax/config.md.
---

# IRS

**Auth:** Playwright + Chrome cookies (IRS ID.me authentication; headless=False required)
**Primary URL:** https://www.irs.gov
**EFTPS URL:** https://www.eftps.gov
**Configuration:** Set ID.me email and Chrome profile in `vault/tax/config.md`

## Data Available

| Data Type | Navigation Path | Use Case |
|-----------|----------------|----------|
| Account transcript | IRS.gov → Your Online Account → Tax Records → View Account Transcript | Verify payments applied, check balance, see prior year tax |
| Tax return transcript | IRS.gov → Your Online Account → Tax Records → Tax Return Transcript | Prior year AGI, deductions, and liability for safe harbor |
| Notices and letters | IRS.gov → Your Online Account → Notices | Download CP2000, audit notices, balance due letters |
| Payment history | IRS.gov → Your Online Account → View Tax Account | All payments: withholding, estimated payments, refunds applied |
| Direct Pay | IRS.gov → Make a Payment → Direct Pay | Immediate estimated tax payment using bank account |

## Configuration

Add to `vault/tax/config.md`:
```
irs_idme_email: YOUR_IDME_EMAIL
irs_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
eftps_enrolled: true
```

## IRS Direct Pay: Making an Estimated Payment

1. Navigate to https://www.irs.gov/payments
2. Click "Make a Payment"
3. Select: "Estimated Tax" as reason for payment
4. Select: "1040-ES" as tax form
5. Enter tax year (current year)
6. Enter payment amount from the quarterly estimate calculation
7. Enter bank account information (routing + account number)
8. Select payment date (can schedule up to 365 days in advance)
9. Confirm and save confirmation number in `vault/tax/00_current/payment-log.md`

## EFTPS for Scheduled Payments

EFTPS requires enrollment (5–7 business days to receive PIN by mail). Once enrolled:
- Schedule payments up to 365 days in advance
- Ideal for recurring quarterly estimated payments
- Enrollment: eftps.gov → "Enroll" → Individual → follow prompts

## Session Notes

- IRS ID.me login requires identity verification on first use (ID upload, selfie)
- MFA is triggered on new sessions or new IP addresses — complete in the Chrome window
- Session cookies valid 30–90 days depending on activity
- Transcript data is typically updated within 3 weeks of a payment being processed

## Used By

- `aireadylife-tax-quarterly-estimate` — verify prior estimated payments on transcript before calculating new payment
- `aireadylife-tax-deadline-watch` — confirm payment received and transcript updated; download any new notices

## Vault Output

- `vault/tax/irs/transcripts/` — downloaded account and return transcript PDFs
- `vault/tax/irs/notices/` — downloaded IRS notices and letters
- `vault/tax/00_current/payment-log.md` — confirmation numbers recorded after each Direct Pay submission
