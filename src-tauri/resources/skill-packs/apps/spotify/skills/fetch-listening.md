---
id: fetch-listening
runner: llm
# Demoted to on-demand: this is now a pack fallback for the fetch-listening
# capability. The browser favorite (and api variant) lead; this still runs if
# they are blocked or fail, writing the same data/ file the analysis skills read.
trigger: on-demand
outputs:
  - { path: data/spotify-recently-played-${date}.json, kind: replace }
  - { path: data/spotify-top-${date}.json, kind: replace }
---
# Pull Spotify Listening
The soundtrack to your days, pulled in read-only so it's part of who your AI knows you to be.
1. **Authorize read scopes.** Use the existing OAuth token with read-only scopes (user-read-recently-played, user-top-read, user-library-read).
2. **Fetch recent plays.** Call the recently-played endpoint and page through to capture track, artist, album, and played-at timestamp.
3. **Fetch top items.** Pull top artists and top tracks across short, medium, and long term ranges.
4. **Normalize.** Write recent plays to spotify-recently-played-${date}.json and top items to spotify-top-${date}.json; do not add, remove, or play anything.
Output: read-only JSON snapshots of recent plays and top artists/tracks.
