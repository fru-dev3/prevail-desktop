---
id: sync-reservations
runner: llm
trigger: refresh
outputs:
  - { path: data/airbnb-reservations-${date}.json, kind: replace }
---
# Sync reservations from Airbnb

Keep your stays and the trips you dream up in the vault so plans and the places you love stay close.

1. **Pull trips.** Fetch upcoming and past reservations with listing name, location, host, check-in and check-out, and confirmation code.
2. **Capture the detail.** For each, keep guest count, nights, nightly rate, cleaning and service fees, total paid, and currency.
3. **Capture wishlists.** Pull saved listings and wishlist collections for places you're considering.
4. **Write the file.** Save as one normalized JSON document, read-only — never book, message a host, or change a reservation.

Output: data/airbnb-reservations-${date}.json with upcoming and past stays plus your wishlists.
