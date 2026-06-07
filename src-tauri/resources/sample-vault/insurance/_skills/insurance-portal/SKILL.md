---
name: insurance-portal
type: app
description: >
  Accesses policy documents, coverage details, premium amounts, renewal dates, and claim status from any personal insurance carrier's online portal via Playwright with Chrome cookie session. Used by insurance-agent for coverage audits, renewal date verification, and claims status checking. Requires headless=False. Configure carrier portal URLs in vault/insurance/config.md.
---

# Insurance Portal

**Auth:** Playwright + Chrome cookies (carrier-specific login — session cookies from existing Chrome login)
**URL:** Configured per carrier in `vault/insurance/config.md`
**Configuration:** Set carrier portal URL and Chrome profile path in `vault/insurance/config.md`

## What It Provides

Most insurance carriers provide online portals where policyholders can view declarations pages, download policy documents, check claim status, make payments, and see renewal information. This skill provides read access to those portals to keep vault data current without manual downloads.

The primary use case is annual or semi-annual document refresh: when the coverage audit runs, it needs current declarations pages with the latest coverage limits and premiums. Rather than prompting the user to manually download documents, this skill retrieves them automatically from the carrier portal.

## Supported Carrier Types

**Auto:**
- Progressive: progressive.com → Policy Details → Documents
- State Farm: statefarm.com → Account → Policy Documents
- GEICO: geico.com → Policy Details → Policy Documents
- Allstate: allstate.com → Manage Policy → Policy Documents

**Home/Landlord:**
- Nationwide: nationwide.com → Manage Policy
- Obie (landlord): obieinsurance.com → Policies
- Hippo: hippo.com → My Policies
- State Farm: same as auto above

**Life/Disability:**
- Principal: principal.com → My Accounts
- Guardian: guardianlife.com → My Account
- MetLife: metlife.com → My Benefits

**Umbrella:**
- Usually with home carrier — access through same portal

## Data Available

- Declarations pages (PDF — most important document; shows carrier, policy number, coverage limits, deductibles, premium, and renewal date on 1-2 pages)
- Full policy documents (PDF — detailed terms, conditions, exclusions)
- Current coverage limits and deductibles by coverage type
- Policy renewal date and next payment due date
- Annual premium and payment schedule
- Claims history (filed date, status, settlement amount)
- Open claim status for active claims

## Configuration

Add to `vault/insurance/config.md`:
```yaml
insurance_portals:
  - name: "Auto Insurance"
    carrier: "Progressive"
    portal_url: "https://www.progressive.com/loggedIn/overview"
    chrome_profile: "/Users/YOU/Library/Application Support/Google/Chrome/Default"
  - name: "Home Insurance"
    carrier: "Nationwide"
    portal_url: "https://www.nationwide.com/personal/manage-your-policy"
    chrome_profile: "/Users/YOU/Library/Application Support/Google/Chrome/Default"
  - name: "Term Life"
    carrier: "Principal"
    portal_url: "https://www.principal.com/individuals/my-accounts"
    chrome_profile: "/Users/YOU/Library/Application Support/Google/Chrome/Default"
```

## Technical Notes

- **Always headless=False** — most insurance carrier portals use bot detection; headless Chrome is blocked
- **Session freshness:** Log into each carrier portal in Chrome before running the skill; cookies are typically valid for 30-90 days depending on carrier
- **Download path:** PDF documents are downloaded to `vault/insurance/00_current/{type}/` with carrier and date in filename
- **Rate limiting:** Add 3-5 second delays between page loads; insurance portals are not high-throughput platforms

## Used By

- `aireadylife-insurance-op-coverage-audit` — download current declarations pages before running gap analysis
- `aireadylife-insurance-op-renewal-watch` — verify renewal date and current premium from carrier portal
- `aireadylife-insurance-op-claims-review` — check open claim status from carrier claims portal

## Vault Output

- `~/Documents/aireadylife/vault/insurance/00_current/{type}/` — downloaded policy documents
- `~/Documents/aireadylife/vault/insurance/00_current/` — renewal dates and premium updates
