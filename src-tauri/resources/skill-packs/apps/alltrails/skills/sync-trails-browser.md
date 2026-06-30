---
id: sync-trails-browser
runner: browser-agent
trigger: refresh
favorite: true
method: browser
capability: sync-trails
session: profile
start_url: https://www.alltrails.com/my/lists
domain_allow: [www.alltrails.com, alltrails.com]
success_url_contains: alltrails.com
goal: Open AllTrails in the logged-in session and read your saved lists, favorites, and wishlist trails (name, location, length, elevation gain, difficulty, and your completed status). Read-only: never edit a list or post a review.
outputs:
  - { path: data/alltrails-trails-${date}.json, kind: replace }
---
# Sync trails (browser, favorite)

Read your saved lists, favorites, and wishlist from AllTrails using the
logged-in browser session. AllTrails has no civilian REST API, so browser is
the favorite and primary method. The MCP variant enriches trail details when an
AllTrails MCP server is configured.

Read-only. Capture name, location, length, elevation gain, difficulty, and
completed status, then write a normalized JSON document.
