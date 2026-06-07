---
name: aireadylife-insurance-op-claims-review
type: op
cadence: on-demand
description: >
  On-demand claims management covering the full claim lifecycle: initial filing steps with documentation checklist, active claim status tracking with adjuster follow-up actions, settlement offer adequacy review, stall detection (claims open 30+ days without status update), and denial appeal guidance. Triggers: "claim status", "insurance claim", "file a claim", "claims review", "I need to file a claim", "my claim was denied".
---

## What It Does

Manages insurance claims from the moment an incident occurs through final settlement. Claims fail not because insurance companies refuse to pay legitimate claims (they usually pay), but because policyholders don't document properly before filing, miss follow-up windows, accept inadequate settlement offers without pushing back, or let claims stall without escalation. This op prevents all of these failure modes.

**New claim filing:** When the user reports an incident requiring a claim, the op walks through the preparation checklist before filing. Documentation needed: photos and video of all damage (critical — once a contractor starts work, proof of original damage is gone), a police report for auto accidents or theft, medical records and bills for injury claims, receipts or replacement cost estimates for stolen or damaged property, and any witness information. Timing: most policies require filing within 30-60 days of the incident; filing sooner is always better. Coverage verification: reads the relevant policy from `vault/insurance/00_current/` to confirm the incident is a covered loss (vs. an excluded peril), identify the applicable deductible, and locate the claims phone number or portal for the specific carrier. Creates a new claims log entry in `vault/insurance/00_current/` with the claim number, date filed, adjuster contact, and initial coverage assessment.

**Active claim management:** Reads all active (open) claims from `vault/insurance/00_current/` and determines what action is required to advance each. Claims typically progress through: filing → adjuster assignment → damage assessment/appraisal → settlement offer → acceptance or dispute. Each stage has expected timelines: adjuster contact within 3-5 business days of filing; initial settlement offer within 30 days for property claims, 60-90 days for liability claims. Claims at the same stage for 14+ days without a status update are flagged as potentially stalled, and an adjuster follow-up call is recommended. Claims open more than 30 days with no status update: escalation to the adjuster's supervisor is appropriate.

**Settlement adequacy review:** When a settlement offer is received, the op assesses whether it covers the full documented loss. For property claims: compares the offer to the documented damage (contractor estimates, receipts, replacement cost for stolen items). For auto total-loss: compares the insurer's valuation to market comparable values (Kelly Blue Book, Carmax actual cash value). For liability claims (medical): compares settlement to actual medical bills plus documented pain and suffering. If the offer is inadequate: documents the shortfall with specific evidence and generates a written counter-offer response.

**Denial appeals:** If a claim is denied, the op reads the denial letter from `vault/insurance/00_current/` and identifies the stated reason. Generates an appeal strategy: for coverage exclusion denials, identifies whether the exclusion is properly applied; for documentation deficiencies, identifies what additional documentation would satisfy the carrier; for policy interpretation disputes, identifies the specific policy language at issue. Standard appeal deadline is 30 days from denial for most carriers; state-specific insurance department complaint filing is an escalation option if internal appeal fails.

## Triggers

- "claim status"
- "insurance claim"
- "file a claim"
- "claims review"
- "I need to file a claim for [incident]"
- "my claim was denied"
- "check my open claims"
- "settle my claim"

## Steps

1. Determine context: new claim filing, active claim status review, settlement review, or denial appeal.
2. **New claim:** Identify policy type and read relevant policy from `vault/insurance/00_current/`. Verify incident is covered. Provide documentation checklist. Give carrier claims contact info. Create claims log entry in `vault/insurance/00_current/`.
3. **Active claims:** Read all open claims from `vault/insurance/00_current/`. For each: calculate days since last activity. Flag claims with no update in 14+ days as stalled. Generate adjuster follow-up action items.
4. **Settlement review:** Read settlement offer amount from claims log. Compare to documented loss (contractor estimates, receipts, market comparables). Calculate adequacy: (offer ÷ documented loss) × 100. Flag if below 90% of documented loss as potentially inadequate.
5. **Denial appeal:** Read denial reason from claims log. Identify appeal strategy based on denial type. Calculate appeal deadline. Generate appeal letter outline.
6. Update claims log entries with current status and next action.
7. Write claims review summary to `vault/insurance/00_current/claims-review-YYYY-MM-DD.md`.
8. Call `aireadylife-insurance-task-update-open-loops` with all claim action items and deadlines.

## Input

- `~/Documents/aireadylife/vault/insurance/00_current/` — active and recent claims log
- `~/Documents/aireadylife/vault/insurance/00_current/` — policy documents for coverage verification
- `~/Documents/aireadylife/vault/insurance/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/insurance/config.md` — carrier contact information

## Output Format

**Claims Review** — saved as `vault/insurance/00_current/claims-review-YYYY-MM-DD.md`

```
## Claims Review — [Date]

### Active Claims
[Claim #] — [Policy Type] — [Carrier] — Filed [date] ([X days ago])
  Status: [current stage]
  Last activity: [date] ([X days ago])
  Next action: [specific action with deadline]
  Settlement status: [Pending offer / Offer received: $X / Accepted / Disputed]

### New Claim — Documentation Checklist
[ ] Photos/video of all damage
[ ] Police report (if applicable)
[ ] Medical records and bills (if injury)
[ ] Receipts or replacement cost estimates
[ ] Witness contact information
[ ] Claims phone number: [from policy]

### Settlement Review (if applicable)
Settlement offered: $X
Documented loss: $X
Adequacy: X% — [Adequate / Review — potential shortfall of $X]

### Denial Appeal (if applicable)
Denial reason: [stated reason]
Appeal deadline: [date]
Appeal strategy: [specific approach]
```

## Configuration

Claim log entries at `vault/insurance/00_current/` with fields: claim_number, policy_type, carrier, date_filed, adjuster_name, adjuster_phone, adjuster_email, stage, last_activity_date, settlement_offer_amount, documented_loss_amount, status (open/closed/disputed).

## Error Handling

- **No active claims:** Report no active claims found. Provide new claim filing guidance if user indicates an incident occurred.
- **Policy not in vault:** Cannot verify coverage without policy. Instruct user to find the carrier claims line on their insurance card or online and file the claim; add policy to vault after filing.
- **Settlement offer date is past:** Note if offer has a response deadline; flag urgency if deadline is near.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/insurance/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/config.md`
- Writes to: `~/Documents/aireadylife/vault/insurance/00_current/`, `~/Documents/aireadylife/vault/insurance/open-loops.md`
