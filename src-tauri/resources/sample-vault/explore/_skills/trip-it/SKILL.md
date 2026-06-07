---
name: trip-it
type: app
description: >
  Reads unified trip itineraries from TripIt for travel tracking and confirmation aggregation.
  Used by explore-agent for monthly travel sync — pulling confirmed booking details (flight
  numbers, hotel confirmation numbers, check-in times) from TripIt into the explore vault
  rather than requiring the user to manually re-enter confirmation details.
---

# TripIt — Explore Plugin

**Auth:** Email parsing (auto-forward confirmations to plans@tripit.com) or Playwright + Chrome cookies for UI scraping
**URL:** https://www.tripit.com
**Configuration:** Set account and sync method in `vault/explore/config.md`

## Data Available

- Unified trip itineraries combining all booking types (flights, hotels, rental cars, activities)
- Flight details: airline, flight number, departure airport and terminal, arrival airport and terminal, departure and arrival times, confirmation code, seat assignment
- Hotel details: property name, address, check-in and check-out dates and times, confirmation number, rate information
- Car rental details: rental company, pick-up and drop-off locations and times, confirmation number
- Upcoming trips list for a date range
- Past trip history (for archive reference)
- TripIt Pro (paid): real-time alerts for gate changes, delays, and seat upgrades

## Configuration

Add to `vault/explore/config.md`:
```
tripit_sync_method: email_forwarding
tripit_email: YOUR_TRIPIT_EMAIL@tripit.com
tripit_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

**Email forwarding method (recommended):** Set up any booking confirmation email to auto-forward to plans@tripit.com — TripIt automatically parses and adds it to your itinerary. No scraping needed.

**UI scraping method:** Uses Playwright with headless=False to read TripIt's trip list page. Reads the upcoming trips section and exports details to the vault.

## Notes

- TripIt API available for Pro accounts: `api.tripit.com/v1/list/trip` — returns JSON with full trip data
- For Pro accounts: use the API rather than scraping; configure `tripit_api_key` in config.md
- Email forwarding is the most reliable sync method and works automatically with zero maintenance
- TripIt correctly parses confirmation emails from most major airlines (United, Delta, American, Southwest, international carriers), hotel chains (Marriott, Hilton, Hyatt, IHG), and car rental companies (Hertz, Enterprise, Avis, Budget)

## Used By

- `aireadylife-explore-op-monthly-sync` — pull upcoming confirmed bookings into vault/explore/00_current/ to update booking status fields (populating confirmation numbers the user doesn't need to type manually)
- `aireadylife-explore-flow-build-trip-summary` — cross-reference TripIt itinerary against trip record to verify all booked items are correctly reflected in the vault

## Vault Output

`vault/explore/00_current/` — TripIt data is synced to the relevant trip record file, updating confirmation numbers and booking status fields
