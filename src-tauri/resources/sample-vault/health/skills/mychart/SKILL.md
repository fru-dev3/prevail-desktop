---
name: mychart
type: app
description: >
  Accesses patient portal records — lab results (PDF and structured values), visit
  notes, after-visit summaries, upcoming appointments, current medication list, and
  immunization records — from a provider's MyChart instance via Playwright with
  Chrome cookie authentication. Used by the health agent to download clinical data
  for local review and vault storage. Requires headless=False due to Chrome app-bound
  encryption. Configure your provider's portal URL and username in vault/health/config.md.
---

# MyChart

**Auth:** Playwright + Chrome cookies (provider-specific login); headless=False required
**URL:** Configured per provider in `vault/health/config.md` (e.g., https://mychart.yourhospital.org)
**Configuration:** Set portal URL and username in `vault/health/config.md`

## Data Available

- **Lab results** — PDF downloads and structured biomarker values with reference ranges
- **Visit notes** — After-Visit Summaries (AVS), progress notes where available
- **Upcoming appointments** — date, provider, location, reason for visit
- **Past appointments** — visit history with dates and providers
- **Current medications** — active prescription list with dosage and prescriber
- **Immunization records** — vaccination history with dates
- **Secure messages** — messages from care team (read-only)
- **Billing/EOB** — some providers surface charges and insurance payments

## Configuration

Add to `vault/health/config.md`:
```
mychart_url: https://mychart.YOURPROVIDER.org
mychart_username: YOUR_USERNAME
mychart_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

## Setup Notes

- Requires `headless=False` — Chrome app-bound cookie encryption prevents headless auth as of Chrome 127+
- After first login, the session cookie is cached in the Chrome profile; subsequent runs use the cached session
- Re-authentication is typically needed every 30–60 days depending on the provider's session timeout
- Different hospital systems use custom MyChart subdomains — find yours in your patient portal invite email

## Provider-Specific Notes

- **Epic-based portals** (most large health systems) use standard MyChart navigation
- **Cerner portals** (Oracle Health) use different URL structure — may require manual export instead
- **Athena portals** — use athenahealth.com; navigation differs from MyChart

## Used By

- `aireadylife-health-lab-review` — download and parse recent lab result PDFs
- `aireadylife-health-monthly-sync` — pull new visit notes, current medication list, and upcoming appointments

## Vault Output

- `vault/health/00_current/` — downloaded lab result PDFs
- `vault/health/00_current/` — downloaded visit notes and AVS documents
- `vault/health/00_current/` — portal medication list for comparison against vault active list
