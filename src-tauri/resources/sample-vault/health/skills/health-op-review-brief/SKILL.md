---
name: aireadylife-health-op-review-brief
type: op
cadence: monthly
description: >
  Monthly health review brief. Compiles a composite wellness score from wearable trends,
  lab flags from the most recent panel, medication refill status, health cost YTD and
  HSA balance, and preventive care gaps into a single briefing document with prioritized
  action items. Triggers: "health brief", "health review", "monthly health summary",
  "how is my health", "give me my health report".
---

# aireadylife-health-review-brief

**Cadence:** Monthly (1st of month, after monthly sync completes)
**Produces:** Health review brief at `vault/health/02_briefs/YYYY-MM-health-brief.md`

## What It Does

Generates the monthly health brief — a single document that gives the user a complete, prioritized picture of their health status without requiring them to open multiple files or apps. The brief is designed to be read in under 5 minutes and acted on in under 15 minutes.

**Composite Wellness Score.** Derived from the wearable wellness summary: a weighted average of sleep score (35% weight), HRV trend (25%), resting HR trend (20%), and readiness score (20%). The composite score is 0–100. Any score below 65 is flagged as below baseline; 65–79 is nominal; 80+ is strong. The score is shown with MoM direction (improving/declining/stable).

**Lab Status.** Reads the most recent lab summary from `vault/health/00_current/` and extracts the count and severity of flagged biomarkers. Lists each flagged biomarker by name and severity tier (borderline, elevated, critical) — no raw values in the brief. If no lab results exist in the past 12 months, flags "No recent labs — consider scheduling a comprehensive metabolic and lipid panel."

**Medication Status.** Reads from `vault/health/00_current/` and lists any refills due within 30 days, any medications missing documentation, and any HSA reimbursements pending. If all medications are current, reports "All medications current — no action needed."

**Cost and Coverage.** Reads deductible progress from `vault/health/00_current/deductible-tracker.md` and HSA balance from `vault/health/00_current/hsa-balance.md`. Reports: deductible paid YTD vs. plan deductible limit; estimated date to hit deductible (based on YTD pace); HSA balance and YTD contribution vs. 2025 limit ($4,300 individual / $8,550 family); out-of-pocket max progress.

**Preventive Care.** Reads open care gap flags from `vault/health/open-loops.md` and lists any overdue or due-soon screenings with their urgency tier.

**Action Items.** All open health items from `vault/health/open-loops.md` are sorted by urgency and listed as a numbered checklist at the end of the brief. Items marked critical or high appear first with specific next steps.

## Configuration

Configure in `vault/health/config.md`:
- `insurance_deductible` — annual individual deductible amount
- `insurance_oop_max` — annual out-of-pocket maximum
- `hsa_enrollment` — individual | family
- `provider_name` — primary care provider name (used in care gap action items)

## Calls

- **Flows:** `aireadylife-health-build-wellness-summary`, `aireadylife-health-build-lab-summary` (if new labs present)
- **Tasks:** `aireadylife-health-update-open-loops`

## Apps

None (reads from vault)

## Vault Output

- `vault/health/02_briefs/YYYY-MM-health-brief.md` — monthly health review brief
- `vault/health/open-loops.md` — resolved items closed if applicable

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/health/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/health/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/health/02_briefs/` — prior briefs for period-over-period context
