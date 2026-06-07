---
name: aireadylife-tax-op-document-sync
type: op
cadence: as-received
description: >
  Tax document intake op, active January through April 15. Triggered each time a new
  tax document arrives (W-2, 1099-NEC, 1099-B, 1099-DIV, 1099-INT, 1099-R, K-1, 1098)
  via email, mail, or portal download. Logs the document to the vault inventory, updates
  the completeness checklist, and flags any document expected but not yet received after
  its issuer deadline (January 31 for W-2s and 1099s; March 15 for K-1s). Triggers:
  "tax document arrived", "W-2 came in", "1099 received", "log a tax doc".
---

# aireadylife-tax-document-sync

**Cadence:** As-received (active January 1 through April 15)
**Produces:** Updated document inventory in `vault/tax/00_current/`; missing document flags in `vault/tax/open-loops.md`

## What It Does

Serves as the intake op for all tax documents during filing season. Each time a document arrives — digitally or physically — this op is triggered to log it and update the completeness checklist. The goal is to know, at any point in January through April, exactly which documents have been received, which are still expected, and which are overdue.

**Document intake.** When triggered, the op asks the user to confirm: document type (W-2, 1099-NEC, 1099-B, etc.), payer/issuer name, tax year it covers, and whether the file has been placed in `vault/tax/00_current/YYYY/`. If the file is not yet in the vault, the user is prompted to save it there before the intake is logged. The op applies the standard naming convention and flags any deviation.

**Completeness check.** After logging the new document, the op calls `aireadylife-tax-document-completeness` to update the full expected vs. received picture. This ensures the completeness report is always current after each intake event rather than only during scheduled reviews.

**Issuer deadline tracking.** W-2s and 1099s are due from issuers by January 31. If the deadline has passed for any expected document that hasn't been received, the flag escalates: for January 31 deadline, if running in mid-February and a W-2 from an active employer is still missing, the flag is HIGH severity with action: "Contact [employer HR/payroll] to resend W-2" or "Download from payroll portal." K-1s from partnerships are due March 15 but are frequently late — K-1 delays are noted as MEDIUM severity (a known, common occurrence) with an action: "Request estimated K-1 from partnership if filing before March 15; otherwise consider extension."

**Amended documents.** When a corrected document arrives (1099-C, W-2C), the op logs it as a replacement and flags: "Amended [document type] received from [issuer] — prior version superseded. Confirm your CPA has the updated version."

**Portal download queue.** Many institutions make tax documents available on their portal before mailing. The op includes a note for documents not yet received: which portal to check and when to check it (Fidelity: typically available by late January in Statements & Documents; brokerage 1099s: often ready February 15–28).

## Calls

- **Flows:** `aireadylife-tax-document-completeness`
- **Tasks:** `aireadylife-tax-update-open-loops`

## Apps

None (documents placed manually in vault; portal-specific apps handle downloading to vault if configured)

## Vault Output

- `vault/tax/00_current/YYYY/[document-file]` — saved tax document (user places; op confirms)
- `vault/tax/00_current/YYYY-completeness.md` — updated completeness report
- `vault/tax/open-loops.md` — missing document flags

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/tax/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/tax/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/tax/02_briefs/` — prior briefs for period-over-period context
