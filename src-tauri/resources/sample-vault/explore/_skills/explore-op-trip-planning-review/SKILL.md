---
name: aireadylife-explore-op-trip-planning-review
type: op
cadence: on-demand
description: >
  On-demand trip planning review that checks visa requirements, passport validity, travel insurance,
  vaccinations, and key booking deadlines for an upcoming trip. Triggers: "trip planning",
  "travel prep", "plan my trip", "travel checklist".
---

# aireadylife-explore-trip-planning-review

**Cadence:** On-demand (before each upcoming trip, or when planning a new trip)
**Produces:** Trip readiness report at ~/Documents/aireadylife/vault/explore/00_current/YYYY-{destination}-trip.md

## What It Does

The trip planning review is the comprehensive pre-trip readiness check — a full assessment of whether the user is ready to take a specific trip and what still needs to be done to get there. It is run on-demand, typically when a trip is first booked or when departure is 60-90 days out.

**Document readiness check:** Calls `explore-flow-check-travel-docs` for the specific trip's destination and dates. For each traveler in vault/explore/config.md, checks: passport validity against the 6-month rule for the destination (passport must be valid 6+ months beyond the return date, or 3+ months for Schengen), visa status (is a visa required for this destination? if yes, has it been applied for?), and vaccination requirements (are any mandatory or recommended vaccinations needed for this destination?). Any document issue that would prevent travel is flagged as 🔴 — this is the most important output of the entire review.

**Booking status check:** Calls `explore-flow-build-trip-summary` to read the trip record from vault/explore/00_current/ and produce a booking status table. Categories checked: outbound flights (booked / not booked), return flights (booked / not booked, or same confirmation as outbound), accommodation (booked / not booked for every night of the trip), ground transportation at destination (rented car / transfers / trains — booked or not), travel insurance (purchased / not purchased — for international trips, this is flagged 🟡 until confirmed and 🔴 if departure is within 30 days with no insurance), and activities or experience reservations (if applicable — popular restaurants, tours, or attractions that require advance booking).

**Budget summary:** Reads the trip's budget breakdown from vault/explore/00_current/ and compares total estimated cost against amount already paid. Flags if the total trip cost would exceed the user's configured travel budget (from vault/explore/config.md). Lists upcoming payment deadlines (e.g., hotel balance due 7 days before arrival, car rental remaining payment due at pickup).

**Preparation timeline:** Based on the departure date and current booking status, generates a preparation timeline: what needs to be done now (within 7 days), what needs to be done soon (within 30 days), and what can wait until closer to departure. This timeline is added to vault/explore/open-loops.md so preparation items surface in weekly agenda scans.

## Triggers

- "trip planning"
- "travel prep"
- "plan my trip"
- "travel checklist"
- "trip review"
- "am I ready for [destination]"
- "pre-trip check"

## Steps

1. Identify which trip to review (ask if ambiguous or multiple trips exist)
2. Read trip record from vault/explore/00_current/ for the specified trip
3. If no trip record exists: run `explore-task-log-trip` to create one before proceeding
4. Call `explore-flow-check-travel-docs` with trip destination, dates, and all traveler passports
5. Flag any document issue that would prevent travel as 🔴 critical
6. Call `explore-flow-build-trip-summary` for booking status and budget summary
7. Flag travel insurance as 🟡 if not confirmed, 🔴 if departure <30 days
8. Generate preparation timeline: now/soon/later phases with specific action items
9. Call `explore-task-update-open-loops` to write preparation items to vault/explore/open-loops.md
10. Write trip readiness report to vault/explore/00_current/YYYY-{destination}-trip.md (update existing)
11. Return formatted trip readiness report to user

## Input

- ~/Documents/aireadylife/vault/explore/00_current/ (trip record)
- ~/Documents/aireadylife/vault/explore/00_current/ (traveler documents)
- `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/explore/config.md (travelers, citizenship, travel budget)

## Output Format

```
# Trip Readiness: [Destination] — [Departure Date]

## Document Readiness
| Person    | Passport Valid? | Visa Status           | Vaccinations        |
|-----------|-----------------|-----------------------|---------------------|
| [Name]    | ✅ Valid through [date] | No visa required | None required  |
| [Name]    | ✅ Valid through [date] | e-visa needed — apply online ($25, 72h) | Yellow Fever ✅ |

## Booking Status
| Category          | Status    | Details                            | Deadline/Notes       |
|-------------------|-----------|------------------------------------|----------------------|
| Outbound Flights  | ✅ Booked | [Airline] Conf: [code]            |                      |
| Return Flights    | ✅ Booked | [Same confirmation]                |                      |
| Hotel — Nights 1-3| ✅ Booked | [Hotel name] — Conf: [code]       |                      |
| Hotel — Nights 4-7| ⬜ Not booked | [Needed]                       | Book soon            |
| Travel Insurance  | ⚠️ Missing | International trip — book now     | 🔴 Departure in 45d  |
| Car Rental        | ⬜ Not booked | Optional                        |                      |

## Budget Summary
Total estimated trip cost: $[N]
Already paid: $[N]
Outstanding: $[N]
[Budget flag if over configured limit]

## Preparation Timeline
**Do now (within 7 days):**
- Apply for [e-visa] at [URL] — takes 72 hours
- Purchase travel insurance — [recommendation or link]

**Do soon (8-30 days before departure):**
- Book hotel for nights 4-7
- Confirm car rental (optional)

**Closer to departure:**
- Online check-in (48 hours before flight)
- Download airline boarding pass app
- Confirm hotel check-in time and early luggage drop if needed
```

## Configuration

Required in vault/explore/config.md:
- `travelers` — with passport expiry dates and citizenship
- `travel_budget_limit` — optional; for budget flag
- Trip record must exist in vault/explore/00_current/ or be created during this op

## Error Handling

- **No trip record found:** Ask user for trip details (destination, dates, travelers) then call explore-task-log-trip to create the record before proceeding.
- **Document missing from vault (e.g., no passport record):** Note "No passport record found for [traveler] — add to vault/explore/00_current/passport.md to enable validity checking."
- **Destination visa requirements unknown:** Note "Verify current visa requirements at travel.state.gov or the destination country's embassy website" rather than guessing.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/config.md
- Writes to: ~/Documents/aireadylife/vault/explore/00_current/YYYY-{destination}-trip.md, ~/Documents/aireadylife/vault/explore/open-loops.md
