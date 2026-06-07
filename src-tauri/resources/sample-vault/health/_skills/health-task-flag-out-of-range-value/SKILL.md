---
name: aireadylife-health-task-flag-out-of-range-value
type: task
cadence: as-received
description: >
  Writes a structured flag to vault/health/open-loops.md when a lab biomarker falls
  outside its clinical reference range. Records metadata only — biomarker name,
  severity tier (borderline, elevated, critical), collection date, panel type, and
  recommended next action — without storing any raw PHI values. Called by
  aireadylife-health-lab-review for each out-of-range result.
---

# aireadylife-health-flag-out-of-range-value

**Cadence:** As-received (called during lab review for each out-of-range biomarker)
**Produces:** Flagged entry in `vault/health/open-loops.md`

## What It Does

Called by `aireadylife-health-lab-review` once for each biomarker identified as outside its reference range. The task's sole purpose is to write a structured, actionable flag to `open-loops.md` that tells the user exactly what needs attention and what to do — without embedding the raw numerical lab value.

The deliberate omission of raw values is a privacy design choice: `open-loops.md` is a file the user may reference casually, share with an AI assistant in a general context, or view on a shared screen. The actual lab numbers — which are PHI — remain only in the structured lab summary document in `vault/health/00_current/`. The flag provides enough information to act without being a PHI exposure point.

Each flag entry contains:
- **Biomarker name** — e.g., "LDL Cholesterol," "Fasting Glucose," "TSH"
- **Panel type** — lipid panel, metabolic panel, thyroid, CBC, etc.
- **Collection date** — date the blood was drawn (not the result date)
- **Severity tier** — BORDERLINE (within 10% of boundary), ELEVATED or LOW (outside boundary), CRITICAL (>20% outside boundary)
- **Trend vs. prior panel** — IMPROVING / WORSENING / STABLE / FIRST PANEL
- **Recommended action** — specific and actionable: "Repeat fasting glucose in 3 months per ADA guidelines," "Discuss LDL result with your PCP — statin threshold consideration," "Recheck TSH in 6 weeks with Free T4 to confirm," "Schedule follow-up with endocrinologist"
- **Source reference** — filename of the lab summary document containing the full value
- **Resolution status** — OPEN

When a biomarker flagged in a prior panel returns to normal range in the current panel, this task's calling op (`aireadylife-health-lab-review`) instructs `aireadylife-health-update-open-loops` to resolve the prior flag. The resolution record is preserved with a resolved date and note: "[Biomarker] returned to normal range per [YYYY-MM] panel."

## Apps

None

## Vault Output

- `vault/health/open-loops.md` — new out-of-range flag entry appended
