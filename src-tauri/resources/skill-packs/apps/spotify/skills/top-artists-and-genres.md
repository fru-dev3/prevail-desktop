---
id: top-artists-and-genres
runner: llm
trigger: on-demand
outputs:
  - { path: data/spotify-top-artists-genres-${date}.json, kind: replace }
---
# Spotify Top Artists & Genres
The things that move you, named.
1. **Load top items.** Read the latest data/spotify-top-*.json snapshot.
2. **Rank artists.** List top artists across short, medium, and long term ranges.
3. **Roll up genres.** Aggregate genres from artist metadata to show your dominant and emerging tastes.
4. **Contrast horizons.** Note artists rising recently versus long-term staples.
Output: a top-artists-and-genres JSON with ranked artists, genre rollups, and short vs. long term contrasts.
