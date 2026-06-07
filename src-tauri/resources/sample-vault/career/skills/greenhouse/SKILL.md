---
name: greenhouse
type: app
description: >
  Tracks job application status, interview stages, offer details, and recruiter contacts from employer Greenhouse ATS candidate portals via Playwright. Used by career-agent for pipeline management, stage updates, and interview scheduling. Each employer has their own Greenhouse subdomain or custom URL. Configure target company portal URL in vault/career/config.md.
---

# Greenhouse

**Auth:** Playwright + Chrome cookies (company-specific Greenhouse portal, passwordless email link login)
**URL:** https://boards.greenhouse.io/{company} (candidate-facing) or company custom domain
**Configuration:** Set target company portal URL in `vault/career/config.md`

## What It Provides

Greenhouse is the most widely used ATS at mid-to-large tech companies. As a candidate, you have access to the candidate portal which shows your application status, interview stage, upcoming interviews, and offer details when extended. This skill reads that portal to keep your pipeline entry in `vault/career/00_current/` accurate without manual updates.

## Data Available

- Application status: applied / under review / phone screen scheduled / interviewing / offer extended / rejected
- Interview stage history with dates for each stage transition
- Upcoming interview schedule (date, time, format, interviewer names if provided)
- Offer details when extended: base salary, signing bonus, equity grant, start date, offer expiry date
- Job description for the role you applied for (useful for ATS keyword analysis)
- Recruiter name and email contact from the portal
- Hiring manager name (if provided in portal)

## How to Use

**Stage sync:** Run whenever you want to verify your pipeline entry matches the actual ATS status. Useful before a follow-up to confirm you are not following up on something that already advanced or was rejected.

**Offer capture:** When Greenhouse shows an offer, run this skill to automatically populate all offer fields into the pipeline entry rather than manually transcribing the offer letter.

**Interview prep:** The skill extracts the interviewer names from scheduled interviews (when Greenhouse provides them), which can be used for LinkedIn research before the interview.

## Configuration

Add to `vault/career/config.md`:
```yaml
greenhouse_portals:
  - company: "Company Name"
    portal_url: "https://app.greenhouse.io/candidates/YOUR_ID"
    chrome_profile: "/Users/YOU/Library/Application Support/Google/Chrome/Default"
```

Note: Greenhouse candidate portals use passwordless email links for login. You must have a live session cookie in Chrome. Log in via the emailed link first; the Playwright session will use the saved cookies.

## Technical Notes

- Run with headless=False (required for cookie-based auth — Chrome 127+ blocks headless cookie access)
- Each employer's Greenhouse instance is separate — no single login covers multiple employers
- The candidate portal URL is in the format `https://app.greenhouse.io/candidates/{id}` or a custom employer domain
- Some employers use Greenhouse internally but present a custom-branded career portal — the underlying system is still Greenhouse

## Used By

- `aireadylife-career-task-log-application` — record initial stage and role details when application is submitted
- `aireadylife-career-flow-review-pipeline` — check for stage updates across all active Greenhouse applications

## Vault Output

`~/Documents/aireadylife/vault/career/00_current/` — updates pipeline entries with current stage data
