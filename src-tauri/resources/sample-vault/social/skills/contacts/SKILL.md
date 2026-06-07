---
name: contacts
type: app
description: >
  Reads contact data from iOS Contacts (via vCard export) or Google Contacts (via People API)
  for birthday monitoring, relationship tracking, and outreach logging. Used by social-agent
  to scan upcoming birthdays, pull contact details for outreach context, and verify interaction
  notes stored in contact records. Configure sync method in vault/social/config.md.
---

# Contacts — Social Plugin

**Auth:** iOS Shortcuts export (device-local vCard) or Google People API (OAuth2)
**URL:** iOS Contacts app / contacts.google.com / Google People API
**Configuration:** Set sync method and export path in `vault/social/config.md`

## What It Does

Provides the social-agent with structured contact data — names, birthdays, phone numbers, email
addresses, and notes — to power birthday alerts, outreach queuing, and relationship health tracking.
The Contacts app is the canonical source of birthday dates for people the user knows personally.
Interaction notes logged via `social-task-log-interaction` may be stored in the contact notes field
(Google Contacts) or in the vault contact file — the skill reads both and reconciles.

## Data Available

- Contact names (full name, display name) and relationship type (family, friend, colleague)
- Birthday dates from the contact birthday field — used as the authoritative birthday source
- Phone numbers and email addresses — surfaced during outreach context generation
- Contact notes field — may contain last interaction date if the user maintains it there
- Groups and custom labels — used to infer relationship tier if not set in vault
- Google Contacts: structured fields including organization, job title, and mutual connections

## Configuration

Add to `vault/social/config.md`:
```
contacts_sync_method: google_people_api   # options: google_people_api | ios_vcf
google_people_api_credentials: vault/social/keys/google-people-oauth.json
contacts_export_path: ~/Documents/aireadylife/vault/social/00_current/contacts-export.vcf
contacts_birthday_field: birthday         # standard vCard field
```

**Google People API method (recommended):** Provides structured JSON with all fields. Requires
OAuth2 credentials — create a project in Google Cloud Console, enable the People API, download
credentials to `vault/social/keys/google-people-oauth.json`.

**iOS vCard method:** Export all contacts from iPhone: Contacts app → Select All → Share → AirDrop
to Mac → save to `contacts_export_path`. Parse vCard format (RFC 6350) to extract BDAY, TEL, EMAIL,
and NOTE fields. Re-export monthly or when contact records change significantly.

## Export Methods

**Google People API:**
```
GET https://people.googleapis.com/v1/people/me/connections
    ?personFields=names,birthdays,phoneNumbers,emailAddresses,biographies,memberships
    &pageSize=1000
Authorization: Bearer {oauth_token}
```
Returns paginated JSON. Follow `nextPageToken` until exhausted. Total connection counts of 500-2,000
are typical for active users.

**iOS vCard (fallback):**
Parse `.vcf` file. Each contact block starts with `BEGIN:VCARD` and ends with `END:VCARD`.
Extract: `FN` (full name), `BDAY` (birthday in YYYYMMDD or --MMDD format), `NOTE` (interaction notes),
`TEL`, `EMAIL`.

**Google Takeout (one-time export):**
contacts.google.com → Export → Google CSV or vCard — useful for initial vault population. Not suitable
for ongoing sync; use People API for regular reads.

## Birthday Parsing

Contacts store birthdays in multiple formats — handle all:
- `BDAY:19850415` — full date with year
- `BDAY:--0415` — no year (day/month only) — most common for casual contacts
- Google People API: `{"day": 15, "month": 4, "year": 1985}` or `{"day": 15, "month": 4}` (no year)

When year is absent: use only for upcoming birthday detection (day/month match). Do not calculate age.
When year is present: calculate age and include in birthday alert context ("turns 40 on April 15").

## Used By

- `social-op-birthday-watch` — scan all contacts with BDAY set for upcoming birthdays in the next 14 days
- `social-op-monthly-sync` — full contact roster refresh; reconcile vault contact files against contacts export to detect new contacts, missing tiers, and birthday gaps
- `social-flow-build-outreach-queue` — pull email/phone for outreach medium selection (e.g., if mobile number exists, SMS is an option for T1/T2)
- `social-flow-build-relationship-health-summary` — cross-reference contact notes for supplemental last-interaction dates when vault interaction log is sparse
- `social-task-log-interaction` — optionally update contact notes field in Google Contacts after logging to vault (configurable; off by default)

## Notes

- The vault contact files at `~/Documents/aireadylife/vault/social/00_current/` are the primary source of truth for relationship tier, health status, and interaction history. Contacts app is the supplemental source for birthday dates and contact details.
- If a contact has a birthday in the Contacts app but no vault file, flag it during monthly sync so the user can create a contact record for that person.
- Google Contacts notes field is often empty; do not rely on it as the sole source of interaction history — always check the vault interaction log first.
- Contact export should be refreshed monthly or before each `social-op-monthly-sync` run to ensure birthday data is current.
- Contacts that exist in the vault but not in the Contacts app (e.g., deceased, estranged) should be preserved in the vault without being deleted from the contact roster.

## Vault Output

`~/Documents/aireadylife/vault/social/00_current/contacts-export.vcf` — raw export file
`~/Documents/aireadylife/vault/social/00_current/` — individual contact profile files (written by social-task-log-interaction and social-op-monthly-sync, not by this skill directly)
