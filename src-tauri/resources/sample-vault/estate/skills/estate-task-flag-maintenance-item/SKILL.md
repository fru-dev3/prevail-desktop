---
name: aireadylife-estate-task-flag-maintenance-item
type: task
description: >
  Writes a maintenance flag to open-loops.md and creates a detailed maintenance item record
  in vault/estate/00_current/. Captures property, issue, urgency classification, vendor
  status, estimated cost, and target completion date. Urgency drives escalation timing.
---

# aireadylife-estate-flag-maintenance-item

**Produces:** New maintenance item in `~/Documents/aireadylife/vault/estate/00_current/` and a flag in `~/Documents/aireadylife/vault/estate/open-loops.md`

## What It Does

This task is called whenever a maintenance issue is identified — reported by a tenant, discovered during a property inspection, found during a monthly maintenance review, or triggered by the seasonal schedule. It creates a structured maintenance record and simultaneously writes a condensed flag to open-loops.md so the issue remains visible until resolved.

Each maintenance item record captures the full operational context needed to manage the issue from discovery through completion. The record includes the property address (using a consistent slug format for filtering), the specific unit or location within the property, a clear description of the issue, how it was discovered (tenant report, inspection, seasonal check), and the urgency classification.

Urgency classification is the most important field and drives all downstream escalation behavior. Routine: scheduled preventive maintenance or minor cosmetic issue with no functional impact (e.g., HVAC filter replacement, touch-up painting, weatherstripping adjustment). No legal obligation to complete immediately; target completion within 30 days. Urgent: functional issue that is not yet a safety emergency but degrades habitability, property condition, or tenant satisfaction — plumbing leak (slow), HVAC running but not cooling to setpoint, appliance malfunction, electrical outlet not working (single outlet). Target completion within 14 days; requires vendor contact within 5 days. Emergency: immediate safety risk or habitability threat — no heat in winter, no hot water, sewage backup, electrical hazard, roof leak actively causing damage, broken exterior lock. Legal requirement in most states to begin remediation within 24–72 hours; vendor contact same day; document all communications for legal record.

The vendor section captures: vendor name, vendor phone/email, date contacted, date of quote received, quoted amount, and estimated start date. This creates an auditable record for insurance claims, warranty submissions, or legal proceedings if needed.

The estimated cost field is used by the cash flow analysis to reserve funds before the expense is officially logged. Large repairs (typically above $500) are also automatically noted as candidates for CapEx vs. maintenance expense classification — CapEx must be depreciated over the asset's useful life while maintenance is fully deductible in the current year. The task adds a note for the user to confirm classification with their tax professional for any item above $2,500.

## Steps

1. Collect property address, unit/location, issue description, discovery method from calling op or user
2. Classify urgency (routine/urgent/emergency) based on issue description and impact on habitability
3. Log vendor status: contacted (yes/no), vendor name, date contacted, quote received (yes/no), quoted amount
4. Set estimated cost (use vendor quote if available; otherwise estimate from maintenance knowledge base)
5. Set target completion date based on urgency: routine = 30 days, urgent = 14 days, emergency = 72 hours
6. If cost > $2,500: add note recommending CapEx vs. maintenance classification review with tax professional
7. Write detailed maintenance item file to `~/Documents/aireadylife/vault/estate/00_current/{property-slug}-{YYYY-MM-DD}-{issue-slug}.md`
8. Write condensed flag entry to `~/Documents/aireadylife/vault/estate/open-loops.md`

## Input

- Property address (or slug)
- Issue description
- Discovery method
- Urgency classification (or enough context to classify automatically)
- Vendor information if already contacted
- Estimated cost if known

## Output Format

**Maintenance item file:**
```markdown
# Maintenance: {Issue Description}
**Property:** {address}
**Unit/Location:** {unit or area}
**Date Flagged:** YYYY-MM-DD
**Discovery:** {tenant report / inspection / seasonal schedule / monthly review}
**Urgency:** {routine / urgent / emergency}

## Issue
{Full description}

## Vendor
| Field | Value |
| Name | |
| Contacted | |
| Quote | |
| Start Date | |

**Estimated Cost:** $X
**Target Completion:** YYYY-MM-DD
**Status:** open

## Notes
[Any additional context]
```

**Open loop flag:**
```
## [MAINTENANCE] — {Property} — {Issue} — {Urgency}
Date: YYYY-MM-DD | Cost: $X | Due: YYYY-MM-DD | Status: open
```

## Configuration

No additional configuration required beyond vault existing.

## Error Handling

- If property slug is not in config.md: save with the full address; warn that slug is not recognized
- If urgency cannot be determined from issue description: default to "urgent" and flag for manual review
- If cost is unknown: log as $0 with a "cost unknown — get vendor quote" note

## Vault Paths

- Writes to: `~/Documents/aireadylife/vault/estate/00_current/{property-slug}-{YYYY-MM-DD}-{issue-slug}.md`
- Writes to: `~/Documents/aireadylife/vault/estate/open-loops.md`
