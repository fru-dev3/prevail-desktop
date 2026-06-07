---
name: thumbtack
type: app
description: >
  Searches local professional listings and quote requests on Thumbtack via Playwright. Used
  by home-agent for finding contractors and obtaining competitive quotes on home maintenance
  and improvement projects. Complements Angi for multi-source quote comparison.
  Configure location and Chrome profile in vault/home/config.md.
---

# Thumbtack

**Auth:** Playwright + Chrome cookies (account required for quote requests; public search available without login)
**URL:** https://www.thumbtack.com
**Configuration:** Set zip code and Chrome profile in `~/Documents/aireadylife/vault/home/config.md`

## Data Available

- **Pro listings by service category and location:** Name, star rating, number of reviews, response rate, hire rate
- **Pro pricing estimates:** Many pros list starting prices or typical price ranges upfront — useful for quick budget checks before requesting a formal quote
- **Background check and identity verification status:** Thumbtack runs its own background check and identity verification; "Background Checked" badge indicates this was completed
- **Response time metric:** Thumbtack shows average response time per pro (e.g., "Responds within an hour") — useful for time-sensitive repairs
- **Hire rate:** Percentage of customers who hired this pro after messaging — a high hire rate combined with strong reviews is a strong quality signal
- **Project history:** If logged in, shows your past quote requests and hired pros
- **Instant estimates:** For some service categories, Thumbtack provides instant pricing based on a few questions (project size, type of work) — good for rough budget planning

## Configuration

Add to `~/Documents/aireadylife/vault/home/config.md`:
```
home_zip_code: "55344"
thumbtack_email: YOUR_THUMBTACK_EMAIL
thumbtack_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

## Key Workflows

**Getting 3 competitive quotes for a major repair:** Use Thumbtack's "Get a Quote" flow to describe the project, then select 3–5 pros to message simultaneously. Pros typically respond within a few hours to 2 days. Having 3 quotes for any repair above $500 is the standard due diligence threshold — it prevents overpaying and creates leverage for negotiation.

**Thumbtack for specialties Angi lacks:** Thumbtack has strong coverage in categories like interior painting, moving, furniture assembly, cleaning services, landscaping, and handyman work — categories where Angi's coverage can be thinner. For HVAC, plumbing, and electrical, both platforms have strong coverage in most markets.

**Vetting a pro before hiring:** Check: (1) background check status, (2) star rating (4.5+ with 30+ reviews is the target), (3) response rate and response time (a pro who doesn't respond quickly during quote won't be easier to reach for warranty callbacks), (4) read 3–5 recent reviews for consistency.

## Notes

- Requires headless=False for the quote request flow and account access
- Public search (pro listings, ratings, pricing) works without login
- Thumbtack's "Instant Match" feature sends your project to multiple pros simultaneously — saves time for simple, well-defined tasks (house cleaning, lawn mowing)
- Use Thumbtack alongside Angi for any repair above $300 — comparing quotes from both platforms maximizes price discovery

## Used By

- `aireadylife-home-seasonal-maintenance` — obtain competitive quotes from multiple pros for scheduled seasonal projects (deck sealing, driveway sealing, cleaning services)
- `aireadylife-home-flag-maintenance-item` — find contractors for flagged repair when no preferred vendor is assigned in config

## Vault Output

`~/Documents/aireadylife/vault/home/00_current/` (vendor contact info logged to the relevant maintenance item)
