---
name: aireadylife-explore-flow-check-travel-docs
type: flow
trigger: called-by-op
description: >
  Verifies all travel documents are valid for upcoming trips, including the 6-month passport
  validity rule and vaccination requirements for wishlist destinations.
---

# aireadylife-explore-check-travel-docs

**Trigger:** Called by `aireadylife-explore-op-document-check`, `aireadylife-explore-op-monthly-sync`, `aireadylife-explore-op-trip-planning-review`
**Produces:** Document validity report with per-document expiration status and renewal flags returned to calling op

## What It Does

This flow reads the full travel document inventory from vault/explore/00_current/ and validates each document against two sets of requirements: the absolute expiry thresholds (the document's calendar expiration date vs. today) and the trip-specific requirements (the document's validity vs. upcoming trip dates with applicable rules applied).

**Document inventory reading:** The flow reads all files in vault/explore/00_current/: passport.md (one per traveler), global-entry.md, tsa-precheck.md, nexus.md if applicable, visa files in vault/explore/00_current/visas/, and vaccination records in vault/explore/00_current/vaccinations/. For each document, it reads the key fields: document type, person name, expiration date, issuing country, and document number.

**Absolute expiry validation:** For each document, the flow calculates days until expiry and assigns a status tier based on document type. Passport: 🟢 if 12+ months remaining, 🟡 if 6-12 months ("Start renewal process — some countries may reject"), 🔴 if under 6 months ("Renew immediately — many countries will deny entry"). Global Entry: 🟢 if 18+ months remaining, 🟡 if 12-18 months ("Submit renewal — interviews booked months in advance"), 🔴 if under 12 months ("Submit renewal now"). TSA PreCheck: 🟢 if 6+ months remaining, 🟡 if 3-6 months, 🔴 if under 3 months. Vaccination records: 🟢 if within validity period, 🔴 if expired.

**Trip-specific validation:** When called with trip context (destination country, departure date, return date, travelers), the flow applies destination-specific rules. Passport: applies the 6-month rule for most countries (passport must be valid 6+ months beyond the return date) or the 3-month rule for Schengen countries (3+ months beyond return date) or the stay-validity rule for select countries (passport just needs to cover the stay). Visa: checks whether the user's citizenship requires a visa for the destination country; if yes, checks whether an appropriate visa has been obtained (reading vault/explore/00_current/visas/ for any matching visa). Vaccinations: checks whether the destination country requires or strongly recommends specific vaccinations; mandatory requirements (like Yellow Fever for some African and South American countries) are flagged as 🔴 if the vaccination record is missing or expired.

**Renewal lead time annotation:** For every flagged document, the flow appends the document-type-specific renewal lead time: US passport standard 10-13 weeks / expedited 4-6 weeks / emergency 2-4 days; Global Entry 2-6 months (plus interview wait); TSA PreCheck 3-5 weeks. This allows the calling op to communicate a realistic timeline rather than just "renew."

## Steps

1. Read all files in vault/explore/00_current/ (passports, Global Entry, TSA PreCheck, visas, vaccinations)
2. For each document: parse expiry date; calculate days remaining
3. Assign absolute expiry status tier per document type thresholds
4. If trip context provided: apply destination-specific passport validity rules (6-month / 3-month / stay-validity)
5. Check visa requirements for destination country against user's citizenship
6. Check whether applicable visa exists in vault/explore/00_current/visas/
7. Check vaccination requirements for destination; verify against vault/explore/00_current/vaccinations/
8. For each flagged document: append renewal lead time and specific renewal action
9. Return full validation report to calling op

## Input

- ~/Documents/aireadylife/vault/explore/00_current/ (all travel documents)
- `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records for trend comparison
- Trip context from calling op (destination, departure date, return date, travelers) — optional for general check

## Output Format

Returns structured validation report to calling op:
```
{
  travelers: [
    {
      name: "Name",
      passport: { expires: "2027-02-14", days_remaining: 307, status: "🟢", trip_valid: true, trip_valid_note: "Valid 6+ months beyond return" },
      global_entry: { expires: "2026-03-01", days_remaining: 52, status: "🔴", renewal_lead_time: "2-6 months + interview", action: "Submit renewal at cbp.gov/ttp now" },
      tsa_precheck: { expires: "2028-01-15", days_remaining: 642, status: "🟢" }
    }
  ],
  trip_specific: {
    destination: "Japan",
    passport_rule: "6-month rule",
    passport_ok: true,
    visa_required: false,
    visa_note: "US citizens visa-free for 90 days",
    vaccinations_required: [],
    vaccinations_recommended: ["Hepatitis A", "Hepatitis B"]
  },
  flags: [
    { document: "Global Entry", person: "Name", urgency: "🔴", action: "Submit renewal immediately at cbp.gov/ttp", lead_time: "2-6 months for processing" }
  ]
}
```

## Configuration

Required in vault/explore/config.md:
- `travelers` — names and passport expiry dates
- `citizenship` — for visa requirement lookup

## Error Handling

- **Document file missing for a traveler:** Return "No [document type] record found for [traveler] — add to vault/explore/00_current/." Flag as status unknown (🟡 by default).
- **Destination visa requirements unknown to the system:** Note "Verify current visa requirements at travel.state.gov or the [country] embassy website."
- **Vaccination requirements for destination unknown:** Note "Verify current vaccination requirements at wwwnc.cdc.gov/travel/destinations or the [country] entry requirements page."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/config.md
- Writes to: none (returns data to calling op)
