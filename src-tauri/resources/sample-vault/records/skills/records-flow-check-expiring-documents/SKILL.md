---
name: aireadylife-records-flow-check-expiring-documents
type: flow
trigger: called-by-op
description: >
  Scans all identity and legal documents for expiration dates within 12 months. Applies
  document-specific renewal lead times (passport: 10–13 weeks; Global Entry: start 6 months
  early; driver's license: 1–2 weeks). Flags legal documents not reviewed in 3+ years.
  Returns structured action items with renewal steps and agency links.
---

# aireadylife-records-check-expiring-documents

**Trigger:** Called by `aireadylife-records-document-audit`
**Produces:** Expiration report with per-document status, renewal lead times, and specific action steps

## What It Does

This flow reads the complete document inventory from the vault and validates every document with an expiration date against a 12-month warning horizon. It applies document-specific renewal lead times — not a generic warning — because passport renewal takes 10–13 weeks while driver's license renewal can typically be done in a day.

The flow processes six document categories with distinct expiration and renewal rules:

**Passport:** US passports are valid for 10 years for adults (16+) and 5 years for minors under 16. The 6-month rule for international travel: most countries require your passport to be valid for at least 6 months beyond your planned travel dates — effectively shortening the usable life of your passport by 6 months. Renewal lead time: standard processing is 10–13 weeks; expedited processing is 4–6 weeks ($60 additional fee); passport card is a less expensive option for US, Mexico, Canada, and Caribbean travel only ($30 renewal). Renewal can begin at any time before expiration — many financial planners recommend renewing 9–12 months before the expiration date to avoid the rush. Flag: entering the 12-month window.

**Driver's License:** Renewal cycles vary by state: 4 years (CA, NY, most states), 6 years (TX, FL), 8 years (several states). REAL ID-compliant licenses (gold star marker) are required for domestic flights and federal building access as of May 2025. If the user's license is not REAL ID-compliant, flag this as a separate action item regardless of expiration date. Renewal lead time: typically 1–2 weeks if done online; may require in-person DMV visit for first-time REAL ID. Flag: entering the 90-day window.

**Global Entry:** Valid for 5 years. Conditional approval for renewal can begin 6 months before expiration — highly recommended as processing times have been 12–18 months for new applications in recent years; renewals are faster but still take several months. If Global Entry is allowed to expire, the user loses TSA PreCheck access as well. Flag: entering the 6-month window.

**TSA PreCheck:** Valid for 5 years. Renewal opens 6 months before expiration. Renewal fee: $78. Renewal typically processes in 3–5 weeks and can be done entirely online if renewing with the same provider. Flag: entering the 6-month window.

**Nexus/SENTRI:** Similar to Global Entry. Valid for 5 years. Includes both Global Entry and TSA PreCheck benefits plus expedited Canada/Mexico border crossing. Renewal timing: start 6 months before expiration. Flag: entering the 6-month window.

**Legal documents (no formal expiration):** Will, power of attorney, healthcare directive, and living will do not expire legally, but they can become effectively outdated as life circumstances change. Standard recommendation: review every 3–5 years, or after any major life event (marriage, divorce, birth of child, death of a beneficiary, significant change in assets, relocation to a different state — state law governs POA and healthcare directive enforceability). The flow flags any legal document not reviewed in more than 3 years as "review recommended." If the will was created before the birth of a child or before marriage, this is flagged as a high-priority review regardless of the 3-year threshold.

**Professional licenses and certifications:** Any professional license (real estate license, CPA, nursing license, contractor's license, etc.) or credential with an expiration date. Renewal requirements vary by profession and state. Flag: entering the 6-month window.

## Steps

1. Read document inventory from `~/Documents/aireadylife/vault/records/00_current/` and `~/Documents/aireadylife/vault/records/00_current/`
2. For each document with an expiration date: calculate days until expiration
3. Apply document-specific alert thresholds: passport (365 days), driver's license (90 days), Global Entry/TSA PreCheck/Nexus (180 days), professional license (180 days)
4. For documents within threshold: calculate the "start renewal by" date using renewal lead times
5. Check if any identity document is past the "start renewal by" date — flag as urgent
6. Check each passport against the 6-month international travel rule; note effective travel deadline
7. Check REAL ID compliance for driver's licenses; flag non-compliant licenses regardless of expiration
8. Read legal document review dates; flag any not reviewed in 3+ years
9. Check for life events in config that may have rendered legal documents outdated (marriage, birth, divorce) since last review
10. Return structured expiration report with per-document status and action items

## Input

- `~/Documents/aireadylife/vault/records/00_current/` — identity document records
- `~/Documents/aireadylife/vault/records/00_current/` — legal document records
- `~/Documents/aireadylife/vault/records/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/records/config.md` — household members, recent life events

## Output Format

**Document Expiration Report**

| Document | Holder | Expires | Days | Alert Window | Renewal Lead Time | Start Renewal By | Status |
|----------|--------|---------|------|--------------|------------------|------------------|--------|
| Passport | Alex | 2025-06-15 | 245 | 365 days | 10–13 weeks | 2025-03-16 | ⚠ START RENEWAL |
| Driver's License | Alex | 2026-01-15 | 460 | 90 days | 1–2 weeks | 2025-10-15 | on track |
| Global Entry | Alex | 2025-09-01 | 320 | 180 days | 3–6 months | 2025-03-01 | ⚠ RENEW NOW |

**Legal Document Review Flags:**
| Document | Last Reviewed | Recommended Review | Trigger |

**Action Items:**
Per flagged document: title, holder, action steps, official renewal portal link, cost

## Configuration

Required in `~/Documents/aireadylife/vault/records/config.md`:
- `household_members` — list of all people whose documents are tracked
- `recent_life_events` — marriage, divorce, birth, relocation in the past 5 years (for legal document review trigger)

## Error Handling

- If document has no expiration date in vault: note "No expiration date — add to document record"
- If document holder is not set: assign to "Primary" and note
- If legal document has no review date: flag immediately as "review date unknown — schedule review"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/records/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/records/00_current/`
- Reads from: `~/Documents/aireadylife/vault/records/00_current/`
- Reads from: `~/Documents/aireadylife/vault/records/config.md`
- Writes to: `~/Documents/aireadylife/vault/records/00_current/YYYY-MM-expiration-report.md`
