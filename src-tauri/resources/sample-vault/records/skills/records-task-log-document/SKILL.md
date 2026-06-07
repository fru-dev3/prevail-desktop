---
name: aireadylife-records-task-log-document
type: task
cadence: as-received
description: >
  Adds a new document to vault/records/ with document type, holder, issue date, expiration
  date, issuing authority, physical storage location, and digital storage location. Routes
  to the correct subfolder by document type. Creates the expiration tracking record.
---

# aireadylife-records-log-document

**Cadence:** As-received (when a new document is issued, renewed, or discovered during a records cleanout)
**Produces:** Document record in the appropriate `~/Documents/aireadylife/vault/records/` subfolder

## What It Does

This task creates a structured document record in the vault whenever a new document needs to be tracked. The goal is not to store the document itself (though a file path to a scan can be recorded) — it is to capture the metadata: who holds the document, when it expires, where the original is physically kept, and where a digital backup exists. This metadata is what enables the quarterly audit and monthly sync to surface expiration alerts and storage gaps proactively.

The task routes each document to the correct subfolder based on its type:

**Identity documents → `00_identity/`:**
- US Passport (adult: 10-year validity; child under 16: 5-year validity)
- Passport card (valid for US, Mexico, Canada, Caribbean land/sea travel; not for international flights)
- State driver's license or non-driver ID (REAL ID compliance noted)
- Birth certificate (no expiration; physical certified copy required for most applications)
- Social Security card (no expiration, but replacements are limited to 3 per year, 10 lifetime)
- US naturalization certificate or certificate of citizenship (no expiration)
- Military ID (varies by status)
- Global Entry / TSA PreCheck / Nexus card
- Professional license or certification

**Legal documents → `01_legal/`:**
- Will / Last will and testament
- Durable power of attorney (financial)
- Healthcare power of attorney / healthcare proxy
- Healthcare directive / advance directive / living will
- Trust documents (revocable living trust, etc.)
- Marriage certificate
- Divorce decree / dissolution of marriage
- Adoption documents
- Property deed
- Vehicle title(s)

Each record captures: document type, holder's full name, issue date, expiration date (or "no expiration" with last-reviewed date for legal documents), issuing authority (State Department, MN DMV, County Court, etc.), physical storage location (fireproof safe in home office, safety deposit box at First National Bank, filing cabinet drawer 2), digital storage location (1Password > Documents > Passport, encrypted Google Drive folder /Records/IDs/, etc.), and a file path or reference to the scanned copy if it has been digitized.

For legal documents, instead of expiration date, the record captures: date document was created, the attorney or firm that prepared it, last-reviewed date, and a notes field for any known review triggers (e.g., "will created before daughter's birth — needs update").

Both the physical and digital storage locations are critical fields. Having only one storage location is a vulnerability: if the fireproof safe is stolen or destroyed, the digital backup is the only record of the document's existence. If the 1Password account is inaccessible (death, incapacitation, forgotten master password), the physical original is the fallback. Both locations should always be populated.

## Steps

1. Identify document type; route to correct subfolder (00_identity or 01_legal)
2. Collect: holder name, issue date, expiration date (or "no expiration"), issuing authority
3. Collect physical storage location (specific — room, container, section)
4. Collect digital storage location (app, folder, item name)
5. Record scan file path if document has been digitized
6. For legal documents: record attorney/firm name, creation date, last-reviewed date
7. Write structured document record to the correct subfolder
8. Confirm both physical and digital storage locations are populated; flag if either is missing
9. Confirm record saved; note the document will appear in the next quarterly audit

## Input

User provides: document type, holder name, issue date, expiration date (or review date for legal docs), issuing authority, physical storage location, digital storage location
Optional: scan file path, attorney name (legal docs), notes

## Output Format

**Identity document record:**
```markdown
# Document: {Document Type} — {Holder Name}
**Document Type:** {type}
**Holder:** {name}
**Issue Date:** YYYY-MM-DD
**Expiration Date:** YYYY-MM-DD
**Issuing Authority:** {authority}
**REAL ID Compliant:** yes/no/N-A (driver's license only)

## Storage
- **Physical:** {specific location}
- **Digital:** {app + folder + item name}
- **Scan on File:** yes/no — {file path if yes}

**Last Updated:** YYYY-MM-DD
```

**Legal document record:**
```markdown
# Document: {Document Type} — {Holder Name}
**Document Type:** {type}
**Holder:** {name}
**Date Created:** YYYY-MM-DD
**Attorney/Firm:** {name}
**Last Reviewed:** YYYY-MM-DD

## Storage
- **Physical:** {specific location}
- **Digital:** {app + folder + item name}

**Notes:** {known review triggers}
**Last Updated:** YYYY-MM-DD
```

## Configuration

Required in `~/Documents/aireadylife/vault/records/config.md`:
- `household_members` — used to validate holder name against known household

## Error Handling

- If document type is not in the standard list: save in the closest matching subfolder with a note; flag for manual review
- If physical storage location is not provided: save with "physical: unknown" and flag as storage gap
- If digital storage location is not provided: save with "digital: unknown" and flag as storage gap
- If expiration date is not known for an ID document: save with "expiration: unknown" and flag as "verify expiration date"

## Vault Paths

- Writes to: `~/Documents/aireadylife/vault/records/00_current/{holder-slug}-{document-type-slug}.md` (for identity documents)
- Writes to: `~/Documents/aireadylife/vault/records/00_current/{holder-slug}-{document-type-slug}.md` (for legal documents)
