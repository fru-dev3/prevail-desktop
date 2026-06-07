---
name: linkedin
type: app
description: >
  Reads LinkedIn profile and post analytics for brand consistency auditing and
  audience engagement review via Playwright. Used by brand-agent for monthly
  brand health synthesis. Configure in vault/brand/config.md.
---

# LinkedIn

**Auth:** Playwright + Chrome cookies
**URL:** https://www.linkedin.com
**Configuration:** Set your profile URL and Chrome profile path in `vault/brand/config.md`

## Data Available

- Profile views (7-day, 90-day trend)
- Post impressions, likes, comments, shares per post
- Follower count and follower growth
- Search appearances (keywords people found you by)
- Profile completeness and headline/summary text
- Featured section and banner image

## Configuration

Add to `vault/brand/config.md`:
```
linkedin_profile_url: https://www.linkedin.com/in/YOUR-HANDLE
linkedin_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

## Notes

- Analytics are under: Me → Posts & Activity → Analytics
- Profile audit checks: headline, summary, banner, featured links, skills
- Requires headless=False

## Used By

- `aireadylife-brand-build-analytics-summary` — pull follower and post engagement metrics
- `aireadylife-brand-check-profile-consistency` — audit profile content against brand voice

## Vault Output

`vault/brand/analytics/`
