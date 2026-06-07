---
name: aireadylife-explore-op-document-check
type: op
cadence: quarterly
description: >
  Quarterly travel document audit that checks passport, Global Entry, TSA PreCheck, and vaccination
  records for expiration within 12 months. Triggers: "document check", "passport check",
  "travel documents", "Global Entry renewal".
---

# aireadylife-explore-document-check

**Cadence:** Quarterly (1st of January, April, July, October)
**Produces:** Travel document status report at ~/Documents/aireadylife/vault/explore/00_current/

## What It Does

The quarterly document check is a dedicated deep audit of every travel document in the vault — more thorough than the monthly sync's document pass. Where the monthly sync applies thresholds and flags items meeting the standard criteria, the quarterly check also compares document validity against all wishlist destinations in vault/explore/00_current/ (not just booked trips), ensuring the user's passport will be valid for destinations they're planning to visit in the next 12-18 months even if those trips aren't booked yet.

**Document inventory audit:** The op calls `explore-flow-check-travel-docs` with a 12-month horizon. For each document in vault/explore/00_current/, it checks: current expiration date, days until expiration, applicable renewal lead time, and the recommended action threshold. Documents evaluated: primary passport (all travelers in vault/explore/config.md), secondary passports if any, Global Entry membership, TSA PreCheck, Nexus/Sentri cards, active visas (checking both the validity window and the maximum stay), vaccination records (Yellow Fever valid 10 years after vaccination; some others; applicable to wishlist countries with vaccination requirements), and any travel-specific permits or special authorizations.

**Wishlist validation:** For each destination in vault/explore/00_current/, the op checks: (1) will the user's passport be valid for at least 6 months beyond a hypothetical 2-week trip to that destination in the next 18 months? (2) does the destination require a visa for the user's citizenship, and if so, what is the lead time and process? (3) are there vaccination requirements? This forward-looking check prevents the situation where the user decides to book a bucket-list trip and discovers their passport expires 4 months after return and can't be renewed in time.

**Renewal action plan:** For any document flagged within the renewal window, the op generates a specific action plan with: the exact renewal process (U.S. State Department for passports, CBP TTP program for Global Entry, TSA for PreCheck), the current processing time estimate, the recommended submission date (today's date plus buffer for the processing time), the cost, and the direct URL or phone number for starting the process.

## Triggers

- "document check"
- "passport check"
- "travel documents"
- "Global Entry renewal"
- "TSA PreCheck renewal"
- "quarterly travel audit"

## Steps

1. Verify vault/explore/config.md and vault/explore/00_current/ exist
2. Call `explore-flow-check-travel-docs` with 12-month horizon and all travelers
3. For each document: check expiry date; calculate days remaining; assign urgency tier
4. Apply renewal lead times to determine recommended renewal start dates
5. Read vault/explore/00_current/ for planned destinations; check passport validity against each
6. For wishlist destinations: check visa requirements for user's citizenship; check vaccination requirements
7. For each document meeting flag criteria: call `explore-task-flag-expiring-document`
8. Generate renewal action plan for each flagged document
9. Write document status report to vault/explore/00_current/document-audit-YYYY-MM-DD.md
10. Call `explore-task-update-open-loops` to write all new flags
11. Return formatted document status report to user

## Input

- ~/Documents/aireadylife/vault/explore/00_current/ (all travel documents)
- ~/Documents/aireadylife/vault/explore/00_current/ (planned destinations for forward validation)
- `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/explore/config.md (travelers, citizenship)

## Output Format

```
# Travel Document Audit — [Date]

## Document Status
| Document          | Person    | Expires      | Days Left | Status        | Action Required              |
|-------------------|-----------|--------------|-----------|---------------|------------------------------|
| US Passport       | [Name]    | Feb 14, 2027 | 307       | ✅ Valid       | Renew by Aug 2026            |
| Global Entry      | [Name]    | Mar 1, 2026  | 52        | 🔴 Renew now  | Submit renewal at cbp.gov/ttp|
| TSA PreCheck      | [Name]    | Jan 15, 2028 | 642       | ✅ Valid       | No action needed             |
| Yellow Fever vax  | [Name]    | Aug 2029     | —         | ✅ Valid       | Valid until Aug 2029         |

## Wishlist Destination Check
| Destination    | Passport OK? | Visa Required?          | Vaccinations?      |
|----------------|--------------|-------------------------|--------------------|
| Japan          | ✅ Valid     | No (90-day visa-free)   | None required      |
| India          | ✅ Valid     | Yes — e-visa ($25, 72h) | Hep A recommended  |
| Kenya          | ✅ Valid     | Yes — e-visa ($51)      | Yellow Fever ✅     |

## Renewal Action Plans
### Global Entry — Submit by [Date]
1. Visit cbp.gov/ttp (Trusted Traveler Programs)
2. Log in and submit renewal application — processing: 2-6 months
3. Schedule in-person interview after conditional approval (3-12 month wait at most airports)
4. Cost: $100 (often reimbursed by premium credit cards — check your card benefits)
```

## Configuration

Required in vault/explore/config.md:
- `travelers` — each person's name, passport number, expiry date, citizenship
- `loyalty_programs` — Global Entry/TSA PreCheck membership details
- Document warning thresholds (optional; defaults used if not set)

## Error Handling

- **vault/explore/00_current/ empty:** Note "No documents on file. Create passport.md in vault/explore/00_current/ with your passport expiry date to enable document tracking."
- **Citizenship not configured in config.md:** Cannot check visa requirements for wishlist destinations — note "Add citizenship to vault/explore/config.md for visa requirement checking."
- **Wishlist destination visa rules unknown:** Note "Verify current visa requirements at travel.state.gov for [destination]" rather than guessing.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/explore/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/00_current/, ~/Documents/aireadylife/vault/explore/config.md
- Writes to: ~/Documents/aireadylife/vault/explore/00_current/document-audit-YYYY-MM-DD.md, ~/Documents/aireadylife/vault/explore/open-loops.md
