---
name: aireadylife-explore-op-review-brief
type: op
cadence: monthly
description: >
  Monthly explore review brief. Compiles upcoming trips, travel document expiration alerts,
  and wishlist status into a single briefing doc.
  Triggers: "explore brief", "travel review", "trip status", "passport check".
---

# aireadylife-explore-review-brief

**Cadence:** Monthly (1st of month)
**Produces:** Monthly explore brief at ~/Documents/aireadylife/vault/explore/02_briefs/YYYY-MM-explore-brief.md

## What It Does

The explore review brief is the monthly summary of the entire travel domain — all upcoming trips, document status, wishlist aspirations, and open action items in one concise document. It is designed to be read in under 5 minutes and to give the user a complete travel situation picture at the start of each month.

The brief is structured around four sections. Section 1 — Upcoming Trips: lists all booked trips in chronological order with departure date, destination, days away, and a one-line booking status summary (e.g., "All booked" or "Travel insurance missing"). If a trip is within 30 days, it gets a 🔴 preparation urgency marker. Section 2 — Document Status: a table of all travel documents with current expiry dates and status indicators. Documents within their alert windows appear first. Section 3 — Wishlist: the top 3-5 wishlist destinations from vault/explore/00_current/, ranked by the user's configured priority, with rough budget estimates and notes on any pre-planning needed (visas, vaccination lead times). Section 4 — Action Items: all open explore action items from vault/explore/open-loops.md sorted by urgency.

## Triggers

- "explore brief"
- "travel review"
- "trip status"
- "passport check"
- "monthly travel brief"
- "explore update"

## Steps

1. Verify vault/explore/ exists and config.md is filled in
2. Read vault/explore/00_current/ for all booked trips; sort by departure date
3. For each trip within 90 days: read booking status summary; flag missing items
4. Read vault/explore/00_current/ for all travel documents; check current expiry status
5. Read vault/explore/00_current/ for top-priority destinations; read budget estimates and notes
6. Read vault/explore/open-loops.md for all active action items
7. Assemble brief in standard format
8. Write to vault/explore/02_briefs/YYYY-MM-explore-brief.md
9. Return formatted brief to user

## Input

- ~/Documents/aireadylife/vault/explore/00_current/
- ~/Documents/aireadylife/vault/explore/00_current/
- ~/Documents/aireadylife/vault/explore/00_current/
- `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/explore/open-loops.md
- ~/Documents/aireadylife/vault/explore/config.md

## Output Format

```
# Explore Brief — [Month YYYY]

## Upcoming Trips
| Trip                  | Departure    | Days Away | Booking Status          |
|-----------------------|--------------|-----------|-------------------------|
| [Destination]         | [Date]       | [N]       | ⚠️ Travel insurance missing |
| [Destination]         | [Date]       | [N]       | ✅ All booked            |

## Document Status
| Document         | Person    | Expires      | Status                     |
|------------------|-----------|--------------|----------------------------|
| US Passport      | [Name]    | Feb 14, 2027 | ✅ Valid (10 months)        |
| Global Entry     | [Name]    | Mar 1, 2026  | 🔴 Renew now               |

## Wishlist
| Destination    | Priority | Budget Est. | Notes                          |
|----------------|----------|-------------|--------------------------------|
| Japan          | High     | $3,500      | No visa needed; best Mar/Nov   |
| Italy          | Medium   | $4,500      | No visa; book 6+ months out    |
| Kenya          | Low      | $5,500      | e-visa + Yellow Fever vax req  |

## Action Items
1. 🔴 Renew Global Entry — expires Mar 1, 2026 — submit now at cbp.gov/ttp
2. ⚠️ Purchase travel insurance for [destination] trip — departure in [N] days
3. 🟢 Check hotel availability for [wishlist trip] — not urgent
```

## Configuration

Required in vault/explore/config.md:
- `travelers` — traveler details for document check
- Wishlist destinations must be in vault/explore/00_current/

## Error Handling

- **No trips booked:** Note "No upcoming trips. Add trips to vault/explore/00_current/ to track preparation status."
- **No wishlist:** Note "No wishlist destinations on file. Add destinations to vault/explore/00_current/ to track aspirational travel."
- **No documents on file:** Note "No travel documents recorded. Add passport details to vault/explore/00_current/."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/open-loops.md
- Writes to: ~/Documents/aireadylife/vault/explore/02_briefs/YYYY-MM-explore-brief.md
