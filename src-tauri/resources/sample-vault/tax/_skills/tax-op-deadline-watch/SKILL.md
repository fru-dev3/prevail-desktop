---
name: aireadylife-tax-op-deadline-watch
type: op
cadence: monthly
description: >
  Monthly tax deadline monitor. Flags all federal and state tax obligations due within
  30 days with estimated payment amounts and specific action steps. Covers quarterly
  estimated payments (Q1 April 15, Q2 June 15, Q3 Sept 15, Q4 Jan 15), annual return
  deadlines, extension deadlines, entity-level obligations (LLC annual reports, S-corp
  payroll deposits, franchise tax), and registered agent renewals. Triggers: "check
  tax deadlines", "upcoming tax dates", "what tax is due", "tax deadline alert".
---

# aireadylife-tax-deadline-watch

**Cadence:** Monthly (1st of month)
**Produces:** Deadline alert list in `vault/tax/open-loops.md`; deadline document in `vault/tax/00_current/`

## What It Does

Runs on the first of each month to surface all tax obligations falling within the next 30 days — the window where timely action is required to avoid penalties. The monthly cadence ensures no deadline is missed regardless of how infrequently the user actively thinks about taxes.

The op calls `aireadylife-tax-build-deadline-list` to generate the 90-day forward look, then filters to the 30-day window for the primary alert list. Items beyond 30 days are placed in a "UPCOMING" section for awareness but not treated as urgent flags.

**Q1 (April 15 cluster).** The April 15 deadline drives three separate obligations that frequently collide: Q1 estimated tax payment, the annual return or extension decision, and for entities — any final business return deadlines (S-Corp March 15; C-Corp April 15). In the March deadline watch run, all three are flagged together with clear separation of what is due on what date and the independence of the payment deadline from the return filing deadline.

**Quarterly payment amounts.** For each estimated payment deadline, the watch op checks whether a quarterly estimate has been calculated in `vault/tax/00_current/`. If yes, the flagged amount uses the calculated figure. If no estimate has been run, the flag includes "[Amount TBD — run quarterly estimate]" and triggers `aireadylife-tax-quarterly-estimate` as a recommended follow-on action.

**Entity deadline specificity.** Entity deadlines are flagged with entity name, deadline type, specific state, amount (franchise tax or annual report fee where known), and the specific portal or method. Minnesota LLC annual reports: filed online at SOS.state.mn.us, $0 fee. California LLC: $800 minimum franchise tax due April 15. Texas LLC: margin tax return due May 15. These specific amounts and portals are populated from config or the embedded entity compliance reference.

**EFTPS enrollment warning.** If any estimated payment amount exceeds $1,000 and the user has not previously enrolled in EFTPS (Electronic Federal Tax Payment System), the flag includes a note: "EFTPS enrollment takes 5–7 business days — enroll now if you haven't already. For immediate payment, use IRS Direct Pay instead."

## Calls

- **Flows:** `aireadylife-tax-build-deadline-list`
- **Tasks:** `aireadylife-tax-flag-approaching-deadline`, `aireadylife-tax-update-open-loops`

## Apps

- `gcalendar` — optional; add deadline alerts to Google Calendar if configured

## Vault Output

- `vault/tax/00_current/YYYY-MM-deadlines.md` — full 90-day deadline list (from flow)
- `vault/tax/open-loops.md` — deadline alert flags for items within 30 days

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/tax/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/tax/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/tax/02_briefs/` — prior briefs for period-over-period context
