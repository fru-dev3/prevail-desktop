---
name: aireadylife-business-task-flag-overdue-invoice
type: task
description: >
  Writes an overdue invoice flag to vault/business/open-loops.md when an invoice is unpaid more
  than 30 days past due. Includes client, invoice number, amount, days overdue, and recommended action.
---

## What It Does

Reads invoice records from `~/Documents/aireadylife/vault/business/00_current/` and identifies any invoice where the payment due date has passed by more than 30 days and the status is still pending or overdue. For each overdue invoice found, calculates the exact number of days overdue (due date to today) and determines the recommended escalation action based on three severity tiers:

- **31-45 days overdue:** Send a polite but clear written payment reminder. Reference the original invoice number, amount, and due date. Include the late fee language if it was on the original invoice (1.5%/month is standard). Tone: professional, assuming oversight rather than bad faith.
- **46-60 days overdue:** Escalate to a direct phone call in addition to a written demand. The written demand should explicitly state the late fee that has accrued and the total amount now owed. If the original contract included a collections clause, reference it.
- **61+ days overdue:** Decision required — this moves beyond a payment delay into a collections situation. Options: formal collections letter from a collections attorney (typically 30-40% fee on recovered amount), small claims court for amounts under the state's small claims limit (typically $5,000-$10,000), or write-off for bad debt deduction (report on Schedule C as bad debt if accrual accounting, or simply do not count it as income if cash accounting).

Writes a structured flag to `~/Documents/aireadylife/vault/business/open-loops.md` for each overdue invoice. Checks for an existing unresolved flag for the same invoice (same invoice number + client) before writing to avoid duplicating alerts on each monthly review cycle.

## Triggers

Called internally by `aireadylife-business-op-pl-review` and `aireadylife-business-task-log-invoice` when an overdue condition is detected.

## Steps

1. Read all invoice records from `~/Documents/aireadylife/vault/business/00_current/`
2. Filter to invoices where: status = pending or overdue, AND payment due date is more than 30 days before today
3. For each overdue invoice, calculate exact days overdue = today minus payment due date
4. Assign severity tier: 31-45 days = Tier 1 (email reminder), 46-60 days = Tier 2 (phone + written demand), 61+ days = Tier 3 (collections decision)
5. Calculate late fee accrued if late fee terms were on original invoice: (days overdue / 30) × 1.5% × invoice amount
6. Check vault/business/open-loops.md for an existing unresolved flag with the same invoice number and client; skip if already flagged
7. Write flag entry for each new overdue invoice: priority (🔴 for Tier 2/3, 🟡 for Tier 1), client name, invoice number, amount, due date, days overdue, late fee accrued, recommended action for that tier
8. Return the count of overdue invoices and total overdue amount to the calling op

## Input

- `~/Documents/aireadylife/vault/business/00_current/` — invoice records; each must include: client name, invoice number, amount, due date, payment status

## Output Format

Each flag written to `vault/business/open-loops.md`:
```
{Priority} OVERDUE INVOICE — {Client} | Invoice #{number}
Amount: ${XXX} | Due: {date} | Days Overdue: {X} | Late Fee Accrued: ${XX}
Action (Tier {1/2/3}): {specific recommended action}
Source: business-task-flag-overdue-invoice | Raised: {today's date}
```

## Configuration

Optional in `~/Documents/aireadylife/vault/business/config.md`:
- `invoice_overdue_threshold_days` — days past due before flagging (default: 30)
- `late_fee_rate_monthly` — monthly late fee percentage (default: 1.5%; only applied if late fee terms exist)
- `late_fee_terms_on_invoice` — yes/no (if no, late fee accrual is not calculated)

## Error Handling

- If a record is missing a due date: flag the invoice as "due date unknown — cannot assess overdue status; update record."
- If a record is missing a payment status: treat as pending and evaluate against the due date.
- If vault/business/open-loops.md does not exist: create it with a header and then write the first flag entry.
- If no overdue invoices are found: return "No overdue invoices detected. {X} invoices reviewed." — do not write any flags.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/business/open-loops.md`
