---
name: beehiiv
type: app
description: >
  Queries newsletter subscriber and revenue metrics from Beehiiv via their API.
  Used by content-agent for newsletter channel review and revenue tracking.
  Configure API key and publication ID in vault/content/config.md.
---

# Beehiiv

**Auth:** API key (`BEEHIIV_API_KEY`)
**URL:** https://app.beehiiv.com
**API:** https://api.beehiiv.com/v2
**Configuration:** Set your API key and publication ID in `vault/content/config.md`

## Data Available

- Subscriber count (total, active, free vs paid)
- Subscriber growth (new this week/month)
- Email open rate and click rate (per post and overall)
- Revenue: paid subscription MRR, boost earnings
- Post performance (opens, clicks, unsubscribes per send)
- Top referral sources for new subscribers

## Configuration

Add to `vault/content/config.md`:
```
beehiiv_api_key: YOUR_BEEHIIV_API_KEY
beehiiv_publication_id: pub_YOUR_PUBLICATION_ID
```

## Key Endpoints

```
GET https://api.beehiiv.com/v2/publications/{publicationId}/subscriptions
GET https://api.beehiiv.com/v2/publications/{publicationId}/posts
Authorization: Bearer $BEEHIIV_API_KEY
```

## Used By

- `aireadylife-content-channel-review` — pull subscriber count and engagement rates
- `aireadylife-content-revenue-review` — pull MRR and boost revenue

## Vault Output

`vault/content/analytics/`
