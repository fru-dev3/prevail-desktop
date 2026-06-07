---
name: aireadylife-business-task-log-invoice
type: task
cadence: as-received
description: >
  Records a new invoice to vault/business/00_current/ with client, amount, date issued, due date,
  service description, and payment status.
---

## What It Does

Accepts invoice details — either provided by the user directly as structured fields, extracted from an invoice document or image, or entered conversationally — and writes a structured invoice record to `~/Documents/aireadylife/vault/business/00_current/`. The resulting file feeds directly into the `aireadylife-business-flow-build-pl-summary` flow for monthly P&L calculations and into the `aireadylife-business-task-flag-overdue-invoice` task for payment monitoring.

Validates required fields before writing: client name, invoice number, amount, date issued, and payment due date are all required. Service description and entity name are strongly recommended. Payment status defaults to "pending" if not provided. Checks for a duplicate invoice record (same invoice number + client name) before writing to prevent double-counting in P&L calculations.

If the invoice being logged already has a due date in the past and status is still pending: immediately writes the record with status "overdue" and calls `aireadylife-business-task-flag-overdue-invoice` — this ensures the overdue alert appears in open-loops.md without waiting for the next monthly P&L review cycle.

Filename format: `{YYYY-MM-DD}-{client-slug}-invoice-{number}.md`. Client slug is a lowercase, hyphen-separated version of the client name (e.g., "Acme Corp" → "acme-corp"). This naming convention enables automatic date-range filtering during monthly reviews.

## Triggers

- "log an invoice"
- "add invoice"
- "I just sent an invoice to [client]"
- "record payment received from [client]"
- "mark invoice [number] as paid"
- Called by user when issuing a new invoice or receiving payment on an existing one

## Steps

1. Collect required fields from the user or extract from provided document: client name, invoice number, amount (and currency), date issued, payment due date, service description, entity name (if multi-entity setup)
2. Validate that all required fields are present; if any are missing, ask for the specific missing field before proceeding
3. Check vault/business/00_current/ for an existing file with the same invoice number and client slug; if found, ask user whether to update the existing record or create a new one
4. Determine payment status: paid (if user reports payment received), overdue (if due date is in the past and no payment), pending (default for new invoices with future due dates)
5. If marking an existing invoice as paid: locate the existing record, update the status and payment-received date, do not create a new file
6. If creating a new record: write structured invoice file to vault/business/00_current/{YYYY-MM-DD}-{client-slug}-invoice-{number}.md
7. If the invoice is overdue (due date past, status pending): call `aireadylife-business-task-flag-overdue-invoice` immediately
8. Confirm the record was written and return the file path

## Input

User-provided fields (one or more of the following):
- Client name (required)
- Invoice number (required)
- Amount (required)
- Date issued (required; defaults to today if not provided)
- Payment due date (required; commonly Net 30 from issue date)
- Service description (recommended)
- Payment status (pending / paid / overdue; default: pending)
- Payment received date (if paid)
- Entity name (if the business has multiple entities)

## Output Format

Written file at `~/Documents/aireadylife/vault/business/00_current/{YYYY-MM-DD}-{client-slug}-invoice-{number}.md`:
```
# Invoice Record

client: {Client Name}
invoice_number: {number}
entity: {entity name}
amount: ${X,XXX.XX}
currency: USD
date_issued: {YYYY-MM-DD}
due_date: {YYYY-MM-DD}
payment_terms: Net {30}
status: {pending / paid / overdue}
payment_received_date: {YYYY-MM-DD or blank}
service_description: {description}
notes: {optional notes}
```

## Configuration

Optional in `~/Documents/aireadylife/vault/business/config.md`:
- `default_payment_terms_days` — default Net days (e.g., 30); applied when due date is not specified
- `default_entity` — entity to use when not specified by user

## Error Handling

- If client name is missing: "Which client is this invoice for?" — do not write record until provided.
- If amount is missing or non-numeric: "What is the invoice amount?" — validate it is a positive number.
- If invoice number is already in vault for the same client: "Invoice #{number} for {client} already exists. Do you want to update the existing record (e.g., mark as paid) or create a separate record?"
- If no vault/business/00_current/ directory exists: "Revenue folder not found. Has the vault been set up? Check ~/Documents/aireadylife/vault/business/."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/business/00_current/` (duplicate check), `~/Documents/aireadylife/vault/business/config.md`
- Writes to: `~/Documents/aireadylife/vault/business/00_current/{YYYY-MM-DD}-{client-slug}-invoice-{number}.md`
