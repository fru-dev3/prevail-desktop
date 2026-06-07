---
name: aireadylife-tax-op-deduction-review
type: op
cadence: monthly
description: >
  Monthly deduction review. Scans recent transactions and vault receipts for deductible
  expenses across home office (simplified method $5/sq ft or actual expenses), vehicle
  business use (70 cents/mile for 2025), business expenses (software, equipment,
  professional services, meals at 50%), charitable contributions (with documentation
  check for donations ≥$250), and medical expenses exceeding 7.5% of AGI. Verifies
  documentation, computes YTD totals per category, and flags categories below prior
  year pace. Triggers: "deduction review", "log a deductible expense", "what can I
  deduct", "are my deductions documented".
---

# aireadylife-tax-deduction-review

**Cadence:** Monthly (1st of month)
**Produces:** Updated deductions log in `vault/tax/00_current/`; deduction gap flags in `vault/tax/open-loops.md`

## What It Does

Runs monthly to ensure no deductible expense slips through uncaptured between reviews. Monthly capture is more effective than year-end scrambling: receipts are current, business purpose notes are fresh, and charitable acknowledgment letters can be requested before they're needed for filing.

The op calls `aireadylife-tax-review-deductions` to scan transaction records and vault documents for all deductible items across the applicable categories. Each item identified is classified by deduction category, checked for documentation completeness, and passed to `aireadylife-tax-log-deductible-expense` to record it in the deductions log with the required metadata.

**Documentation enforcement.** The op enforces IRS documentation requirements at the point of capture rather than at filing time: cash charitable donations ≥$250 require a written acknowledgment letter reference; business meals require a record of who attended and what business was discussed; home office expenses require the square footage calculation to be on file in config; vehicle deductions require a contemporaneous mileage log. Items without required documentation are flagged as "Documentation pending" rather than rejected — the expense is captured now and documentation is requested.

**Standard vs. itemized decision support.** Each monthly run updates the YTD itemized deduction total and compares it to the 2025 standard deduction ($15,000 single / $30,000 married filing jointly / $22,500 head of household). When itemized deductions are clearly exceeding the standard deduction (by more than $2,000), the op notes "On track to itemize — continue capturing deductions." When itemized deductions are below the standard deduction and unlikely to exceed it by year-end, the op notes "Standard deduction appears favorable — itemized deduction capture is for reference; CPA will confirm at filing."

**Pace comparison.** The op compares YTD totals per category to the same-period totals from the prior year, flagging categories more than 20% below pace. A category running below pace is either genuinely lower-expense (valid) or under-captured (actionable). The flag prompts the user to review whether expenses in that category have actually decreased.

## Calls

- **Flows:** `aireadylife-tax-review-deductions`
- **Tasks:** `aireadylife-tax-log-deductible-expense`, `aireadylife-tax-update-open-loops`

## Apps

None

## Vault Output

- `vault/tax/00_current/YYYY-deductions.md` — updated YTD deduction totals by category
- `vault/tax/open-loops.md` — documentation gap flags and pace flags

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/tax/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/tax/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/tax/02_briefs/` — prior briefs for period-over-period context
