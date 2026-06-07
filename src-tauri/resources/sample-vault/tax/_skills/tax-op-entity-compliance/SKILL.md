---
name: aireadylife-tax-op-entity-compliance
type: op
cadence: quarterly
description: >
  Quarterly entity compliance check for all active LLCs and S-corps. Reviews: state
  annual report filing deadlines and fees, franchise tax payment obligations (California
  $800 minimum, Texas margin tax, others), registered agent renewal status, S-corp
  reasonable salary and payroll tax deposit requirements (Form 941, EFTPS), K-1
  issuance deadlines, and any state-specific LLC compliance requirements. Flags all
  gaps and approaching deadlines within 90 days. Triggers: "entity compliance check",
  "LLC filing due", "state tax deadlines", "business entity compliance".
---

# aireadylife-tax-entity-compliance

**Cadence:** Quarterly (1st of January, April, July, October)
**Produces:** Compliance status in `vault/tax/00_current/YYYY-QN-compliance.md`; entity flags in `vault/tax/open-loops.md`

## What It Does

Runs quarterly to ensure all active business entities remain in good standing without surprises at filing time or, worse, administrative dissolution. Entity compliance issues compound: a missed annual report can lead to administrative dissolution by the state, which requires reinstatement (costly and time-consuming) and can create gaps in liability protection.

**Per-entity compliance checklist.** For each entity listed in config.md, the op checks the following categories:

State Annual Report: most states require LLCs and corporations to file an annual or biennial report to maintain good standing. The deadline, fee, and filing method vary significantly by state. Common patterns: Minnesota — no annual report for LLCs (single-member LLCs are a pass-through with no separate state filing requirement); Delaware — Annual Report due June 1 for LLCs ($300 fee), March 1 for corporations; California — Statement of Information due every 2 years within 6 months of formation anniversary ($20 fee); Wyoming — Annual Report due on anniversary month. The op checks each entity's state and compares the expected filing date against the last confirmed filing in `vault/tax/00_current/`.

Franchise Tax: some states impose a franchise tax or minimum business tax separate from income tax. California: all LLCs pay $800/year minimum franchise tax, due by the 15th day of the 4th month after the tax year (April 15 for calendar-year entities). Texas: margin tax return due May 15, amount based on revenue. Delaware: franchise tax due March 1 for corporations (calculated by authorized shares method or assumed par value method).

Registered Agent: must maintain a registered agent at a physical address in each state of formation or registration at all times. Typical registered agent services (Northwest, ZenBusiness, Registered Agents Inc.) renew annually. The op checks the registered agent renewal date from `vault/tax/00_current/[entity-name]/registered-agent.md` and flags renewals within 60 days.

S-Corp Requirements: if any entity has an S-Corp election in effect, the op checks: (1) reasonable salary compliance — the owner-employee must be paid a reasonable W-2 salary before any distributions; (2) Form 941 quarterly payroll tax returns — due April 30, July 31, October 31, January 31; (3) EFTPS payroll tax deposits — due semi-weekly or monthly depending on lookback period; (4) W-2 issued to owner-employee by January 31; (5) 1120-S filed or extended by March 15.

K-1 issuance: partnerships and S-Corps must issue K-1s to partners/shareholders by the entity return due date. If K-1s are late, partners cannot file their personal returns accurately.

## Calls

- **Flows:** `aireadylife-tax-document-completeness` (entity scope)
- **Tasks:** `aireadylife-tax-update-open-loops`

## Apps

None

## Vault Output

- `vault/tax/00_current/YYYY-QN-compliance.md` — per-entity compliance status table
- `vault/tax/open-loops.md` — entity compliance gap flags and approaching deadline alerts

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/tax/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/tax/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/tax/02_briefs/` — prior briefs for period-over-period context
