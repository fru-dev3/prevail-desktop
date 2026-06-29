---
id: sync-trails
runner: llm
trigger: refresh
outputs:
  - { path: data/alltrails-trails-${date}.json, kind: replace }
---
# Sync trails from AllTrails

Bring your saved routes and wishlist into the vault so the next adventure outside is always close at hand.

1. **Pull your lists.** Fetch the authenticated user's saved lists, favorites, and wishlist trails.
2. **Pull completed trails.** Fetch recorded/completed activities with distance, elevation gain, duration, and date.
3. **Capture trail detail.** For each trail, keep name, location, length, elevation, difficulty, route type, and rating.
4. **Write the file.** Save everything as a single normalized JSON document, read-only — never create, edit, or delete trails on AllTrails.

Output: data/alltrails-trails-${date}.json with your wishlist and completed trails normalized for analysis.
