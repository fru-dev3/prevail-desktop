---
name: aireadylife-tax-flow-build-deadline-list
type: flow
trigger: called-by-op
description: >
  Builds a prioritized list of all tax deadlines falling within the next 90 days,
  sorted by days remaining. Covers: federal quarterly estimated payments (Q1 April 15,
  Q2 June 15, Q3 Sept 15, Q4 Jan 15), federal return April 15 / extension Oct 15,
  state estimated payments, state return deadlines, entity-level deadlines (LLC annual
  reports, franchise tax, S-corp payroll deposits, Form 941), and registered agent
  renewals. Each deadline includes the associated entity, estimated payment amount,
  and specific payment or filing method.
---

# aireadylife-tax-build-deadline-list

**Trigger:** Called by `aireadylife-tax-deadline-watch`
**Produces:** Deadline list document at `vault/tax/00_current/YYYY-MM-deadlines.md`

## What It Does

Reads the full tax deadline calendar from `vault/tax/00_current/deadline-calendar.md` — a master calendar that covers all known annual deadlines for the user's personal and entity tax situation — and filters to all items due within the next 90 days. The master calendar is populated from config.md when the vault is first set up, incorporating: the user's filing status, state(s) of residence, active entities and their states of formation, and the current tax year.

**Deadline categories included:**

Federal personal deadlines: Q1 estimated payment (April 15), Q2 estimated payment (June 15), Q3 estimated payment (September 15), Q4 estimated payment (January 15), annual return or extension (April 15), extended return (October 15). Each estimated payment entry includes the calculated or estimated payment amount if a quarterly estimate calculation has been run; otherwise shows "Amount TBD — run quarterly estimate."

State personal deadlines: state income tax return or extension (most states mirror April 15; some differ — California April 15, New York April 15, check state-specific); state estimated payments (most mirror federal quarterly schedule; some have different Q2 dates). Listed per state if the user has income in multiple states.

Entity deadlines: S-Corp and partnership return (March 15 or extension); LLC annual report per state (varies significantly — some states due on anniversary of formation, others January 1); franchise tax payment (California $800 minimum by April 15; Texas margin tax by May 15; others vary); registered agent renewal (annual, date specific to agent and state); Form 941 quarterly payroll tax return (April 30, July 31, October 31, January 31); FUTA (Form 940, January 31).

**Deadline enrichment.** Each deadline is enriched with: the entity it applies to (personal, LLC name, S-Corp name), the estimated payment or fee amount (from the most recent estimate or known fixed fee), the specific payment or filing method (IRS Direct Pay at irs.gov/payments, EFTPS for large estimated payments, state revenue portal URL, registered agent's renewal portal), and whether an extension has already been filed.

**Urgency tiering.** Deadlines within 7 days: CRITICAL. Deadlines 8–14 days out: URGENT. Deadlines 15–30 days out: APPROACHING. Deadlines 31–90 days out: UPCOMING.

## Triggers

- "check tax deadlines"
- "upcoming tax dates"
- "what tax is due"
- "build deadline list"
- "what do I owe and when"
- "tax calendar"
- "next 90 days tax"

## Steps

1. Read `vault/tax/config.md` to identify: filing status, states of residence, active entities, entity states, whether any extensions have been filed
2. Read `vault/tax/00_current/deadline-calendar.md` — the master deadline calendar for this tax year
3. Filter all calendar entries to those due within the next 90 days
4. For each filtered deadline, read the associated entity, payment amount (from most recent estimate or known fixed fee), and payment method
5. Check `vault/tax/00_current/` for any quarterly estimate calculations already run this year; populate payment amount where available
6. Check `vault/tax/open-loops.md` for any deadlines already flagged to avoid duplication
7. Sort the list by days remaining (ascending); apply urgency tier to each item
8. Flag deadlines where payment method requires advance setup (EFTPS enrollment takes 5–7 business days)
9. Write formatted deadline list to `vault/tax/00_current/YYYY-MM-deadlines.md`
10. Return the list of CRITICAL and URGENT items to the calling op for open-loop flag generation

## Input

- `vault/tax/00_current/deadline-calendar.md` — master deadline calendar
- `vault/tax/00_current/` — quarterly estimate calculations for payment amounts
- `vault/tax/01_prior/` — prior period records for trend comparison
- `vault/tax/config.md` — filing status, entities, states, extension status

## Output Format

Markdown document at `vault/tax/00_current/YYYY-MM-deadlines.md`:
- Header: run date, days covered (next 90 days), count by urgency tier
- Deadline table: Deadline | Entity | Due Date | Days Remaining | Amount | Method | Urgency
- CRITICAL section (separate): any item within 7 days with bold formatting and action step
- Notes section: any EFTPS enrollment needed, state portal registration required, etc.

## Configuration

Required in `vault/tax/config.md`:
- `filing_status` — single | married_filing_jointly | married_filing_separately | head_of_household
- `states` — list of states where the user has income tax obligations
- `entities` — list of business entities with type, state, and formation date
- `extensions_filed` — list of entity names where an extension was filed (to update October 15 deadline)
- `prior_year_tax_liability` — total tax paid on prior year return (for safe harbor calculation)

## Error Handling

- If the master deadline calendar is missing: generate it from config.md using the known federal schedule and prompt user to verify entity-level deadlines
- If an entity is listed in config but missing its state: flag "Entity [name] — state not configured; cannot generate state-specific deadlines"
- If payment amounts are not yet available for quarterly estimates: show "TBD — run tax-op-quarterly-estimate" in the amount field

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/tax/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/tax/00_current/deadline-calendar.md`
- Reads from: `~/Documents/aireadylife/vault/tax/00_current/`
- Reads from: `~/Documents/aireadylife/vault/tax/config.md`
- Writes to: `~/Documents/aireadylife/vault/tax/00_current/YYYY-MM-deadlines.md`
