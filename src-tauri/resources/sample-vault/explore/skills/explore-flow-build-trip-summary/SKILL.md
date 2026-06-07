---
name: aireadylife-explore-flow-build-trip-summary
type: flow
trigger: called-by-op
description: >
  Generates a trip brief for an upcoming trip covering destination, dates, lodging, transport,
  total budget, and open booking items.
---

# aireadylife-explore-build-trip-summary

**Trigger:** Called by `aireadylife-explore-op-monthly-sync`, `aireadylife-explore-op-trip-planning-review`
**Produces:** Structured trip brief with booking status table and budget summary returned to calling op

## What It Does

This flow reads a specific trip record from vault/explore/00_current/ and assembles a complete, structured trip summary. It is called by any op that needs a current picture of a specific trip's readiness — not a general overview, but a full accounting of every booking component for a named trip.

**Trip record reading:** The flow reads the trip record file from vault/explore/00_current/{YYYY-destination-trip.md}. Trip records have a consistent schema: destination, departure date, return date, travelers, purpose (leisure, business, family), total estimated budget with category breakdown (flights, accommodation, transportation, food, activities, insurance, other), current booking status per category (booked/not booked/partial), and confirmation numbers for booked items.

**Booking status table:** For each category in the trip record, the flow produces a status row: category name, status (✅ Booked / ⚠️ Partially Booked / ⬜ Not Booked / ➖ Not Applicable), confirmation number or provider name if booked, and any relevant notes (cancellation policy, deposit deadline, last day for free cancellation). Categories assessed: outbound flights, return flights, accommodation (broken by date range if multiple stays), car rental or ground transportation, travel insurance, activities or experience reservations, and any trip-specific items (e.g., ferry reservations, train passes).

**Budget calculation:** The flow reads the budget breakdown from the trip record and calculates: total estimated trip cost (sum of all categories), total already paid (confirmed bookings with payment records), outstanding balance (total - paid), and upcoming payment deadlines (items with a future payment due date). If any category's actual cost exceeds the estimated budget by 15% or more, it flags the overrun.

**Booking deadline flags:** Some booking components have deadline-sensitive pricing or availability: some hotels have early-bird rates that expire, some experiences require advance booking weeks in advance, some visa applications require minimum lead times. If the trip record includes any booking deadlines in the next 30 days, the flow flags them as 🔴 (within 7 days) or 🟡 (8-30 days).

## Steps

1. Receive trip identifier (destination name or file path) from calling op
2. Read trip record from vault/explore/00_current/{trip-file.md}
3. Parse all booking categories and their current status
4. For each booked item: extract confirmation number, provider, payment status
5. For each unbooked item: note status and any booking deadline
6. Calculate budget totals: estimated / paid / outstanding
7. Flag categories with actual cost 15%+ over estimate
8. Flag booking deadlines in the next 30 days by urgency tier
9. Return structured trip summary to calling op

## Input

- ~/Documents/aireadylife/vault/explore/00_current/{trip-file.md}
- `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records for trend comparison

## Output Format

Returns structured data to calling op:
```
{
  trip: { destination: "Tokyo, Japan", departure: "2026-11-15", return: "2026-11-25", travelers: ["Name1"] },
  booking_status: [
    { category: "Outbound Flights", status: "booked", confirmation: "ABC123", provider: "United Airlines", notes: "Departs ORD 14:30 → NRT" },
    { category: "Return Flights", status: "booked", confirmation: "ABC123", notes: "Return NRT → ORD" },
    { category: "Accommodation (Nov 15-20)", status: "booked", confirmation: "HK987", provider: "Shinjuku Hotel", notes: "Free cancel until Nov 1" },
    { category: "Accommodation (Nov 20-25)", status: "not_booked", deadline: null, notes: "Book Kyoto accommodation" },
    { category: "Travel Insurance", status: "not_booked", deadline: "2026-11-14", urgency: "🟡" },
    { category: "Japan Rail Pass", status: "not_booked", deadline: "2026-11-10", urgency: "🔴" }
  ],
  budget: { estimated: 4200, paid: 1850, outstanding: 2350, overruns: [] },
  deadlines: [
    { item: "Japan Rail Pass", deadline: "2026-11-10", urgency: "🔴", note: "Must be purchased before arrival — not available in Japan" },
    { item: "Travel Insurance", deadline: "2026-11-14", urgency: "🟡" }
  ]
}
```

## Configuration

No configuration required. Trip record file format determines parsing.

## Error Handling

- **Trip record missing:** Cannot run. Return error to calling op: "Trip record not found in vault/explore/00_current/. Run explore-task-log-trip to create one."
- **Budget section missing from trip record:** Return booking status without budget summary; note "Add budget breakdown to trip record for budget tracking."
- **Booking status field missing for a category:** Default to "Not Booked" status; do not skip the category in the table.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/explore/00_current/{trip-file.md}
- Writes to: none (returns data to calling op)
