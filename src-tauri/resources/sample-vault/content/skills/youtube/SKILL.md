---
name: youtube
type: app
description: >
  Queries YouTube channel analytics (views, watch time, subscribers, revenue) via
  the YouTube Data API v3. Used by content-agent for channel review and revenue
  tracking. Configure API key in vault/content/config.md.
---

# YouTube

**Auth:** OAuth2 via YouTube Data API v3 (`YOUTUBE_API_KEY`)
**URL:** https://studio.youtube.com
**Configuration:** Set your API key and channel ID in `vault/content/config.md`

## Data Available

- Subscriber count and subscriber delta (7-day, 28-day)
- Video views (total and per-video)
- Watch time (hours, 28-day trend)
- Top performing videos by views and watch time
- Estimated revenue and RPM (via AdSense API)
- Impressions and click-through rate (CTR)
- Traffic source breakdown (search, suggested, external)

## Configuration

Add to `vault/content/config.md`:
```
youtube_api_key: YOUR_YOUTUBE_API_KEY
youtube_channel_id: YOUR_CHANNEL_ID
youtube_oauth_token: vault/content/keys/youtube-oauth.json
```

## Key API

```
GET https://www.googleapis.com/youtube/v3/channels?part=statistics&id={channelId}
GET https://youtubeanalytics.googleapis.com/v2/reports?ids=channel=={channelId}
Scopes: https://www.googleapis.com/auth/youtube.readonly
        https://www.googleapis.com/auth/yt-analytics.readonly
```

## Used By

- `aireadylife-content-channel-review` — pull 28-day views, watch time, and subscriber growth
- `aireadylife-content-revenue-review` — pull estimated AdSense revenue and RPM

## Vault Output

`vault/content/analytics/`
