---
name: aireadylife-health-task-flag-preventive-care-gap
type: task
cadence: quarterly
description: >
  Writes a flag to vault/health/open-loops.md for any overdue or due-soon preventive
  care screening. Records: care type, last completed date, recommended interval, days
  overdue, urgency tier (routine/soon/overdue), and a specific scheduling action.
  Called by aireadylife-health-preventive-care-review for each identified gap.
---

# aireadylife-health-flag-preventive-care-gap

**Cadence:** Quarterly (called by preventive care review op)
**Produces:** Preventive care gap entries in `vault/health/open-loops.md`

## What It Does

Called by `aireadylife-health-preventive-care-review` for each screening or checkup that is overdue or coming due within the next 90 days. The task writes a structured, actionable flag rather than a vague reminder.

Covered care types and their recommended intervals:
- **Annual physical** — every 12 months with PCP; includes blood pressure check, BMI, general exam, and routine lab orders
- **Dental cleaning** — every 6 months; flag includes whether patient is due for bitewing X-rays (every 12–24 months)
- **Comprehensive eye exam** — every 12 months for contact lens wearers or diabetics; every 24 months for low-risk adults
- **Skin check (dermatology)** — every 12 months for adults with significant sun history or family melanoma; every 24 months otherwise
- **Flu vaccination** — annually in fall (September–November); flag if past November and not yet received
- **Colonoscopy** — every 10 years starting at age 45; or every 3 years for stool DNA test (Cologuard); or every 5 years for CT colonography
- **Mammogram** — annually for women 40+ (ACS guidelines) or biennially 50–74 (USPSTF); user's provider recommendation takes precedence
- **PSA discussion** — for men 50+ (or 40+ with family history) — flagged as "Schedule conversation with PCP about PSA screening"
- **Provider-custom items** — any additional screenings listed in `vault/health/00_current/care-schedule.md`

Urgency tiers:
- **ROUTINE** — up to 30 days overdue; informational, schedule at next opportunity
- **SOON** — 31–90 days overdue; prioritize scheduling within 2 weeks
- **OVERDUE** — 91+ days overdue; call to schedule immediately; note in action item
- **DUE SOON** — not yet overdue but coming due within 30 days; schedule proactively

Each flag entry includes: care type, last completed date (or "Never" if no record), interval, days overdue, urgency tier, and a specific action step ("Call Dr. [provider name] at [phone from config] to schedule" or "Use [portal name] online scheduling"). When the provider's contact info is not in config, the action step says "Schedule via your PCP's portal or call your provider."

## Apps

None

## Vault Output

- `vault/health/open-loops.md` — preventive care gap flag entries appended
