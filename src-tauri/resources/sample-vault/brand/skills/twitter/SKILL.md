---
name: twitter
type: app
description: >
  Pulls follower count, impressions, and mention data from Twitter/X via Playwright.
  Used by brand-agent for social presence monitoring and mention analysis.
  Configure in vault/brand/config.md.
---

# Twitter / X

**Auth:** Playwright + Chrome cookies
**URL:** https://x.com (formerly twitter.com)
**Configuration:** Set your handle and Chrome profile path in `vault/brand/config.md`

## Data Available

- Follower count and follower growth trend
- Tweet impressions and engagement rate (likes + retweets + replies)
- Profile views (monthly)
- Mentions and @ replies
- Direct messages (unread count)
- Top performing tweets by impressions

## Configuration

Add to `vault/brand/config.md`:
```
twitter_handle: YOUR_HANDLE
twitter_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

## Key URLs

- Analytics: analytics.twitter.com
- Mentions: Notifications → Mentions tab

## Notes

- Requires headless=False; X has aggressive bot detection
- Twitter API v2 available as alternative if `TWITTER_BEARER_TOKEN` is set

## Used By

- `aireadylife-brand-monthly-synthesis` — pull monthly impressions and follower delta
- `aireadylife-brand-analyze-mentions` — surface brand mentions and sentiment

## Vault Output

`vault/brand/analytics/`
