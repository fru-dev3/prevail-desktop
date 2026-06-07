---
name: aireadylife-benefits-task-flag-enrollment-window
type: task
cadence: annual
description: >
  Writes an urgent enrollment deadline alert to vault/benefits/open-loops.md when the open enrollment window is active or approaching. Includes enrollment start date, end date, effective date, list of elections that need to be reviewed, pointer to the plan comparison brief, and a calendar reminder note. Called by benefits-op-enrollment-review.
---

## What It Does

Called by `aireadylife-benefits-op-enrollment-review` when the annual open enrollment window is detected or approaching. Open enrollment is the single most time-constrained benefits event — the window is typically 2-4 weeks, elections made after the close cannot be changed until the next plan year (absent a qualifying life event), and missing the window entirely locks you into current elections for 12 more months. This flag ensures the deadline never sneaks up undetected.

**Urgency escalation:** The flag's urgency level escalates as the deadline approaches. Written as "watch" when the window opens (more than 14 days before close). Escalated to "urgent" when 14 days or fewer remain. When 3 days or fewer remain: the flag is written as a top-priority urgent item with a specific note that auto-renewal will occur if no action is taken — auto-renewal may perpetuate a suboptimal plan election for another full year.

**Election checklist:** The flag includes a plain-language checklist of every decision that needs to be made during enrollment. This prevents the common scenario where someone changes their medical plan election but forgets to update their FSA election, or switches to an HDHP without adding an HSA contribution. Standard checklist items: (1) Medical plan selection (compare options, select plan and tier); (2) HSA contribution election if HDHP is selected (choose annual amount, divide by pay periods); (3) Health FSA election if non-HDHP selected (estimate qualified expenses for next year, elect that amount); (4) Dental plan selection; (5) Vision plan selection; (6) Life insurance supplemental election review (opportunity to add coverage without medical underwriting during open enrollment); (7) Disability supplemental election review; (8) Beneficiary confirmation (verify 401k and life insurance beneficiaries are current); (9) Dependent coverage confirmation (add/remove dependents if situation changed).

**Plan comparison reference:** The flag links to the enrollment analysis brief in `vault/benefits/02_briefs/enrollment-YYYY.md` if it has been run — providing easy access to the plan comparison and recommendation without re-running the analysis.

**Calendar reminder note:** Appends a note for the ben/calendar agent to create a calendar reminder for the enrollment close date (action by the day before close, not the close date itself, to allow for system processing time).

## Steps

1. Receive enrollment window dates from calling op: start_date, end_date, plan_year_effective_date.
2. Calculate days_until_close = end_date − today.
3. Determine urgency: >14 days = watch, ≤14 days = urgent, ≤3 days = urgent + auto-renewal warning.
4. Check `vault/benefits/open-loops.md` for existing enrollment window flag — if found, update rather than duplicate.
5. Build election checklist appropriate to the user's situation (include HSA checklist items only if HDHP options exist; include FSA item only if non-HDHP is selected or being considered).
6. Check if enrollment analysis brief exists at `vault/benefits/02_briefs/enrollment-YYYY.md` — include reference if yes, note it has not been run if no.
7. Write (or update) enrollment flag to `vault/benefits/open-loops.md` with urgency, dates, checklist, and plan comparison reference.
8. Return confirmation with flag urgency level and action-by date to calling op.

## Input

- Enrollment window dates from calling op
- `~/Documents/aireadylife/vault/benefits/open-loops.md` — for deduplication check
- `~/Documents/aireadylife/vault/benefits/02_briefs/` — check if enrollment analysis exists
- `~/Documents/aireadylife/vault/benefits/config.md` — plan types available (for checklist customization)

## Output Format

Entry written to `vault/benefits/open-loops.md`:

```
## [ENROLLMENT] URGENT — Open Enrollment Closes [end_date] — [X days remaining]

Enrollment window: [start_date] – [end_date]
Effective date: [plan_year_effective_date]
Days remaining: X
Auto-renewal warning: [Yes — applies if no action taken before close / No]

Election checklist:
[ ] Medical plan selection (run enrollment review op for plan comparison)
[ ] HSA contribution election — $X/year ($X/paycheck) if selecting HDHP
[ ] Dental plan selection
[ ] Vision plan selection
[ ] Supplemental life insurance — review/adjust
[ ] Disability supplemental — review/adjust
[ ] Beneficiary confirmation (401k + life insurance)
[ ] Dependent coverage confirmation

Plan comparison brief: vault/benefits/02_briefs/enrollment-[YYYY].md [Available / Not yet run — run enrollment review op first]

Action by: [end_date minus 1 day]
Calendar reminder: Add to calendar — enrollment closes [end_date]

Status: Open
```

## Configuration

No configuration required. Called by the enrollment review op with specific dates. Flag uses plan year and dates passed by the op.

## Error Handling

- **Enrollment dates not provided:** Cannot write flag without dates. Return error to calling op with request to provide enrollment window dates (available from HR portal or benefits package communication).
- **End date is in the past:** Enrollment has already closed. Write an "enrollment closed" informational entry noting the elections are locked for the plan year and next opportunity is next open enrollment or a qualifying life event.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/benefits/open-loops.md`, `~/Documents/aireadylife/vault/benefits/02_briefs/`
- Writes to: `~/Documents/aireadylife/vault/benefits/open-loops.md`
