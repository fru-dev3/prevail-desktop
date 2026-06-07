---
name: pocket
type: app
description: >
  Accesses saved articles and reading queue from Pocket (Mozilla) via OAuth API.
  Used by intel-agent for topic deep dives and curated reading list review.
  Configure OAuth token in vault/intel/config.md.
---

# Pocket

**Auth:** OAuth token (`POCKET_ACCESS_TOKEN`)
**URL:** https://getpocket.com
**API:** https://getpocket.com/v3
**Configuration:** Set your OAuth token in `vault/intel/config.md`

## Data Available

- Saved articles (title, URL, excerpt, time added)
- Tags applied to saved items
- Read vs unread status
- Favorite items
- Archive of previously read articles
- Recommended articles (Pocket Hits)

## Configuration

Add to `vault/intel/config.md`:
```
pocket_access_token: YOUR_POCKET_ACCESS_TOKEN
pocket_consumer_key: YOUR_POCKET_CONSUMER_KEY
```

## Key Endpoints

```
POST https://getpocket.com/v3/get?access_token={token}&state=unread&count=50
POST https://getpocket.com/v3/get?access_token={token}&tag=research
```

## Used By

- `aireadylife-intel-topic-deep-dive` — retrieve saved articles tagged for a specific research topic

## Vault Output

`vault/intel/research/`
