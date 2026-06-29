---
id: sync-bookings
runner: llm
trigger: refresh
outputs:
  - { path: data/bookingdotcom-bookings-${date}.json, kind: replace }
---
# Sync bookings from Booking.com

Keep the places you'll sleep in the vault so dates, addresses, and confirmations are all in one place when the day comes.

1. **Pull reservations.** Fetch upcoming and past bookings with property name, city, check-in and check-out dates, and confirmation number.
2. **Capture the stay detail.** For each, keep room type, nights, guest count, total price and currency, and cancellation policy.
3. **Capture saved places.** Pull any wishlist or saved properties the account holds for trips not yet booked.
4. **Write the file.** Save as one normalized JSON document, read-only — never book, modify, or cancel a reservation.

Output: data/bookingdotcom-bookings-${date}.json with upcoming and past stays plus saved properties.
