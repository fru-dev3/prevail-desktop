---
name: aireadylife-records-task-flag-expiring-id
type: task
description: >
  Writes an ID expiration flag to open-loops.md with document type, holder name, expiration
  date, days until effective renewal deadline (using document-specific lead times), step-by-step
  renewal action, official renewal portal link, and cost. Urgency calibrated by document type.
---

# aireadylife-records-flag-expiring-id

**Trigger:** Called by document audit and monthly sync when a document enters its alert window
**Produces:** ID expiration flag in `~/Documents/aireadylife/vault/records/open-loops.md`

## What It Does

This task writes a detailed, actionable expiration flag whenever the document audit or monthly sync identifies an identity document entering its alert window. The flag is calibrated to the specific document type — a driver's license renewal and a Global Entry renewal require completely different lead times, costs, and process steps.

The critical distinction this task enforces is between the expiration date and the effective renewal deadline. For a passport expiring June 15, 2025, the document expires on June 15 — but the effective travel deadline is December 15, 2024 (6 months before expiration, due to international travel requirements), and the start-renewal-by date is approximately March 1, 2025 (to allow for standard 10–13 week processing). The flag uses the start-renewal-by date as the urgency date, not the expiration date, because that is when action is needed.

Document-specific flag content:

**US Passport:**
- Alert window: 12 months before expiration
- Effective travel deadline: 6 months before expiration (international); no restriction for domestic travel
- Start renewal by: 13 weeks before travel deadline (for standard) or 6 weeks (for expedited +$60)
- Cost: $130 (adult renewal, no photo), $15 execution fee if done at post office
- Process: Fill DS-82 form (adult renewal), include current passport, new passport photo (2×2 inch), payment. Mail to State Department facility or apply at passport acceptance facility. For expedited: mark envelope "EXPEDITE" and include $60 additional. Renewal can be tracked at passportstatus.state.gov.
- Link: travel.state.gov/content/travel/en/passports/need-passport/renew.html

**Driver's License:**
- Alert window: 90 days before expiration
- Start renewal by: 30 days before expiration (plenty of time for most states)
- REAL ID compliance check: if license lacks gold star, note that REAL ID is required for domestic flights as of May 7, 2025
- Cost: $20–$50 depending on state
- Process: Most states allow online renewal if no address change and vision test not due. Some states require in-person renewal every other cycle. For REAL ID, in-person is required with supporting documents: birth certificate or passport, Social Security card or W-2, and two proofs of current address.
- Link: State DMV website (vary by state — note user's state from config)

**Global Entry:**
- Alert window: 6 months before expiration
- Start renewal by: Immediately upon entering alert window (processing takes 2–6 months even for renewals)
- Cost: $100 for 5-year membership
- Process: Log in to Trusted Traveler Programs website → Membership → Renew. Complete renewal application. Schedule interview if required by CBP (renewal interviews are sometimes waived for known compliant members). Global Entry includes TSA PreCheck.
- Link: ttp.dhs.gov

**TSA PreCheck:**
- Alert window: 6 months before expiration
- Start renewal by: 6 months before expiration (processing: 3–5 weeks)
- Cost: $78 for 5-year renewal (online); credit cards with travel benefits may reimburse
- Process: Online renewal available if enrolled with TSA (not Global Entry provider). Complete renewal at tsaprecheck.gov. No in-person appointment needed for renewal.
- Link: tsaprecheck.gov/renewal

**Professional licenses and certifications:**
- Alert window: 6 months before expiration
- Renewal process varies by license type and state — provide link to the issuing board's website from the document record
- Note any continuing education requirements that must be completed before renewal

## Steps

1. Receive document type, holder name, expiration date from calling flow
2. Determine the effective renewal deadline (expiration minus travel rule if applicable) and start-renewal-by date using document-specific lead times
3. Calculate urgency: days between today and start-renewal-by date
4. Select document-specific renewal steps, cost, and official portal link
5. Classify urgency: start-renewal-by date > 90 days away = medium; 30–90 days = high; <30 days = critical; past start-renewal-by = critical/overdue
6. Write flag entry to `~/Documents/aireadylife/vault/records/open-loops.md`
7. Return flag summary to calling op

## Input

- Document type, holder name, expiration date (from calling flow)
- `~/Documents/aireadylife/vault/records/config.md` — holder's state (for driver's license link), recent travel plans (for passport urgency context)

## Output Format

Each flag entry in open-loops.md:
```markdown
## [ID-EXPIRATION] — {Document Type} ({Holder}) — {URGENCY}
**Date flagged:** YYYY-MM-DD
**Expires:** YYYY-MM-DD ({X days}
**Effective deadline:** YYYY-MM-DD (6-month travel rule or same as expiration)
**Start renewal by:** YYYY-MM-DD
**Cost:** $X
**Steps:**
1. {Step 1}
2. {Step 2}
**Official portal:** {URL}
**Action by:** YYYY-MM-DD (= start-renewal-by date)
**Status:** open
```

## Configuration

Required in `~/Documents/aireadylife/vault/records/config.md`:
- `household_members` with their state (for DL renewal link)
- Upcoming international travel dates (to calculate passport travel deadline)

## Error Handling

- If document type is not in the known list: write flag with generic expiration warning; note renewal process is unknown
- If holder's state is not in config: omit state-specific DL link; provide generic dmv.org link
- If start-renewal-by date has already passed: set urgency to critical/overdue regardless of days to expiration

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/records/config.md`
- Writes to: `~/Documents/aireadylife/vault/records/open-loops.md`
