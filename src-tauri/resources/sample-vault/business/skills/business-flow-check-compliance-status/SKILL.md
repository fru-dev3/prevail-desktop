---
name: aireadylife-business-flow-check-compliance-status
type: flow
trigger: called-by-op
description: >
  Reviews entity compliance checklist: annual report filed, registered agent current, tax elections
  in place, and operating agreement updated. Flags anything due within 60 days or overdue.
---

## What It Does

Reads the compliance checklist from `~/Documents/aireadylife/vault/business/00_current/compliance-checklist.md`, which is a structured list of every recurring entity obligation with its frequency, last-completed date, and next-due date. Iterates through each item and calculates the days until due (or days overdue if past due) by comparing the next-due date to today's date. Assigns a traffic-light status: 🔴 overdue (past due date with no completion recorded), 🟡 due within 60 days (action required soon), 🟢 current (more than 60 days until due and completion documented).

Coverage includes all standard LLC and S-corp obligations: state annual report filing (deadline varies by state — California April 15, Delaware June 1, Wyoming/Nevada: annual fee, no report), registered agent renewal date and current mailing address confirmation, S-Corp election confirmation (Form 2553 on file), quarterly estimated tax payment dates (April 15, June 15, September 15, January 15), operating agreement review (annual), federal and state payroll tax filings (if applicable), 1099-NEC preparation and filing (February 15 recipient deadline, March 31 IRS deadline), and any state-specific business licenses.

Also checks vault/business/00_current/ for backing documentation on each item marked complete — a filed annual report should have a confirmation document; a registered agent renewal should have a receipt or confirmation email. Items marked complete without backing documentation are flagged as "verify — no documentation found" rather than treated as fully green.

Returns the full status table sorted by urgency (overdue first, then by soonest due date) to the calling op.

## Triggers

Called internally by `aireadylife-business-op-compliance-review` and `aireadylife-business-op-review-brief`. Not invoked directly by the user.

## Steps

1. Read `~/Documents/aireadylife/vault/business/00_current/compliance-checklist.md`; parse each obligation into: name, frequency, last-completed date, next-due date
2. Calculate days-until-due or days-overdue for each item (next-due date minus today)
3. Assign status: 🔴 if days-overdue > 0, 🟡 if 1-60 days until due, 🟢 if >60 days until due
4. For each item marked complete, check vault/business/00_current/ for a matching backing document; flag "verify — no documentation" if none found
5. Check registered agent section specifically: confirm the registered agent's name, address, and contact info are current; flag if address differs from config.md entry
6. Identify any standard obligation types missing from the checklist entirely (e.g., no 1099-NEC line for a business that pays contractors) and flag as "checklist gap"
7. Sort results: overdue items first, then by soonest due date within 🟡 tier, then 🟢 tier
8. Return sorted status table to the calling op

## Input

- `~/Documents/aireadylife/vault/business/00_current/compliance-checklist.md` — master list of all entity obligations with frequencies and dates
- `~/Documents/aireadylife/vault/business/00_current/` — backing documentation files (annual report confirmations, registered agent receipts, etc.)
- `~/Documents/aireadylife/vault/business/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/business/config.md` — entity list, states of formation, registered agent name and address

## Output Format

```
## Compliance Status — {Month} {Year}

| Obligation                  | Entity     | Due Date   | Status | Days Until/Overdue | Notes                  |
|-----------------------------|------------|------------|--------|--------------------|------------------------|
| State Annual Report         | LLC A      | 2026-04-15 | 🔴     | 3 days overdue     | No filing found        |
| Registered Agent Renewal    | LLC A      | 2026-06-01 | 🟡     | 49 days            | Confirm address current |
| Q2 Estimated Tax (federal)  | All        | 2026-06-15 | 🟡     | 63 days            | Calculate amount        |
| Operating Agreement Review  | LLC A      | 2026-07-01 | 🟢     | 79 days            | Current                |
| 1099-NEC Filing (IRS)       | LLC A      | 2026-03-31 | 🟢     | Filed 2026-02-10   | Confirmed               |
```

## Configuration

Required fields in `~/Documents/aireadylife/vault/business/00_current/compliance-checklist.md`:
- Each row: obligation name, entity name, frequency (annual/quarterly/monthly), last-completed date (YYYY-MM-DD), next-due date (YYYY-MM-DD), documentation filename (optional)

Required in `~/Documents/aireadylife/vault/business/config.md`:
- `entities` — name, state, entity type, registered agent name and address
- `contractors_paid_ytd` — whether any contractor was paid $600+ this year (triggers 1099-NEC requirement)

## Error Handling

- If compliance-checklist.md does not exist: return "Compliance checklist not found at vault/business/00_current/compliance-checklist.md. Create this file to enable compliance tracking." Include a template structure.
- If an obligation has no next-due date: flag as "incomplete record — due date required."
- If the checklist has not been updated in more than 90 days: flag "Checklist may be stale — last modified {date}. Review and update after each filing."
- If config.md entity list is empty: return "No entities configured. Add entity details to vault/business/config.md."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/business/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/business/00_current/compliance-checklist.md`, `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/config.md`
- Writes to: called by ops that write to `~/Documents/aireadylife/vault/business/02_briefs/`
