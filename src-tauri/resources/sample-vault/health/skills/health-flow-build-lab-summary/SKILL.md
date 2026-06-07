---
name: aireadylife-health-flow-build-lab-summary
type: flow
trigger: called-by-op
description: >
  Builds a structured lab result summary with current biomarker values, reference
  ranges, trend direction vs. the prior panel, and out-of-range items surfaced first
  within each panel group. Compares glucose, A1c, LDL, HDL, TSH, creatinine, CBC,
  and all metabolic markers against clinical reference ranges and flags deviations
  with severity tier (borderline, elevated, critical).
---

# aireadylife-health-build-lab-summary

**Trigger:** Called by `aireadylife-health-lab-review`
**Produces:** Formatted lab summary document in `vault/health/00_current/YYYY-MM-lab-summary.md` with out-of-range items surfaced first

## What It Does

Reads the incoming lab result file (PDF or structured text) from `vault/health/00_current/` and produces a clean, clinician-readable summary grouped by panel type. Every biomarker is evaluated against its standard reference range using the embedded clinical thresholds: fasting glucose 70–99 mg/dL; A1c <5.7%; LDL <100 mg/dL; HDL >40 mg/dL (male) / >50 mg/dL (female); total cholesterol <200 mg/dL; triglycerides <150 mg/dL; TSH 0.4–4.0 mIU/L; creatinine 0.6–1.2 mg/dL; eGFR ≥60; ALT 7–56 U/L; AST 10–40 U/L; hemoglobin 13.5–17.5 g/dL (male) / 12.0–15.5 (female); WBC 4.5–11.0 K/µL; platelets 150–400 K/µL; Vitamin D 30–100 ng/mL.

Within each panel group, results are sorted so out-of-range values appear first, followed by borderline values, then normal values — mirroring how a physician reads a lab report. Any value more than 20% outside the reference range is marked critical; values within the range but approaching a threshold (within 10% of the boundary) are marked borderline-watch.

Where a prior panel exists in `vault/health/00_current/`, each biomarker gets a trend arrow: improving (↑ for HDL, ↓ for LDL/glucose/A1c where lower is better), worsening, or stable (change less than 5% of reference range width). Trend context is particularly important for A1c, LDL, and creatinine where direction matters as much as the current value.

The output document deliberately contains no free-text narrative about what values mean for the user's specific condition — that remains the provider's domain. The summary is a structured reference for the user and their physician, not a diagnosis.

## Triggers

- "lab results came in"
- "my blood work is back"
- "new labs from my doctor"
- "build a lab summary"
- "what did my lab panel show"
- "flag my out-of-range results"
- "compare to my last panel"
- "lab review"

## Steps

1. Read the most recent lab result file from `vault/health/00_current/` (newest file by date in filename)
2. Parse each biomarker name, value, and unit from the structured result or PDF text
3. Look up the reference range for each biomarker from the embedded clinical threshold table
4. Classify each result: normal, borderline-watch (within 10% of boundary), elevated/low (outside range), or critical (>20% outside range)
5. Search `vault/health/00_current/` for the prior panel (previous YYYY-MM file) and calculate trend direction for each biomarker
6. Group results by panel type: metabolic panel, lipid panel, CBC, thyroid, hormones, vitamins/minerals, other
7. Within each group, sort: critical first, then elevated/low, then borderline-watch, then normal
8. Write the formatted summary to `vault/health/00_current/YYYY-MM-lab-summary.md` using a consistent markdown table structure
9. Return the list of out-of-range biomarkers (name, severity, and trend) to the calling op for flag generation

## Input

- `vault/health/00_current/YYYY-MM-*.pdf` or `vault/health/00_current/YYYY-MM-*.md` — incoming lab result (newest file)
- `vault/health/00_current/` — prior panel files for trend comparison
- `vault/health/01_prior/` — prior period records for trend comparison
- `vault/health/config.md` — provider-configured reference range overrides (e.g., LDL target <70 if cardiac history noted)

## Output Format

Markdown document saved to `vault/health/00_current/YYYY-MM-lab-summary.md` with the following structure:
- Header: collection date, ordering provider, lab facility
- One section per panel type, each containing a markdown table with columns: Biomarker | Value | Unit | Reference Range | Status | vs. Prior
- Status column uses labels: NORMAL / BORDERLINE / ELEVATED / LOW / CRITICAL
- Footer: count of flagged items and list of items requiring follow-up

## Configuration

Required fields in `vault/health/config.md`:
- `provider_name` — used in summary header
- `lab_facility` — optional, used in header
- `ldl_target` — override standard LDL reference if provider has set a custom target
- `a1c_target` — override if provider has set a non-standard A1c goal

## Error Handling

- If no lab file is found in `vault/health/00_current/`: report "No lab results found. Upload a result file to vault/health/00_current/ and try again."
- If the lab file cannot be parsed (PDF with image scan, non-standard format): prompt user to copy the text values manually into a structured template provided in the vault
- If no prior panel exists for trend comparison: write "First panel — no trend available" in the vs. Prior column
- If a biomarker's reference range is not in the embedded table: flag it as "Reference range unknown — review with provider"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/health/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/health/00_current/` (all files)
- Reads from: `~/Documents/aireadylife/vault/health/config.md`
- Writes to: `~/Documents/aireadylife/vault/health/00_current/YYYY-MM-lab-summary.md`
