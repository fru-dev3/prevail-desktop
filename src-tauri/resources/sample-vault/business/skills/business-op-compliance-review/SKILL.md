---
name: aireadylife-business-op-compliance-review
type: op
cadence: quarterly
description: >
  Quarterly entity compliance check that reviews LLC/S-Corp filing requirements, state deadlines,
  registered agent status, and annual report filings. Triggers: "compliance review", "LLC compliance",
  "annual report", "entity check".
---

## What It Does

Runs quarterly (January, April, July, October) to produce a complete compliance snapshot for all configured business entities. Reads the compliance checklist from `~/Documents/aireadylife/vault/business/00_current/compliance-checklist.md` which tracks every recurring obligation with last-completed date and next-due date. Calls `aireadylife-business-flow-check-compliance-status` to calculate days until due and assign traffic-light status for each item.

Covers the full range of entity obligations: state annual report filing (deadline and fee vary by state — Delaware charges $300 minimum franchise tax due March 1; California charges $800 minimum franchise tax due April 15; Wyoming and Nevada charge annual fees of ~$60 with no report), registered agent status and address currency, S-Corp election confirmation (Form 2553 on file), operating agreement version and last review date, quarterly federal and state estimated tax payment dates, 1099-NEC preparation for contractors paid $600+ in the year, and any state-specific licenses or permits.

Checks for backing documentation — a filed annual report should have a confirmation number or stamped copy in vault/business/00_current/. Registered agent renewal should have a receipt or current confirmation. Items marked complete without documentation are flagged as "verify — documentation missing." Surfaces all items, not just problem items, so the user has a complete compliance picture in one document. Writes a dated compliance brief and pushes all 🔴 and 🟡 items to open-loops.

## Triggers

- "compliance review"
- "LLC compliance check"
- "annual report status"
- "entity check"
- "are my business filings current"
- "check my registered agent"
- "what business deadlines are coming up"
- "quarterly compliance"

## Steps

1. Confirm vault/business/00_current/compliance-checklist.md exists; if missing, prompt user to create it from the template in config.md
2. Call `aireadylife-business-flow-check-compliance-status` to evaluate all checklist items and return status table
3. Review the checklist for completeness — check that all standard obligation types are present for the configured entity types (LLC: annual report, registered agent, operating agreement; S-Corp adds: quarterly 941 payroll tax, 1099-NEC for contractors, S-Corp election on file)
4. For any registered agent entry: verify the configured registered agent address in config.md matches the filed address; flag any discrepancy
5. For entities in states with annual franchise taxes (CA, DE): confirm current year payment is logged or scheduled
6. Calculate 1099-NEC obligation: read vault/business/00_current/ or 02_expenses/ for contractor payments; flag if any contractor has received $600+ YTD with no 1099 plan noted
7. Check Q4 estimated tax was paid (January 15 deadline) and confirm Q1 estimated tax is scheduled if net income pace warrants it
8. Compile all items into compliance brief with status table sorted by urgency
9. Write brief to vault/business/02_briefs/compliance-{quarter}-{year}.md
10. Call `aireadylife-business-task-update-open-loops` with all 🔴 and 🟡 items

## Input

- `~/Documents/aireadylife/vault/business/00_current/compliance-checklist.md` — obligation registry
- `~/Documents/aireadylife/vault/business/00_current/` — backing documentation
- `~/Documents/aireadylife/vault/business/config.md` — entity list, states, registered agent details
- `~/Documents/aireadylife/vault/business/00_current/` — contractor payment records for 1099 threshold check
- `~/Documents/aireadylife/vault/business/01_prior/` — prior period records for trend comparison

## Output Format

```
# Compliance Review — Q{X} {Year}

**Entities Reviewed:** [Entity names]
**Overall Status:** [All current / X items need attention]

## Compliance Status Table
| Obligation             | Entity  | Due Date   | Status | Days | Notes              |
|------------------------|---------|------------|--------|------|--------------------|
| Annual Report          | LLC A   | 2026-04-15 | 🟡     | 12   | File via SOS portal |
| Registered Agent       | LLC A   | 2026-08-01 | 🟢     | 110  | Current             |
| Q2 Estimated Tax       | All     | 2026-06-15 | 🟡     | 63   | ~$X,XXX owed        |
| 1099-NEC (Contractor X)| LLC A   | 2026-02-15 | 🟢     | Filed| Confirmed           |

## Action Items
🔴 [Urgent action with specific deadline and consequence of missing it]
🟡 [Watch item with due date]

## 1099-NEC Status
[Contractor name]: $X,XXX paid YTD — {above/below} $600 threshold — status: {filed/pending/not required}
```

## Configuration

Required in `~/Documents/aireadylife/vault/business/config.md`:
- `entities` — list of entities with: name, state of formation, entity type, registered agent name and address, formation date
- `s_corp_election` — yes/no per entity
- `contractors` — list of contractors with annual payment total for 1099 tracking

## Error Handling

- If compliance-checklist.md is missing: "Compliance checklist not set up. Create vault/business/00_current/compliance-checklist.md using the provided template."
- If an entity has no state annual report entry in the checklist: flag as "checklist gap — add annual report entry for {entity} in {state}."
- If a past-due item exists: lead the brief with that item and the specific consequence (e.g., "California annual report 15 days overdue — $250 late penalty applies; file at bizfile.sos.ca.gov now.")

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/business/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/business/00_current/`, `~/Documents/aireadylife/vault/business/config.md`, `~/Documents/aireadylife/vault/business/00_current/`
- Writes to: `~/Documents/aireadylife/vault/business/02_briefs/compliance-{Q}-{YYYY}.md`, `~/Documents/aireadylife/vault/business/open-loops.md`
