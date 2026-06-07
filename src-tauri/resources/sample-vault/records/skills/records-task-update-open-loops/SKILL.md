---
name: aireadylife-records-task-update-open-loops
type: task
description: >
  Writes records flags (expiring IDs with renewal deadlines, outdated legal documents,
  unused subscriptions approaching renewal, missing documents, storage gaps) to open-loops.md
  and resolves completed items. Archives resolved items with outcome notes.
---

# aireadylife-records-update-open-loops

**Trigger:** Called by records ops and flows at the end of every run
**Produces:** Updated `~/Documents/aireadylife/vault/records/open-loops.md` with new flags and resolved items archived

## What It Does

This task maintains the records domain's open-loops file as the single list of outstanding document and subscription actions. Every records op and flow writes its flags here; the file is the persistent watchlist that keeps expiration deadlines, missing documents, and subscription decisions visible between monthly reviews.

Flags in the records domain fall into the following categories:

**ID-Expiration:** Document entering its alert window. Urgency is calibrated to the start-renewal-by date, not the expiration date. Critical: start-renewal-by date is within 14 days (or already passed). High: start-renewal-by date is 15–60 days away. Medium: start-renewal-by date is 61–180 days away. These flags include the full renewal context (steps, cost, link) from the flag-expiring-id task.

**Missing-Document:** An important document category not found in the vault. High urgency for legal documents (will, POA) that most adults should have. Medium urgency for identity document gaps. The flag includes one-line guidance on how to obtain or replace the document.

**Storage-Gap:** A document exists in the vault but has only one storage location logged. Medium urgency — this is a recovery risk in an emergency, not an immediate crisis.

**Legal-Review:** A will, POA, or healthcare directive that is overdue for review. Medium urgency if 3–5 years since last review; high if a specific life event trigger is present.

**Subscription-Renewal-Due:** Annual subscription renewing within 30 days with no keep/cancel decision recorded. High urgency when the renewal date is within 7 days. Medium when 8–30 days out. Each flag includes the renewal date, annual cost, last-used date, and cancellation link.

**Subscription-Unused:** Subscription with no logged usage in 60+ days. Medium urgency. Flag includes monthly and annual cost so the financial impact of keeping it is visible.

Each flag entry includes: category, document or service name, holder if applicable, issue description, financial context (dollar amount or risk), recommended action, and action-by date. On every run, existing items are checked for resolution: a document renewed (new expiration date logged), a subscription cancelled (removed from registry), a missing document added to vault. Resolved items move to `~/Documents/aireadylife/vault/records/open-loops-archive.md` with resolution date and outcome.

## Steps

1. Receive flag data from calling op (category, name/type, holder, description, financial context, action, urgency, action-by date)
2. Read existing `~/Documents/aireadylife/vault/records/open-loops.md` to check for duplicates
3. If duplicate flag exists: update timestamp and financial context; do not create duplicate
4. If new flag: append structured entry with all required fields
5. Scan existing open items for resolution: check 00_identity/ for renewed documents, 02_subscriptions/ for cancelled services, 01_legal/ for reviewed documents
6. Move resolved items to open-loops-archive.md with resolution date and outcome
7. Return summary: total open items by urgency

## Input

- Flag data from calling op
- `~/Documents/aireadylife/vault/records/open-loops.md`
- `~/Documents/aireadylife/vault/records/00_current/` — for renewal resolution checks
- `~/Documents/aireadylife/vault/records/00_current/subscriptions.md` — for cancellation resolution checks

## Output Format

Each entry in open-loops.md:
```markdown
## [{CATEGORY}] — {Document/Service} ({Holder if applicable}) — {URGENCY}
**Date flagged:** YYYY-MM-DD
**Description:** {full issue description with financial context}
**Action:** {recommended action}
**Action by:** YYYY-MM-DD
**Status:** open
```

Archive entry:
```markdown
## [RESOLVED] — [{original category}] — {Document/Service}
**Resolved:** YYYY-MM-DD | **Outcome:** {document renewed, subscription cancelled, etc.}
```

Summary to calling op: "X items in open loops (Y critical, Z high, W medium, V monitor)"

## Configuration

No additional configuration required.

## Error Handling

- If open-loops.md does not exist: create it with the first entry
- If open-loops-archive.md does not exist: create it when first item is resolved
- If flag data is incomplete: write available fields; mark missing fields "unknown"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/records/open-loops.md`
- Reads from: `~/Documents/aireadylife/vault/records/00_current/`, `02_subscriptions/`
- Writes to: `~/Documents/aireadylife/vault/records/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/records/open-loops-archive.md`
