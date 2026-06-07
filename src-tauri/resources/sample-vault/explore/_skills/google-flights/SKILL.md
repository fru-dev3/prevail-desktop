---
name: google-flights
type: app
description: >
  Scrapes flight prices, route options, and price calendar data from Google Flights via Playwright.
  Used by explore-agent for trip planning, fare comparison, and identifying the cheapest travel
  days for wishlist destinations. No authentication required — all data is public.
  Must use headless=False for full calendar rendering.
---

# Google Flights — Explore Plugin

**Auth:** None (public)
**URL:** https://www.google.com/flights
**Configuration:** Set home airport and target destinations in `vault/explore/config.md`

## Data Available

- Flight prices for specific origin-destination pairs on specific dates
- Price calendar (lowest fares per day over a month — identifying the cheapest travel windows)
- Airline options with number of stops, total duration, and price per option
- Nearby airport alternatives and their pricing comparison
- Round-trip vs. one-way fare breakdown
- Baggage fee information (where available)
- Price tracking alerts (via Google Flights UI — manual setup by user)
- Fare history context (Google sometimes shows "price is lower than usual")

## Configuration

Add to `vault/explore/config.md`:
```
explore_home_airport: MSP
explore_preferred_airlines: [United, Delta]
```

## Notes

- Requires Playwright with headless=False for full calendar rendering (calendar view uses JavaScript lazy-loading that doesn't work in headless mode)
- Price calendar URL: `google.com/flights#flt={ORIGIN}.{DEST}.{YYYY-MM-DD};r;ls=1w;li=1`
- Search results URL: `google.com/flights?q={ORIGIN}+to+{DEST}+{DATE}`
- Google Flights does not have an official scraping API — use rendered page content
- For international trips: always check the price calendar view first to identify the cheapest travel window (often 2-3 days flexibility saves $200-500 on international fares)
- Best booking window for international fares: 3-6 months before departure typically yields the best prices on most routes from US airports

## Used By

- `aireadylife-explore-op-trip-planning-review` — check current fare options for a planned trip's dates; compare against budget estimate in trip record
- `aireadylife-explore-flow-build-trip-summary` — surface current round-trip fare if flights are unbooked, to populate the budget estimate field

## Vault Output

`vault/explore/00_current/` — flight research results written to the trip record as a fare comparison note
