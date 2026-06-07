---
name: gusto
type: app
description: >
  Accesses payroll records, contractor payments, and year-end tax forms from Gusto
  via Playwright. Used by business-agent for payroll compliance review and
  contractor payment tracking. Configure in vault/business/config.md.
---

# Gusto

**Auth:** Playwright + Chrome cookies
**URL:** https://app.gusto.com
**Configuration:** Set your Chrome profile path in `vault/business/config.md`

## Data Available

- Payroll run history (dates, gross payroll, net pay, taxes withheld)
- Contractor payment records (1099 recipients)
- Employee benefits deductions
- Employer tax liability (federal + state)
- W-2 forms (employees, available January)
- 1099-NEC forms (contractors, available January)
- Year-to-date payroll summary

## Configuration

Add to `vault/business/config.md`:
```
gusto_email: YOUR_GUSTO_EMAIL
gusto_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

## Notes

- Requires headless=False
- Year-end forms under: Tax Documents → W-2s / 1099s
- Payroll history under: Payroll → Payroll History

## Used By

- `aireadylife-business-compliance-review` — verify payroll taxes filed and contractor 1099s issued

## Vault Output

`vault/business/payroll/`
