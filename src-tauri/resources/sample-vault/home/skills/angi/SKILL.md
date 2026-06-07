---
name: angi
type: app
description: >
  Searches contractor listings, ratings, license status, and cost guides on Angi (formerly
  Angie's List) via Playwright. Used by home-agent for finding and vetting service professionals
  for maintenance tasks. Configure location and Chrome profile in vault/home/config.md.
---

# Angi

**Auth:** Playwright + Chrome cookies (headless=False required for booking history; public search works without login)
**URL:** https://www.angi.com
**Configuration:** Set zip code and Chrome profile path in `~/Documents/aireadylife/vault/home/config.md`

## Data Available

- **Pro listings by service type and zip code:** Name, star rating (1–5), number of reviews, years in business, service area
- **License and background check status:** Angi verifies state contractor licenses and runs background checks — look for "Verified License" and "Background Checked" badges
- **Review summaries:** Customer reviews with work quality, communication, and value scores
- **Cost guide data:** National and local average price ranges for specific services (e.g., "HVAC tune-up: $75–$150 national average")
- **Quote request history:** If logged in, shows past service requests and pro responses
- **Pro badges:** Super Service Award indicates consistently top-rated by customers year over year
- **Angi Guaranteed:** Angi offers a work guarantee on some bookings through the platform (up to $2,500 coverage for unsatisfactory work)

## Configuration

Add to `~/Documents/aireadylife/vault/home/config.md`:
```
home_zip_code: "55344"
angi_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
angi_email: YOUR_ANGI_EMAIL   # optional; for booking history access
```

## Key Workflows

**Finding a contractor for a maintenance task:** Search by service type (e.g., "HVAC maintenance", "gutter cleaning", "roof inspection") and zip code. Filter to pros with 4+ stars and 20+ reviews as a baseline. Check for verified license status. Read 3–5 recent reviews to assess communication quality and punctuality — not just work quality. Request 3 quotes from top-rated candidates and compare.

**Using cost guides for budget estimates:** Angi's cost guide (angi.com/costs) provides national and regional average costs for hundreds of home service types. Use these to validate vendor quotes — a gutter cleaning quote of $500 on a single-story home ($75–$200 national average) deserves an explanation.

**Vetting a contractor before hiring:** For any repair above $500, verify: (1) license is valid in your state via Angi or your state licensing board, (2) they carry general liability insurance (ask for certificate of insurance), (3) they have at least 15+ reviews with consistent 4+ star ratings, (4) recent reviews (within 6 months) match the service category you need.

## Notes

- Requires headless=False for quote request submission and booking history — login uses session cookies
- Public search (contractor listings and ratings) works without an account
- Angi's price estimate before booking (their "Instant Booking" feature) provides a flat-rate quote for some services — useful baseline even if you intend to hire independently
- Thumbtack is the primary alternative; running a parallel search on both platforms for critical repairs is recommended

## Used By

- `aireadylife-home-seasonal-maintenance` — find top-rated contractors for scheduled seasonal tasks (furnace inspection, gutter cleaning, roof inspection)
- `aireadylife-home-flag-maintenance-item` — search for qualified contractor for a newly flagged repair when no vendor is assigned in config

## Vault Output

`~/Documents/aireadylife/vault/home/00_current/` (vendor contact info logged back to the relevant maintenance item)
