---
name: google-analytics
type: app
description: >
  Queries GA4 website analytics via the Google Analytics Data API for traffic,
  engagement, and audience data. Used by brand-agent for monthly web presence
  synthesis. Configure property ID and credentials in vault/brand/config.md.
---

# Google Analytics

**Auth:** OAuth2 via GA4 Data API (service account key or `GA4_PROPERTY_ID`)
**URL:** https://analytics.google.com
**Configuration:** Set your property ID and service account key in `vault/brand/config.md`

## Data Available

- Sessions, users, new users (daily / weekly / monthly)
- Pageviews and pages per session
- Bounce rate and average session duration
- Traffic sources (organic, direct, referral, social)
- Top pages by pageviews
- Geographic breakdown of visitors
- Device type split (desktop / mobile / tablet)

## Configuration

Add to `vault/brand/config.md`:
```
ga4_property_id: YOUR_PROPERTY_ID
ga4_service_account_key: vault/brand/keys/ga4-service-account.json
```

## Key API

```
POST https://analyticsdata.googleapis.com/v1beta/properties/{propertyId}:runReport
Scopes: https://www.googleapis.com/auth/analytics.readonly
```

## Used By

- `aireadylife-brand-monthly-synthesis` — pull site traffic and top content metrics

## Vault Output

`vault/brand/analytics/`
