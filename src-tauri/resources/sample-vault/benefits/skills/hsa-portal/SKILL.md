---
name: hsa-portal
type: app
description: >
  Accesses HSA account balance (cash and invested), YTD employee and employer contributions vs. IRS limit, investment allocation and performance, and eligible expense transaction history from any major HSA carrier portal via Playwright with Chrome cookie session. Supports Fidelity, HSA Bank, Optum/ConnectYourCare, HealthEquity, and WEX. Requires headless=False. Configure carrier URL and Chrome profile in vault/benefits/config.md.
---

# HSA Portal

**Auth:** Playwright + Chrome cookies (carrier-specific login — session cookies from Chrome)
**URL:** Carrier-specific (configured in `vault/benefits/config.md`)
**Configuration:** Set your HSA carrier name and portal URL in `vault/benefits/config.md`

## What It Provides

HSA accounts are held at dedicated HSA carriers — not at regular banks — and each carrier has its own online portal. This skill provides read access to HSA account data for the monthly HSA review: current balance (cash and invested separately), YTD contributions by source, and the investment allocation within the HSA investment sleeve. This data is required to determine whether the account is above the investment threshold, on pace for the annual IRS limit, and whether uninvested cash should be moved to the investment sleeve.

## Supported Carriers

The major HSA carriers and their portal URLs:

**Fidelity HSA** (offered through many large employers):
- URL: `https://www.fidelity.com/hsa`
- Login: Same as Fidelity brokerage login
- Best-in-class investment options (Fidelity index funds, zero expense ratio options available)

**HSA Bank** (associated with Webster Bank):
- URL: `https://www.hsabank.com`
- Login: HSA Bank specific credentials

**Optum Bank / ConnectYourCare:**
- URL: `https://www.optumbank.com` or `https://connectyourcare.com`
- Often the carrier for UnitedHealthcare-administered benefits

**HealthEquity:**
- URL: `https://my.healthequity.com`
- Common carrier for many mid-size employers

**WEX (formerly Discovery Benefits):**
- URL: `https://benefitslogin.wexhealth.com`
- Common in Midwest and Southeast markets

## Data Available

- **Cash balance:** The money market portion of the HSA (kept liquid for near-term medical expenses)
- **Invested balance:** The investment sleeve total (all invested funds)
- **Total balance:** Cash + invested
- **YTD employee contributions:** Amount contributed via payroll deductions from employee's pay
- **YTD employer contributions:** Employer HSA seeding (if applicable — common with HDHPs as an employer incentive)
- **Investment allocation:** Current fund holdings with allocation percentages and balances
- **Transaction history:** All contributions (payroll, out-of-pocket), eligible expense withdrawals, and investment purchases/sales
- **Prior year 5498-SA:** IRS tax form showing annual HSA contribution totals for prior year (available by May of following year)
- **Eligible expense receipts:** If receipts are submitted through the portal, these are visible in the portal

## Configuration

Add to `vault/benefits/config.md`:
```yaml
hsa_carrier: "Fidelity"  # Fidelity / HSA Bank / Optum / HealthEquity / WEX
hsa_portal_url: "https://www.fidelity.com/hsa"
hsa_chrome_profile: "/Users/YOU/Library/Application Support/Google/Chrome/Default"
hsa_investment_threshold: 2000  # dollar amount to keep in cash; invest excess
```

## Investment Threshold Context

Most HSA carriers require a minimum cash balance before allowing investment — typically $500-$1,000. Beyond the carrier minimum, the user may set their own threshold based on expected annual medical spending: keep enough cash to cover the expected annual out-of-pocket spend (e.g., the HDHP deductible), invest the rest. A reasonable default is to keep cash = individual deductible amount. Any balance above that threshold should be invested to compound tax-free.

## 5498-SA Tax Form

The 5498-SA is provided by the HSA carrier each May showing total contributions for the prior year. This form is used to verify Box 12 Code W on the W-2 (employer HSA contributions) and to report total HSA contributions on Schedule 1, Form 8889 if any out-of-pocket (non-payroll) contributions were made. Download annually and save to `vault/benefits/00_current/YYYY-5498SA.pdf`.

## Technical Notes

- **Always headless=False** — HSA portals use bot detection similar to banking portals
- **Session freshness:** HSA portal sessions are typically valid for 30 days; re-authenticate in Chrome if the skill receives a login redirect
- **Fidelity note:** Fidelity's HSA portal is integrated with their broader brokerage platform — the investment allocation page requires navigating to the HSA-specific investment section, not the general brokerage holdings

## Used By

- `aireadylife-benefits-op-hsa-review` — monthly balance check, contribution pace vs. IRS limit, investment threshold status, pending reimbursements
- `aireadylife-benefits-flow-check-hsa-balance` — detailed HSA snapshot for the monthly brief
- `aireadylife-benefits-op-enrollment-review` — confirm HSA election is active and properly funded for the new plan year

## Vault Output

- `~/Documents/aireadylife/vault/benefits/00_current/statements/` — downloaded HSA statements by month
- `~/Documents/aireadylife/vault/benefits/00_current/YYYY-5498SA.pdf` — annual HSA tax form
