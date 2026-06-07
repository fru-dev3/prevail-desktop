---
name: aireadylife-health-op-lab-review
type: op
cadence: as-received
description: >
  Triggered when new lab results arrive from a patient portal (MyChart/Epic) or are
  uploaded manually. Parses each biomarker against clinical reference ranges (glucose,
  A1c, LDL, HDL, TSH, creatinine, CBC, and more), flags out-of-range values with
  severity tier, and builds a structured panel summary grouped by test category with
  trend arrows vs. the prior panel. Triggers: "lab results came in", "new lab report",
  "blood work is ready", "process my labs".
---

# aireadylife-health-lab-review

**Cadence:** As-received (triggered when new lab results are available)
**Produces:** Structured lab summary in `vault/health/00_current/`; flagged open-loop items in `vault/health/open-loops.md`

## What It Does

Runs whenever new lab results arrive — downloaded from the configured patient portal (MyChart or equivalent) or manually placed in the vault by the user. This is the primary op for processing all clinical lab data and is the only op that writes to `vault/health/00_current/`.

The op reads the incoming lab result file from `vault/health/00_current/` (PDF, structured text, or the standardized vault template). It calls `aireadylife-health-build-lab-summary` to parse every biomarker, compare against clinical reference ranges, compute trend direction vs. the prior panel, group results by panel type (metabolic, lipid, CBC, thyroid, hormones, vitamins), and write the formatted summary document.

For each biomarker outside its reference range, the op calls `aireadylife-health-flag-out-of-range-value` to write a structured flag to `open-loops.md`. The flag records only metadata — biomarker name, severity tier (borderline, elevated, critical), collection date, panel type, and recommended action — never the raw numerical value. This design keeps PHI confined to the lab summary document and allows open-loops.md to be referenced freely.

Severity tiering: a value more than 20% outside the reference boundary is critical; values outside the boundary but within 20% are elevated or low; values within the boundary but within 10% of the boundary are borderline-watch. Recommended actions are specific: "Repeat fasting glucose in 3 months," "Discuss LDL result with PCP — consider medication review," "Recheck TSH in 6 weeks with Free T4."

The op concludes by calling `aireadylife-health-update-open-loops` to consolidate all new flags and auto-resolve any prior lab flags for biomarkers that have returned to normal range in this panel.

## Calls

- **Flows:** `aireadylife-health-build-lab-summary`
- **Tasks:** `aireadylife-health-flag-out-of-range-value`, `aireadylife-health-update-open-loops`

## Apps

- `mychart` — download lab results PDFs from patient portal (if auto-download is configured)

## Vault Output

- `vault/health/00_current/YYYY-MM-lab-summary.md` — formatted lab summary
- `vault/health/open-loops.md` — out-of-range biomarker flags

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/health/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/health/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/health/02_briefs/` — prior briefs for period-over-period context
