---
name: aireadylife-explore-task-log-trip
type: task
cadence: as-planned
description: >
  Records a new trip to vault/explore/00_current/ with destination, dates, purpose, total budget,
  booking status, and companions.
---

# aireadylife-explore-log-trip

**Cadence:** As-planned (when a new trip is being planned or booked)
**Produces:** New trip record in ~/Documents/aireadylife/vault/explore/00_current/YYYY-{destination}-trip.md

## What It Does

This task creates or updates the canonical trip record for a specific trip. The trip record is the single source of truth for that trip — it feeds the monthly booking status check, the pre-trip readiness review, the budget tracking, and the preparation checklist. Keeping it accurate is what allows every other explore skill to work correctly for that trip.

**New trip creation:** When a new trip is being planned, the task asks for: destination (city and country), departure date, return date, travelers (names from vault/explore/config.md plus any guests), trip purpose (leisure, business, family visit, honeymoon, adventure, other), total planned budget (ask for a dollar amount or let the user leave it as TBD), and for each standard booking category — whether it's been booked, is in progress, or hasn't been started. For booked items: asks for the confirmation number and provider name. Booking categories: outbound flights, return flights (or round trip), accommodation (can be multiple stays if multi-city), car rental, travel insurance, activities/experiences (optional), and any trip-specific requirements (rail passes, ferry tickets, etc.).

**Budget breakdown:** Records the budget breakdown by category: flights estimate, accommodation estimate, car rental estimate, food/restaurants estimate, activities estimate, travel insurance estimate, and a miscellaneous buffer (typically 10-15% of total). The actual-vs-estimated tracking becomes useful over time as the user compares trip costs against initial estimates.

**Existing trip update:** If a trip record already exists in vault/explore/00_current/ for the same destination and approximate dates, the task updates the existing record rather than creating a duplicate. Update triggers: new booking confirmation received, budget estimate revised, additional travelers added, or booking status changed for any category.

**Post-trip logging:** When called after a trip has returned (the return date has passed), the task can archive the trip to vault/explore/01_prior/YYYY/ and log a brief trip summary (total actual cost, highlights, recommendations for future visits). This builds a personal travel history archive.

## Steps

1. Receive trip details from user: destination, dates, purpose, travelers, initial booking status
2. Generate trip file name: YYYY-{destination-slug}-trip.md
3. Check vault/explore/00_current/ for existing file matching same destination + approximate dates
4. If existing file: update with new information; note update date
5. If no existing file: create new trip record with full schema
6. For each booking category: record current status (booked/not booked), confirmation if booked, provider
7. Record budget breakdown by category
8. Append new entry to vault/explore/open-loops.md noting unbooked critical items
9. Return confirmation with file path and summary of what was recorded

## Input

- Trip data from user (destination, dates, travelers, booking status, budget)
- ~/Documents/aireadylife/vault/explore/00_current/ (for duplicate check and update)
- ~/Documents/aireadylife/vault/explore/config.md (for traveler names and preferences)

## Output Format

Trip file: ~/Documents/aireadylife/vault/explore/00_current/YYYY-{destination}-trip.md

```markdown
---
destination: Tokyo, Japan
country: Japan
departure: 2026-11-15
return: 2026-11-25
purpose: leisure
travelers:
  - Name1
trip_added: 2026-04-13
last_updated: 2026-04-13
---

# Tokyo, Japan — November 2026

**Dates:** November 15-25, 2026 (11 nights)
**Purpose:** Leisure
**Travelers:** Name1

## Booking Status
| Category             | Status    | Provider / Conf         | Notes                          |
|----------------------|-----------|-------------------------|--------------------------------|
| Outbound Flights     | ✅ Booked | United — Conf: ABC123   | ORD→NRT, departs 14:30         |
| Return Flights       | ✅ Booked | United — Conf: ABC123   | NRT→ORD                        |
| Hotel (Nov 15-20)    | ✅ Booked | Shinjuku Hotel — HK987  | Free cancel until Nov 1        |
| Hotel (Nov 20-25)    | ⬜ Needed | —                       | Need Kyoto accommodation       |
| Travel Insurance     | ⬜ Needed | —                       | Book before departure          |
| Japan Rail Pass      | ⬜ Needed | —                       | Buy before arriving Japan      |

## Budget
| Category         | Estimated  | Actual     |
|------------------|------------|------------|
| Flights          | $1,400     | $1,380     |
| Accommodation    | $1,200     | $650 (partial)|
| Ground Transport | $200       | —          |
| Food             | $600       | —          |
| Activities       | $400       | —          |
| Travel Insurance | $120       | —          |
| Buffer (10%)     | $392       | —          |
| **TOTAL**        | **$4,312** | **$2,030 paid** |

## Notes
[User notes about the trip]
```

## Configuration

No configuration required beyond vault/explore/config.md with traveler names.

## Error Handling

- **Departure date in the past:** Create trip record; note "This trip has already departed — use this record for archiving post-trip details."
- **Destination not recognized:** Create trip record with destination as entered; do not require standardized destination format.
- **Budget not provided:** Record as "TBD" — the record can be updated when budget is known.

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/config.md
- Writes to: ~/Documents/aireadylife/vault/explore/00_current/YYYY-{destination}-trip.md, ~/Documents/aireadylife/vault/explore/open-loops.md
