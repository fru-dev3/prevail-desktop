---
name: aireadylife-health-op-preventive-care-review
type: op
cadence: quarterly
description: >
  Quarterly preventive care check. Reads the personal care schedule from vault/health/
  03_preventive/ and compares each screening against its last-completed date and
  recommended recurrence interval. Flags overdue items with urgency tier and scheduling
  action. Covers: annual physical, dental 2x/year, eye exam annually, colonoscopy at
  45+, mammogram, dermatology, flu shot, and provider-configured items. Triggers:
  "preventive care review", "check my screenings", "what checkups am I overdue for",
  "preventive health review".
---

# aireadylife-health-preventive-care-review

**Cadence:** Quarterly (1st of January, April, July, October)
**Produces:** Preventive care gap flags in `vault/health/open-loops.md`; updated care schedule in `vault/health/00_current/`

## What It Does

Runs quarterly to ensure age- and risk-appropriate preventive care stays on schedule. The quarterly cadence is the right frequency: annual screenings need to be caught if missed by more than a quarter, but daily or weekly checking would add noise for items that only need attention a few times per year.

The op reads the care schedule file from `vault/health/00_current/care-schedule.md`, which lists every applicable screening for the user's age and risk profile. The default schedule includes: annual physical with PCP (every 12 months), dental cleaning (every 6 months), comprehensive eye exam (every 12 months; every 24 months if no corrective lenses and no risk factors), skin check with dermatologist (every 12 months if history of significant sun exposure or family melanoma), flu vaccination (annually in fall, September–November), and age-gated screenings: colorectal cancer (colonoscopy every 10 years starting at age 45, or stool DNA test every 3 years), PSA discussion for men 50+ (or 40+ with family history), mammogram for women 40+ (annually or biennially per individual risk).

For each screening, the op calculates days since the last-completed date (read from the completion log at `vault/health/00_current/completion-log.md`) and compares it to the recommended interval. Items are categorized: CURRENT (within schedule), DUE SOON (within 30 days of the interval deadline), OVERDUE (past the interval deadline), or NEVER COMPLETED (no completion record and age-appropriate). Overdue items are further tiered: routine (1–30 days overdue), soon (31–90 days overdue), and overdue (90+ days, flag as high urgency).

Each gap is passed to `aireadylife-health-flag-preventive-care-gap` with the care type, last completed date, recommended interval, days overdue, and a specific suggested action (e.g., "Call [PCP name] at [number] to schedule annual physical" or "Use online scheduling at [portal URL]"). The care schedule file in `vault/health/00_current/` is updated with the current run timestamp so the next quarterly review has an accurate baseline.

## Calls

- **Tasks:** `aireadylife-health-flag-preventive-care-gap`, `aireadylife-health-update-open-loops`

## Apps

None

## Vault Output

- `vault/health/00_current/care-schedule.md` — updated with last-review date and status per item
- `vault/health/open-loops.md` — new care gap flags appended

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/health/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/health/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/health/02_briefs/` — prior briefs for period-over-period context
