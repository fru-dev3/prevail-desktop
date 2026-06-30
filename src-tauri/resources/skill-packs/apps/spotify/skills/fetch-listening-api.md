---
id: fetch-listening-api
runner: api
trigger: on-demand
capability: fetch-listening
auth: [SPOTIFY_ACCESS_TOKEN]
url: https://api.spotify.com/v1/me/player/recently-played?limit=50
method: GET
headers:
  - "Authorization: Bearer ${env.SPOTIFY_ACCESS_TOKEN}"
  - "Accept: application/json"
save: spotify-recently-played-${date}.json
---
# Fetch listening (API fallback)

Headless fallback for the fetch-listening capability. Access method derives from
`runner: api`. Pulls recently played tracks from the Spotify Web API using
SPOTIFY_ACCESS_TOKEN (scope user-read-recently-played). Read-only GET.
