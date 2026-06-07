---
name: aireadylife-tax-op-review-brief
type: op
cadence: monthly
description: >
  Monthly tax review brief. Compiles YTD estimated tax liability, total federal and
  state payments made YTD (withholding + estimated payments), next upcoming deadline
  with amount, entity compliance status across all active entities, deduction totals
  by category, and prioritized action items. Designed to be read in 3 minutes.
  Triggers: "tax brief", "tax status", "monthly tax review", "am I behind on taxes",
  "tax summary".
---

# aireadylife-tax-review-brief

**Cadence:** Monthly (1st of month)
**Produces:** Tax review brief at `vault/tax/02_briefs/YYYY-MM-tax-brief.md`

## What It Does

Generates the monthly tax review brief — a single document that gives the user a complete, prioritized picture of their tax posture without requiring them to dig through calculation files or deadline lists. The brief is calibrated to answer the three questions the user actually cares about: Am I current? What's coming up? What do I need to do?

**Tax Position Summary.** YTD estimated tax liability (from the most recent quarterly estimate calculation), total payments applied YTD (federal withholding from W-2 pay stubs + quarterly estimated payments made + prior year overpayment applied), and the resulting balance: on track to overpay (refund expected) or underpaid (balance due). Expressed in plain numbers: "Estimated liability: $24,000. Applied YTD: $19,200. Gap: $4,800 remaining in the year."

**Next Deadline.** The single most urgent upcoming deadline with the exact amount due, due date, and one-line action: "[Q3 Estimated Tax Payment — $3,200 due September 15 via IRS Direct Pay]."

**Entity Compliance.** For each active entity: name, compliance status (CURRENT / FLAG), and any open items. One line per entity. "LLC-1 (MN): Current. S-Corp: Q3 941 return due October 31 — file via payroll provider."

**Deduction Status.** YTD totals for each active deduction category: home office, mileage, business expenses, charitable, medical. Documentation status: N items flagged for documentation completion. Standard vs. itemized comparison update.

**Document Status (during filing season, Jan–April).** Document completeness: N of M expected documents received. Missing document count by type. "3 documents pending: 1099-B from M1 Finance, K-1 from [Partnership Name], 1098 from [lender name]."

**Action Items.** Numbered list, prioritized by urgency and financial impact:
1. [CRITICAL] Specific action with due date
2. [HIGH] Specific action
3. [MEDIUM] Specific action
...

Items sourced directly from `vault/tax/open-loops.md`, filtered to OPEN status, sorted by severity then due date.

## Calls

- **Flows:** `aireadylife-tax-build-deadline-list` (for next deadline data)
- **Tasks:** `aireadylife-tax-update-open-loops`

## Vault Output

- `vault/tax/02_briefs/YYYY-MM-tax-brief.md` — monthly tax review brief
- `vault/tax/open-loops.md` — resolved items closed if applicable

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/tax/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/tax/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/tax/02_briefs/` — prior briefs for period-over-period context
