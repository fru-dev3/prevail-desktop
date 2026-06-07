---
name: aireadylife-real-estate-task-log-listing
type: task
cadence: as-found
description: >
  Saves a listing of interest to vault/real-estate/00_current/ with address, price, beds/baths,
  sqft, price/sqft, days on market, Zestimate, list-to-Zestimate ratio, user notes, Zillow/Redfin
  link, and status. Used to track listings over time and flag price reductions.
---

# aireadylife-real-estate-log-listing

**Cadence:** As-found (when a listing worth tracking is identified)
**Produces:** Listing record in `~/Documents/aireadylife/vault/real-estate/00_current/`

## What It Does

This task captures a specific property listing in the vault so it can be tracked over time and referenced in future market scans, the monthly brief, and any buy vs. rent analysis run against a specific address. The record serves as a persistent watchlist entry — not just a bookmark, but a structured data point that accumulates context as the listing evolves.

Each record captures the full property address (used as the record slug for consistent referencing), the list price at time of saving, bedroom and bathroom count, square footage, price per square foot (calculated automatically), days on market at the time of saving, the Zillow Zestimate or Redfin Estimate if available (to compare against list price — a listing priced 10% above estimate warrants scrutiny), and the list-to-estimate ratio. Personal notes are captured in a freeform field: pros (natural light, good schools, near transit), concerns (backing a highway, 1970s roof, small lot), and neighborhood observations.

The Zillow or Redfin URL is stored so the listing can be re-checked quickly. The status field tracks the listing's lifecycle across five stages: watching (saved, no action taken), toured (visited the property), offer-made (formal offer submitted), passed (decided not to pursue), and sold (listing went under contract or closed). Tracking status matters because knowing that a listing you passed on sold in 3 days at list price is a market signal for how competitive the neighborhood is.

On subsequent monthly syncs, the market scan flow checks all listings in this folder with status "watching" or "toured" and updates their DOM count and notes any price changes. A price reduction of 5% or more since the listing was saved is flagged as a potential opportunity in the next review brief.

## Steps

1. Collect property address, list price, beds, baths, sqft from user or provided URL
2. Calculate price per square foot = list price ÷ sqft
3. Look up Zestimate or Redfin Estimate for the address; calculate list-to-estimate ratio
4. Collect user notes: pros, concerns, neighborhood observations
5. Set initial status = "watching"; record date saved and days on market at save date
6. Store Zillow or Redfin URL
7. Write record to `~/Documents/aireadylife/vault/real-estate/00_current/{address-slug}.md`
8. Confirm record saved; tell user to update status manually as listing progresses

## Input

User-provided: property address (or URL), price, beds/baths, sqft, personal notes
Optional: Zillow/Redfin URL (auto-populated if URL is provided as input)

## Output Format

```markdown
# Listing: {Full Address}

**Saved:** YYYY-MM-DD
**Status:** watching

## Details
- List Price: $X
- Beds/Baths: X/X
- Sqft: X,XXX
- Price/Sqft: $XXX
- Days on Market (at save): XX
- Zestimate: $X | List-to-Estimate: X%
- URL: [Zillow/Redfin link]

## Notes
**Pros:** [user notes]
**Concerns:** [user notes]
**Neighborhood:** [user notes]

## Status History
| Date | Status | DOM | Price | Notes |
| YYYY-MM-DD | watching | XX | $X | Saved |
```

## Configuration

No additional config required beyond the vault existing. Uses `listing_source` from config.md to determine which estimate to look up (Zestimate vs. Redfin Estimate).

## Error Handling

- If address cannot be found on Zillow/Redfin: save the record without estimate; note "No estimate available"
- If sqft not provided: save record without price/sqft; prompt user to add sqft when available
- If a listing with the same address already exists: append a new status history row instead of creating a duplicate

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/real-estate/config.md` (listing_source preference)
- Writes to: `~/Documents/aireadylife/vault/real-estate/00_current/{address-slug}.md`
