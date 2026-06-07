---
name: aireadylife-explore-op-monthly-sync
type: op
cadence: monthly
description: >
  Monthly explore sync. Checks all travel document expiration dates and surfaces upcoming trips
  requiring preparation. Triggers: "explore monthly sync", "sync travel documents", "check passport".
---

# aireadylife-explore-monthly-sync

**Cadence:** Monthly (1st of month)
**Produces:** Document expiry alerts and upcoming trip preparation checklist; updates vault/explore/00_current/state.md

## What It Does

The monthly sync is the core maintenance operation for the explore domain. It runs on the 1st of each month to ensure the user always has a current picture of document validity and upcoming trip readiness — before any trip-related emergency can develop.

**Document check phase:** The op calls `explore-flow-check-travel-docs` to read every travel document in vault/explore/00_current/ and validate its expiration against the configured warning thresholds. Standard thresholds: passport expiry alert at 12 months out (🟢 monitor), 9 months out (🟡 start renewal), 6 months out (🔴 renew immediately). Global Entry at 12 months before expiry (start renewal process; interview wait times are long). TSA PreCheck at 6 months before expiry. The document check also validates each document against any upcoming booked trips in vault/explore/00_current/ — applying the 6-month rule for passport validity against the trip return date, checking visa requirements for non-visa-free destinations, and verifying vaccination requirements for countries with mandatory vaccinations (Yellow Fever requirements, etc.).

**Upcoming trip preparation phase:** For any trip booked in vault/explore/00_current/ with a departure date within the next 90 days, the op calls `explore-flow-build-trip-summary` to produce a booking status check. The summary shows which components are booked (flights, hotel, car, travel insurance, activities) and which are still unbooked. Unbooked items with approaching booking deadlines (e.g., the hotel cancellation-free rate expires in 3 days) are flagged as 🔴 urgent. Unbooked items with no deadline but the trip is within 60 days are flagged 🟡. Items with plenty of time or optional bookings are flagged 🟢.

**Loyalty program check:** Reads loyalty program last-activity dates from vault/explore/config.md. Flags any account approaching the inactivity expiry window: 90 days before potential expiry (🟡) and 30 days before (🔴).

After both phases complete, the op writes open-loop flags for any action items discovered, updates vault/explore/00_current/state.md with the current explore domain status, and produces the monthly explore brief.

## Triggers

- "explore monthly sync"
- "sync travel documents"
- "check passport"
- "explore update"
- "travel update"
- "monthly travel check"

## Steps

1. Verify vault/explore/config.md exists; if missing, stop and prompt setup
2. Call `explore-flow-check-travel-docs` for full document inventory validation
3. For each document expiring within warning thresholds: call `explore-task-flag-expiring-document`
4. Read vault/explore/00_current/ for any trips with departure within 90 days
5. For each upcoming trip: call `explore-flow-build-trip-summary` to get booking status
6. Flag unbooked items: 🔴 if trip within 30 days, 🟡 if within 60 days, 🟢 if within 90 days
7. Read loyalty program last-activity dates from vault/explore/config.md
8. Flag accounts within 90-day and 30-day inactivity expiry windows
9. Call `explore-task-update-open-loops` with all new flags
10. Update vault/explore/00_current/state.md with current document status, upcoming trip status, loyalty status
11. Write monthly brief to vault/explore/02_briefs/YYYY-MM-explore-brief.md
12. Return summary to user

## Input

- ~/Documents/aireadylife/vault/explore/00_current/ (passport, Global Entry, TSA PreCheck, visas, vaccinations)
- ~/Documents/aireadylife/vault/explore/00_current/ (booked trips)
- `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/explore/config.md (travelers, loyalty programs, citizenship)

## Output Format

```
# Explore Monthly Sync — [Month YYYY]

## Travel Documents
| Document          | Person     | Expires      | Status                          |
|-------------------|------------|--------------|----------------------------------|
| Passport          | [Name]     | Feb 14, 2027 | ✅ Valid (10 months)              |
| Global Entry      | [Name]     | Mar 1, 2026  | ⚠️ Renew now (11 months — start!) |
| TSA PreCheck      | [Name]     | Jan 15, 2028 | ✅ Valid (21 months)              |

## Upcoming Trips
### [Destination] — [Departure Date] ([N] days away)
| Item              | Status    | Notes                              |
|-------------------|-----------|------------------------------------|
| Flights           | ✅ Booked | Conf: [code]                       |
| Hotel             | ✅ Booked | [Hotel name], [check-in/out dates] |
| Travel Insurance  | ⚠️ Missing | Book before departure              |
| Car Rental        | ⬜ Not booked | Optional                         |

## Loyalty Program Watch
| Program               | Balance  | Last Activity | Expiry Risk          |
|-----------------------|----------|---------------|----------------------|
| United MileagePlus    | 45,200mi | Jan 15, 2026  | ⚠️ Expiry Apr 2026 — act within 90 days |
| Marriott Bonvoy       | 12,000pts| Dec 2025      | ✅ Active             |

## Actions Required
1. [Document or booking action — specific next step]
2. [Loyalty action — specific next step]
```

## Configuration

Required in vault/explore/config.md:
- `travelers` — list of traveler names with passport details
- `citizenship` — for visa requirement lookup
- `loyalty_programs` — program names, account numbers, last-activity dates
- Document expiry warning thresholds (or defaults used)

## Error Handling

- **vault/explore/00_current/ missing or empty:** Note "No travel documents on file. Add your passport details to vault/explore/00_current/ to enable document tracking."
- **No upcoming trips:** Note "No trips within 90 days. Upcoming trip preparation section skipped."
- **Loyalty program last-activity date missing:** Cannot calculate expiry risk — note "Add last-activity dates to vault/explore/config.md for loyalty program monitoring."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/config.md
- Writes to: ~/Documents/aireadylife/vault/explore/00_current/state.md, ~/Documents/aireadylife/vault/explore/02_briefs/YYYY-MM-explore-brief.md, ~/Documents/aireadylife/vault/explore/open-loops.md
