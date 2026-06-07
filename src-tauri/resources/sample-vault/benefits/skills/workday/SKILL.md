---
name: workday
type: app
description: >
  Accesses employer benefits elections, 401k contribution rate, HSA payroll election, open enrollment options, life event changes, and pay stubs from Workday HCM via Playwright with Chrome cookie session. Used by benefits-agent to verify benefit deductions, confirm contribution rates match elections, and navigate enrollment windows. Employer SSO required (Okta, Azure AD, or Google Workspace). Requires headless=False. Configure employer-specific Workday URL and Chrome profile in vault/benefits/config.md.
---

# Workday

**Auth:** Playwright + Chrome cookies (employer SSO — session from existing Chrome login)
**URL:** Employer-specific — e.g., `https://YOURCOMPANY.wd5.myworkdayjobs.com` or `https://YOURCOMPANY.workday.com`
**Configuration:** Set your employer Workday URL and Chrome profile in `vault/benefits/config.md`

## What It Provides

Workday is the dominant enterprise HCM platform used by Fortune 500 companies and large mid-market employers. Where ADP is primarily a payroll processor, Workday is the source of record for benefits elections — the system that HR uses to define plan options, process enrollment changes, and administer life event overrides. If your employer uses Workday, all benefits changes (contribution rates, plan elections, beneficiaries, HSA amounts) originate here, and verifying that Workday reflects your intended elections is more authoritative than checking any downstream system.

This skill provides read access to Workday's Benefits and Pay worklets to confirm what the system of record shows for each benefit type. The primary use case is confirming that enrollment elections made during open enrollment are correctly reflected after the new plan year begins — mismatches between what the user elected and what Workday shows are common after major plan-year transitions. The secondary use case is accessing the 401k contribution rate field and HSA per-paycheck election amount to verify against the pay stub deductions pulled by the ADP skill.

## Data Available

**Benefits worklet:**
- All enrolled benefit plans by type (medical, dental, vision, life, AD&D, FSA, HSA, disability, critical illness, accident insurance)
- Plan name and tier (Employee Only / Employee + Spouse / Employee + Child(ren) / Family)
- Coverage effective dates
- Employee cost per pay period for each benefit
- Beneficiary assignments per plan (name, relationship, allocation %)
- Dependent enrollment (names, dates of birth, relationship)

**Pay worklet (if payroll is in Workday — not all employers run payroll in Workday):**
- Pay stubs for each pay period with gross, net, and itemized deductions
- YTD gross earnings and YTD deduction totals
- 401k contribution rate (expressed as % of gross) and YTD contribution dollar amount
- HSA payroll deduction per pay period and YTD total
- W-2 for prior tax year (if Workday payroll is active)

**Compensation worklet:**
- Base salary as of current date
- Most recent merit increase effective date and amount
- Target bonus percentage (if configured by employer)
- Annual compensation statement (if employer makes it available in Workday)

**Open enrollment (seasonal — October–November):**
- Enrollment window dates (start date, deadline date, effective date)
- Available plans with premium comparison table
- SBC documents per medical plan option (Summary of Benefits and Coverage)
- Confirmation receipt after elections are submitted

**Life event changes:**
- Available qualifying life events (marriage, new child, divorce, loss of other coverage, etc.)
- Documentation requirements per event type
- Change window: typically 30-60 days from the qualifying event date

## Configuration

Add to `vault/benefits/config.md`:
```yaml
workday_url: "https://YOURCOMPANY.wd5.myworkdayjobs.com"  # employer-specific
workday_chrome_profile: "/Users/YOU/Library/Application Support/Google/Chrome/Default"
workday_payroll_in_workday: false  # true if your employer uses Workday payroll (not ADP)
```

Note: If your employer uses Okta SSO, the Chrome profile must have an active Okta session. The Workday URL will redirect to Okta → then back to Workday. The skill handles this redirect automatically if the Chrome session is active.

## Navigation Paths

**Benefits elections:**
```
Home → Benefits → Benefits Elections → Current Year
```

**401k contribution rate:**
```
Home → Benefits → Retirement Savings → Contribution Rate
```

**HSA election:**
```
Home → Benefits → Health Savings Account → Annual Election
```

**Pay stubs (if Workday payroll):**
```
Home → Pay → Pay Slips → Select period → View / Download PDF
```

**Open enrollment:**
```
Home → Benefits → Open Enrollment → [Enrollment task appears when window is active]
```

**Life event change:**
```
Home → Benefits → Change Benefits → [Select qualifying event]
```

## Technical Notes

- **Always headless=False** — Workday enforces bot detection at the employer SSO layer and within the application itself; headless sessions are blocked
- **Employer SSO:** Workday does not have a universal login page — every employer's Workday is behind their SSO provider (Okta, Microsoft Azure AD, Google Workspace, Ping Identity, ADFS). The Chrome profile must have an active SSO session before the skill runs. If the SSO session has expired, the user must log in manually in Chrome first.
- **URL format:** Most Workday tenants follow `COMPANY.wd5.myworkdayjobs.com` or `COMPANY.workday.com`. Some employers use a vanity URL that redirects to their Workday instance — use the final destination URL in config.
- **Worklet naming:** Workday's interface uses "worklets" (tiles on the home screen). Benefits is always a distinct worklet from Pay. If the employer has restricted pay stub access in Workday (routing to ADP instead), the Pay worklet may not be present.
- **Open enrollment window detection:** The enrollment task only appears in Workday during the active enrollment window. Outside of OE, navigation to Benefits shows current elections only — no option to change plans without a qualifying life event.
- **Session duration:** Workday sessions via SSO typically expire after 8-12 hours; re-authenticate in Chrome if the skill receives a redirect to the SSO login page

## Payroll Verification When Workday Is the Source

When Workday payroll is active (not ADP), use this skill instead of the ADP skill for pay stub retrieval. After downloading each pay stub, verify:
1. 401k deduction = contribution rate × gross pay (within rounding, per period)
2. HSA deduction = annual election ÷ pay periods per year (26 for biweekly, 24 for semimonthly)
3. Benefit deductions match enrolled coverage tiers and confirmed per-period premiums in the Benefits worklet
4. No unexpected deductions or missing line items
5. If mismatch found: document specific deduction, compare against Benefits worklet, and flag to HR benefits team in writing within 30 days

## Used By

- `aireadylife-benefits-op-enrollment-review` — navigate open enrollment, capture plan options, confirm elections submitted
- `aireadylife-benefits-op-401k-review` — verify contribution rate matches elected rate, extract YTD contribution total
- `aireadylife-benefits-op-hsa-review` — confirm HSA payroll election amount per pay period
- `aireadylife-benefits-op-coverage-review` — confirm enrolled plans, tiers, and effective dates match expected elections
- `aireadylife-benefits-op-monthly-sync` — monthly deduction verification pass when Workday is the payroll system

## Vault Output

- `~/Documents/aireadylife/vault/benefits/00_current/YYYY-elections-confirmed.md` — screenshot or extracted text of confirmed elections after OE submission
- `~/Documents/aireadylife/vault/benefits/00_current/YYYY-MM-paystub.pdf` — monthly pay stubs (if Workday payroll active)
- `~/Documents/aireadylife/vault/benefits/00_current/YYYY-W2.pdf` — annual W-2 (if Workday payroll active)
