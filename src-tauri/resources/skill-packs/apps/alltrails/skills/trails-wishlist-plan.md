---
id: trails-wishlist-plan
runner: llm
trigger: on-demand
outputs:
  - { path: data/alltrails-wishlist-plan-${date}.md, kind: markdown }
---
# Trails wishlist plan

Turn the list of trails you've been meaning to walk into a plan you can actually act on.

1. **Read the wishlist.** From the latest data/alltrails-trails-*.json, pull every saved and wishlist trail with its location, length, elevation gain, and difficulty.
2. **Group by reach.** Sort into close-to-home day hikes versus trips that need a weekend or travel, so the next free morning has an obvious pick.
3. **Match effort to season.** Flag which trails suit current conditions and which to hold for better weather, drier ground, or longer daylight.
4. **Pick the next three.** Name three trails to do next with a one-line reason each, and note any that need a permit, early start, or a partner.

Output: a grouped wishlist with the next three trails to walk and what each one needs.
