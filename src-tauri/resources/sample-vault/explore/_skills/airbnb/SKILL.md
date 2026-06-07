---
name: airbnb
type: app
description: >
  Scrapes Airbnb for property listings, availability, and pricing for target destinations and
  date ranges via Playwright. Used by explore-agent for accommodation research during trip
  planning — comparing options before committing to a booking. Must use headless=False.
  Configure in vault/explore/config.md.
---

# Airbnb — Explore Plugin

**Auth:** Playwright + Chrome cookies (optional — public listings accessible without login; login enables saved searches and wish lists)
**URL:** https://www.airbnb.com
**Configuration:** Set preferences in `vault/explore/config.md`

## Data Available

- Property listings for a destination and check-in/checkout date range
- Nightly price (and total price including cleaning fee, Airbnb service fee)
- Property type (apartment, house, room, unique stay)
- Size (bedrooms, bathrooms, maximum guests)
- Amenities (WiFi, kitchen, washer/dryer, AC, parking, pool)
- Guest review rating (out of 5.0) and total review count
- Superhost status (indicates host reliability)
- Cancellation policy (flexible, moderate, strict)
- Availability calendar for a property
- Location and neighborhood map

## Configuration

Add to `vault/explore/config.md`:
```
airbnb_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
explore_min_bedrooms: 1
explore_max_nightly_price: 250
explore_min_rating: 4.5
```

## Notes

- Requires headless=False — Airbnb uses JavaScript rendering and bot detection that blocks headless browsers
- Search URL format: `airbnb.com/s/{destination}/homes?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&adults=N`
- For best results: log in with Chrome profile to access saved searches and wishlist sync
- Price shown on listing card includes nightly rate; total price (with fees) shown after clicking through
- Focus the scrape on top 5-10 results for comparison rather than exhaustive listing scraping

## Used By

- `aireadylife-explore-op-trip-planning-review` — compare accommodation options for a planned trip when hotel/accommodation is still unbooked
- `aireadylife-explore-flow-build-trip-summary` — surface current pricing for unbooked accommodation in trip budget section

## Vault Output

`vault/explore/00_current/` — accommodation research notes written to the trip file as a comparison table
