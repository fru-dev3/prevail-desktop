---
name: adp
type: app
description: >
  Accesses pay stubs, W-2 documents, YTD earnings breakdowns, 401k contribution deductions, and benefit deduction details from ADP Workforce Now or MyADP via Playwright with Chrome cookie session. Used by benefits-agent for monthly payroll verification, 401k match capture confirmation, and year-end document retrieval. Requires headless=False. Configure ADP portal URL and Chrome profile in vault/benefits/config.md.
---

# ADP

**Auth:** Playwright + Chrome cookies (session from existing Chrome login to ADP portal)
**URL:** https://workforcenow.adp.com (ADP Workforce Now) or https://my.adp.com (MyADP)
**Configuration:** Set your ADP portal URL and Chrome profile path in `vault/benefits/config.md`

## What It Provides

ADP is the most widely used payroll and HR platform in the US, serving over 1 million businesses. Most employees encounter ADP as their pay stub and W-2 portal. This skill provides automated access to payroll documents and contribution data for the monthly benefits sync, eliminating manual download steps that create friction and delays in vault data currency.

The primary use case is monthly pay stub retrieval: confirming that 401k deductions match the elected contribution rate, verifying that all benefit deductions are correct and haven't changed unexpectedly, and extracting YTD gross earnings for income tracking. A secondary use case is W-2 retrieval in January each year for tax preparation routing.

## Data Available

**Pay statements (monthly access):**
- Pay stub PDF for each pay period (typically biweekly — 26 stubs/year, or semimonthly — 24 stubs/year)
- Gross pay for the period and YTD
- Net pay for the period
- Federal and state income tax withheld (period and YTD)
- Social Security and Medicare (FICA) withheld (period and YTD)
- 401k contribution deduction (period and YTD) — labeled "401k" or "Retirement" in deductions
- All benefit deductions: medical premium, dental premium, vision premium, HSA payroll deduction, FSA deduction, life insurance premium, disability premium
- Employer 401k match contribution (visible in some ADP configurations as a separate line)
- Direct deposit routing confirmation

**Year-end documents:**
- W-2 (available in ADP mid-January for the prior tax year) — Box 1 wages, Box 12 codes (including 401k contributions in Box 12 Code D), Box 14 (state disability, other)
- 1099 (if applicable for supplemental or contractor income)

**Benefits elections (if payroll is administered in the same ADP instance as benefits):**
- Current benefits elections matching enrolled coverage types
- HSA election amount per pay period
- FSA election amount per pay period

## Configuration

Add to `vault/benefits/config.md`:
```yaml
adp_portal_url: "https://workforcenow.adp.com"  # or https://my.adp.com
adp_chrome_profile: "/Users/YOU/Library/Application Support/Google/Chrome/Default"
```

Note: Some employers use a custom SSO entry point for ADP. If the standard URLs redirect to an employer-specific login page, use that URL instead.

## Navigation Path for Pay Stubs

```
Login → Pay → Pay Statements → Select most recent → Download PDF
```

For year-end W-2:
```
Login → Tax → W-2 Statements → Select year → Download PDF
```

## Technical Notes

- **Always headless=False** — ADP uses bot detection; headless Chrome sessions are blocked
- **Employer SSO:** Many employers configure ADP to require SSO via Okta, Microsoft Azure AD, or Google Workspace. The Chrome profile must have an active SSO session. If the session has expired, the user must log in manually in Chrome before the skill can access the portal.
- **Session duration:** ADP sessions typically expire after 30-60 minutes of inactivity; the Chrome session cookies last longer but may require re-authentication after a few days
- **Pay stub PDF naming:** Save to `vault/benefits/00_current/YYYY-MM-paystub.pdf` using the pay period end date as the month reference

## Payroll Verification Checklist

After downloading each pay stub, verify:
1. 401k deduction = expected contribution rate × gross pay (within rounding)
2. Benefits deductions match enrolled coverage (medical, dental, vision premiums)
3. HSA deduction matches elected HSA contribution per pay period (if HDHP enrolled)
4. FSA deduction matches elected FSA contribution (if FSA enrolled)
5. Any unexpected deductions or missing deductions → flag to HR benefits team

## Used By

- `aireadylife-benefits-op-401k-review` — verify 401k deduction matches elected contribution rate and extract YTD contribution total
- `aireadylife-benefits-op-coverage-review` — confirm benefit deductions are present and match enrolled coverage elections
- `aireadylife-benefits-op-monthly-sync` — monthly pay stub download and payroll data refresh

## Vault Output

- `~/Documents/aireadylife/vault/benefits/00_current/YYYY-MM-paystub.pdf` — monthly pay stubs
- `~/Documents/aireadylife/vault/benefits/00_current/YYYY-W2.pdf` — annual W-2
