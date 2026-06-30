---
id: fetch-listening-browser
runner: browser-agent
trigger: refresh
favorite: true
method: browser
capability: fetch-listening
session: profile
start_url: https://open.spotify.com/
domain_allow: [open.spotify.com, accounts.spotify.com]
success_url_contains: open.spotify.com
goal: Open Spotify in the logged-in session and read recently played tracks and top artists (track, artist, album, played-at where shown). Read-only: never play, queue, follow, or change a playlist.
outputs:
  - { path: data/spotify-recently-played-${date}.json, kind: replace }
---
# Fetch listening (browser, favorite)

Read recently played tracks and top artists from the Spotify web player using
the logged-in browser session. Favorite, zero-setup. Falls through to the
Spotify Web API method when the browser is blocked.

Read-only. Capture track, artist, album, and played-at, then write a normalized
JSON document. Never play, queue, follow, or edit a playlist.
