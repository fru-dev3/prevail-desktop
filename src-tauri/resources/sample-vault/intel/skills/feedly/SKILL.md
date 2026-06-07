---
name: feedly
type: app
description: >
  Reads RSS feed articles and trending topics from Feedly via API or Playwright.
  Used by intel-agent for daily news briefing and topic-based digest generation.
  Configure API key or credentials in vault/intel/config.md.
---

# Feedly

**Auth:** Playwright + Chrome cookies (or Feedly API key for Pro/Teams)
**URL:** https://feedly.com
**Configuration:** Set your credentials and feed topics in `vault/intel/config.md`

## Data Available

- Unread article count by feed or topic board
- Article titles, summaries, and source URLs
- Trending articles across followed feeds
- Topic-based boards (AI, Finance, Tech, etc.)
- Article read status and saved items
- Top stories by engagement across feeds

## Configuration

Add to `vault/intel/config.md`:
```
feedly_api_key: YOUR_FEEDLY_API_KEY
feedly_user_id: YOUR_FEEDLY_USER_ID
feedly_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

## Key API (Feedly Developer — Pro+)

```
GET https://cloud.feedly.com/v3/streams/contents?streamId=user/{userId}/category/global.all
Authorization: Bearer $FEEDLY_API_KEY
```

## Used By

- `aireadylife-intel-daily-briefing` — pull top unread articles from priority feeds
- `aireadylife-intel-build-news-digest` — compile topic-filtered article digest

## Vault Output

`vault/intel/digests/`
