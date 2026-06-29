---
id: wishlist-and-saved-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/airbnb-wishlist-review-${date}.md, kind: markdown }
---
# Wishlist and saved review

Turn the places you've been dreaming about into a shortlist worth acting on.

1. **Read the wishlists.** From the latest data/airbnb-reservations-*.json, pull saved listings and wishlist collections with location, price, and type.
2. **Group by trip.** Cluster saved places by destination or theme so each future trip has its candidates in one place.
3. **Sanity-check the price.** Compare saved nightly rates against what you've actually paid before, and flag any that are out of your usual range.
4. **Pick the front-runners.** Name a top option per destination with a one-line reason, and note which collections have gone stale and could be cleared.

Output: a wishlist review grouped by destination, with a front-runner per trip and the saved places to prune.
