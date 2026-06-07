---
name: aireadylife-learning-flow-build-progress-summary
type: flow
trigger: called-by-op
description: >
  Reads all active learning items from vault, calculates completion percentage vs. time-elapsed percentage for each, produces a pace-ranked progress table (items most at risk of missing deadline at top), counts items completed this month, and compares monthly count to the monthly learning goal target. Returns structured data to the calling op.
---

## What It Does

Called by `aireadylife-learning-op-monthly-sync` and `aireadylife-learning-op-progress-review` to produce the core learning pace analysis. This flow handles the quantitative calculation layer — reading all active items, computing pace metrics, and producing a structured table — while the calling op handles brief writing and flag routing.

**Loading active items:** Reads all learning items in `vault/learning/00_current/` where status is "active" (not completed, paused, or archived). Each item has: title, type (course/certification/book), platform, total_units (hours or modules or pages — consistent within each item), completed_units, start_date, target_completion_date.

**Pace calculation for each item:**
1. completion_pct = (completed_units ÷ total_units) × 100
2. days_since_start = today − start_date
3. total_days = target_completion_date − start_date
4. time_elapsed_pct = (days_since_start ÷ total_days) × 100
5. pace_delta = completion_pct − time_elapsed_pct
6. Status: ahead if pace_delta > +15, on-pace if ±15, behind if pace_delta < −15

**Recovery calculation for behind items:** For any item where pace_delta < −15:
1. remaining_units = total_units − completed_units
2. days_remaining = target_completion_date − today
3. required_daily_pace = remaining_units ÷ days_remaining
4. Format as "X [minutes/modules/pages] per day for X more days"

**Monthly completion count:** Reads `vault/learning/01_prior/` for items where completion_date falls within the current month. Counts total completions by type (course/certification/book). Reads the monthly learning goal from `vault/learning/00_current/` — specifically the monthly completion target. Calculates achievement rate = completions ÷ target.

**Urgency sorting:** Returns the progress table sorted by urgency: behind items first (sorted by pace_delta ascending — most behind at top), then on-pace items (sorted by days_remaining ascending — nearest deadline at top), then ahead items.

## Steps

1. Read all active items from `vault/learning/00_current/` where status = active.
2. For each item: calculate completion_pct, time_elapsed_pct, pace_delta.
3. Classify each item as ahead/on-pace/behind based on pace_delta thresholds.
4. For behind items: calculate required daily pace to finish on time.
5. Sort all items by urgency (behind first, sorted by pace_delta ascending).
6. Read completion records from `vault/learning/01_prior/` for current month — count by type.
7. Read monthly goal target from `vault/learning/00_current/`.
8. Calculate monthly achievement rate.
9. Return structured progress table and monthly achievement data to calling op.

## Input

- `~/Documents/aireadylife/vault/learning/00_current/` — all active learning items
- `~/Documents/aireadylife/vault/learning/01_prior/` — completed items this month
- `~/Documents/aireadylife/vault/learning/00_current/` — monthly completion targets

## Output Format

Structured data returned to calling op:

```
Progress Table (sorted by urgency):

[BEHIND] [Title] ([Platform])
  Completion: X% | Time elapsed: X% | Deficit: Xpts
  Recovery: X [units] per day for X more days
  Target date: [date] ([X days remaining])

[ON PACE] [Title] ([Platform])
  Completion: X% | Time elapsed: X% | Delta: +/-X pts
  Target date: [date] ([X days remaining])

[AHEAD] [Title] ([Platform])
  Completion: X% | Time elapsed: X% | Ahead by: X pts
  Target date: [date] ([X days remaining])

Monthly Completion Summary:
  Completed this month: X (Courses: X, Certs: X, Books: X)
  Monthly goal: X completions
  Achievement rate: X%

Status counts:
  Behind: X | On pace: X | Ahead: X | Total active: X
```

## Configuration

Each active learning item in `vault/learning/00_current/` must have:
```yaml
title: "[name]"
type: course / certification / book
platform: "[platform or 'physical']"
total_units: X  # hours, modules, or pages
completed_units: X
unit_type: hours / modules / pages
start_date: "YYYY-MM-DD"
target_completion_date: "YYYY-MM-DD"
status: active
```

## Error Handling

- **Active item missing start_date or target_completion_date:** Cannot calculate pace. Return item with "dates missing — cannot calculate pace" note.
- **completed_units > total_units:** Data error. Flag and skip pace calculation for that item.
- **No active items:** Return empty table with monthly summary showing zero active items.
- **Monthly goal not configured:** Report completion count without achievement rate; note that monthly goal must be set in `vault/learning/00_current/` for achievement tracking.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/learning/00_current/`, `~/Documents/aireadylife/vault/learning/01_prior/`, `~/Documents/aireadylife/vault/learning/00_current/`
- Writes to: None (returns data to calling op)
