---
name: linkedin
type: app
description: >
  Accesses LinkedIn for job market scanning, compensation research, professional network review, and recruiter message monitoring via Playwright with Chrome cookie session. Requires headless=False. Max 50 job results per search session to avoid rate limiting. Configure profile URL and Chrome profile path in vault/career/config.md.
---

# LinkedIn

**Auth:** Playwright + Chrome cookies (session cookies from existing Chrome login)
**URL:** https://www.linkedin.com
**Configuration:** Set your profile URL and Chrome profile path in `vault/career/config.md`

## What It Provides

LinkedIn is the primary channel for professional networking, recruiter outreach, and job discovery. This skill provides read access to your LinkedIn activity for three purposes: market scanning (finding open roles), network monitoring (reviewing connections and messaging activity), and profile analytics (profile views, search appearances as market signal indicators).

## Data Available

**Job search:**
- Job postings matching configured title + location + experience level + date posted filters
- Salary insights on postings (visible on a minority of postings — most helpful on US postings)
- Company headcount data and recent hiring volume (signal for market health)
- Easy Apply vs. company site application routing

**Network and profile:**
- Connection list with current company and role data (useful for contact record updates)
- Recent activity from connections in your feed (useful for outreach hooks)
- LinkedIn inbox — recruiter messages and connection requests
- Profile view count (weekly) — rising views can indicate recruiter market activity
- Search appearances (weekly) — how often your profile appears in LinkedIn searches, broken down by searcher title and company

**Salary insights:**
- LinkedIn Salary tool — median and range for roles by title and location (less granular than Levels.fyi but broader coverage for non-tech roles)

## Configuration

Add to `vault/career/config.md`:
```yaml
linkedin_profile_url: "https://www.linkedin.com/in/YOUR-HANDLE"
linkedin_chrome_profile: "/Users/YOU/Library/Application Support/Google/Chrome/Default"
```

## Technical Notes

- **Always use headless=False** — LinkedIn actively detects headless Chrome and blocks it. Chrome 127+ uses app-bound cookie encryption that prevents headless sessions from reading stored cookies.
- **Rate limiting:** LinkedIn aggressively rate-limits scrapers. Keep sessions under 50 job result pages. Add 2-3 second delays between page loads. If you encounter a "slow down" interstitial, stop the session and wait 30+ minutes before resuming.
- **Session freshness:** LinkedIn sessions expire after several weeks of inactivity. If you get a login redirect, the user must manually re-authenticate in Chrome before the next session.
- **Premium features:** Some data (InMail credits, full salary insights, "who viewed your profile" full list) requires LinkedIn Premium. The skill uses only data available in the standard free account unless Premium is confirmed.

## Job Search Filters

Standard filter parameters for target role search:
- **Keywords:** role title (e.g., "Senior Software Engineer")
- **Location:** city name or "Remote"
- **Date posted:** Last 30 days (to capture current market only)
- **Experience level:** Mid-Senior / Director (LinkedIn's level taxonomy)
- **Job type:** Full-time

## Used By

- `aireadylife-career-flow-scan-target-roles` — search open roles matching target criteria
- `aireadylife-career-op-network-review` — review connections and recruiter inbox
- `aireadylife-career-op-monthly-sync` — capture profile analytics and recruiter message activity

## Vault Output

- `~/Documents/aireadylife/vault/career/00_current/` — job search results and market scan data
- `~/Documents/aireadylife/vault/career/00_current/linkedin-activity.md` — monthly profile analytics log
- `~/Documents/aireadylife/vault/career/00_current/` — recruiter outreach logged as pipeline items
