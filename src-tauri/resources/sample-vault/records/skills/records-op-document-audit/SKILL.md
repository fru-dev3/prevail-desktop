---
name: aireadylife-records-op-document-audit
type: op
cadence: quarterly
description: >
  Quarterly document audit. Checks all identity documents, legal documents, and professional
  credentials for expiration within 12 months, missing documents, documents needing review,
  and storage gaps (physical on file, no digital backup). Flags renewal actions with lead times.
  Triggers: "document audit", "records check", "ID expiration", "important documents".
---

# aireadylife-records-document-audit

**Cadence:** Quarterly (1st of January, April, July, October)
**Produces:** Document status report with expiration flags, missing document gaps, review recommendations, and storage gap alerts

## What It Does

This op runs quarterly to audit the complete document inventory against five dimensions: expiration status, renewal urgency, document gaps (important documents not yet tracked), storage gaps (document exists but no digital backup), and legal document currency (documents that should be reviewed even without a formal expiration date).

**Expiration and renewal audit:** The op calls the expiring-documents flow to check every document in the vault against the 12-month horizon, applying document-specific lead times. Passport renewal takes 10–13 weeks standard; Global Entry renewal can begin 6 months early and should — processing times for renewals are often 2–4 months. Driver's license renewal is quick (1–2 weeks for most states) but REAL ID compliance is a separate check that may require an in-person DMV visit with supporting documents (birth certificate, Social Security card, two proofs of address). If any household member's documents are approaching renewal simultaneously, the op flags the overlapping renewal workload.

**Document gap audit:** Many households are missing one or more foundational documents without realizing it. The op checks the vault for the presence of each document in a standard checklist. Identity documents: US passport (or passport card), state driver's license or ID, birth certificate, Social Security card or document with SSN, US naturalization certificate (if applicable), military ID (if applicable). Legal documents: will (every adult in household), durable power of attorney (healthcare and financial, every adult), healthcare directive or living will, marriage certificate (if married), divorce decree (if divorced), adoption documents (if applicable). Financial documents: most recent tax returns (at least 3 years), current account statements, investment account statements. Insurance: current homeowner's or renter's policy declarations page, auto insurance declarations page, life insurance policy. Vehicle: title and registration for each vehicle. Any gap on the identity or legal checklist is flagged as "missing — obtain and add to vault."

**Storage gap audit:** The op checks each document that exists in the vault against its logged storage locations. Every important document should have two storage records: a physical location (fireproof safe, safety deposit box, or secured home file) and a digital location (1Password secure note, encrypted Google Drive folder, or similar). A document with only one storage location is flagged as "single-point-of-failure — add second storage location." Documents that exist physically but have never been scanned or photographed are flagged for digitization — a lost physical passport without a digital copy is a consular nightmare requiring additional documentation to replace.

**Legal document currency review:** Wills, powers of attorney, and healthcare directives do not expire but can become outdated. Standard review triggers that should prompt a legal document review: birth of a child or grandchild (update beneficiaries and guardianship designations), marriage or divorce (update spousal designations, beneficiaries), death of a named beneficiary or executor, significant change in asset structure (new business, large inheritance, real estate acquisition), relocation to a different state (some states require POA and healthcare directive to follow state-specific forms), 5 years elapsed since last review. The op checks for any of these triggers logged in config.md and flags accordingly.

## Triggers

- "Run the document audit"
- "Check my documents"
- "What IDs are expiring?"
- "Records check"
- "Document status review"
- "What documents am I missing?"
- "Do I have everything I need?"

## Steps

1. Call `aireadylife-records-check-expiring-documents` to produce the expiration report for all tracked documents
2. Run document gap checklist against vault contents for identity, legal, financial, and insurance categories
3. For each document in vault: check physical and digital storage locations; flag single-point-of-failure
4. Check each household member for REAL ID-compliant driver's license status
5. Check legal document review dates and life event triggers in config.md
6. Call `aireadylife-records-flag-expiring-id` for any document entering its alert window for the first time
7. Write document audit report to `~/Documents/aireadylife/vault/records/00_current/YYYY-MM-document-audit.md`
8. Call `aireadylife-records-update-open-loops` with all flags (expiring, missing, storage gaps, legal review)
9. Present full report organized by urgency

## Input

- `~/Documents/aireadylife/vault/records/00_current/` — identity document records
- `~/Documents/aireadylife/vault/records/00_current/` — legal document records
- `~/Documents/aireadylife/vault/records/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/records/config.md` — household members, recent life events

## Output Format

**Document Audit — [Quarter] [Year]**

**Section 1: Expiration Status**
[Per document table from expiring-documents flow]

**Section 2: Document Gaps**
| Category | Document | Holder | Status |
| Identity | US Passport | Alex | ✓ on file |
| Legal | Healthcare Directive | Alex | ✗ MISSING — obtain |

**Section 3: Storage Gaps**
| Document | Physical Location | Digital Location | Flag |

**Section 4: Legal Document Review**
| Document | Last Reviewed | Triggers Present | Recommendation |

**Action Items — Urgent (start within 7 days):**
**Action Items — This Quarter:**
**Watching:**

## Configuration

Required in `~/Documents/aireadylife/vault/records/config.md`:
- `household_members` — list of all adults and children whose documents are tracked
- `recent_life_events` — marriage, divorce, birth, death, relocation, major asset change in past 5 years

## Error Handling

- If vault missing: direct to frudev.gumroad.com/l/aireadylife-records
- If identity folder is empty: run gap checklist and report all items as missing; provide setup guidance
- If legal documents folder is empty: flag as high priority — adults without a will or POA should obtain these promptly

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/records/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/records/00_current/`, `01_legal/`, `config.md`
- Writes to: `~/Documents/aireadylife/vault/records/00_current/YYYY-MM-document-audit.md`
- Writes to: `~/Documents/aireadylife/vault/records/open-loops.md`
