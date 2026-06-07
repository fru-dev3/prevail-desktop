---
name: aireadylife-home-flow-build-maintenance-schedule
type: flow
trigger: called-by-op
description: >
  Generates the complete seasonal maintenance checklist for the current season: task name,
  frequency, last-done date, next-due date, urgency, assigned vendor, and estimated cost.
  Checks completion records against the seasonal calendar and flags overdue or due-this-season tasks.
---

# aireadylife-home-build-maintenance-schedule

**Trigger:** Called by `aireadylife-home-seasonal-maintenance`
**Produces:** Structured maintenance schedule table sorted by urgency and due date

## What It Does

This flow assembles the seasonal maintenance schedule by joining two sources: the home's maintenance history (when each recurring task was last completed) and the built-in seasonal task calendar. It calculates each task's next due date from the last completion date and the task's frequency, identifies what's overdue and what's coming due this season, and formats the result as a sortable checklist with enough context to schedule vendors and budget for the work.

The built-in seasonal maintenance calendar covers the following recurring tasks with their standard frequencies and estimated costs:

**Monthly (year-round):**
- HVAC filter replacement: every 30 days for 1-inch filters, every 90 days for 4–5 inch media filters. Cost: $15–$40. A neglected filter reduces system efficiency (costing more in energy) and shortens compressor life. For a whole-home system, this is the single highest-ROI monthly maintenance task.
- Smoke detector test: monthly button test; no replacement required unless alarm fails to sound. Battery replacement: annually (October recommended). Full detector replacement: every 10 years per manufacturer recommendation.

**Quarterly:**
- Exterior inspection: walk the perimeter of the home. Check for foundation cracks, window seal failures, siding damage, roof visible issues. Flag anything that has changed since last quarter.
- Pest inspection (if in active treatment): check for new activity in crawl spaces, garage, and entry points.

**Spring (April–May):**
- AC tune-up and check: schedule HVAC technician before cooling season. Cost: $75–$150. Checks refrigerant levels, cleans coils, verifies thermostat calibration.
- Gutter cleaning: clear winter debris before spring rains. Cost: $75–$200 for single-story, $150–$300 multi-story.
- Roof inspection: post-winter check for missing or lifted shingles, flashing damage, soffit or fascia deterioration. Cost: free (DIY visual from ground) or $100–$300 for professional.
- Window and door weatherstripping check: replace any damaged or compressed weatherstripping before summer heat.
- Exterior faucet and irrigation activation: reopen shut-off valves; inspect for freeze damage.

**Fall (September–October):**
- Furnace or boiler inspection and tune-up: before heating season. Cost: $80–$150. Most critical seasonal task — a failed heat exchanger is a carbon monoxide risk.
- Gutter cleaning (second annual): remove fall leaves before they freeze and cause ice dams. Cost same as spring.
- Weatherstripping and door sweep inspection: prepare for heating season.
- Sprinkler system winterization (blow-out): critical in freeze climates; prevents pipe and head damage. Cost: $50–$100 by a licensed irrigation contractor.
- Lawn winterization: final mow, aerate, and fertilize before dormancy.
- Pipe insulation check: verify insulation on any exposed exterior pipes.

**Annual:**
- Water heater flush: flush sediment annually to extend life and maintain efficiency. Cost: DIY free (15 minutes) or $50–$100 for a plumber.
- Dryer vent cleaning: reduces fire risk. Cost: $100–$175 by HVAC or chimney service. Lint accumulation in the vent duct is one of the leading causes of residential fires.
- Chimney inspection (if applicable): once per year if using fireplace or wood stove. Cost: $100–$250.
- Whole-home pest inspection: annual baseline check. Cost: $75–$150.

**Every 3 years:**
- Roof professional inspection: even if no visible issues, schedule a professional roof inspection every 3 years. A missed small issue (flashing, boot seal) becomes a $5,000–$15,000 problem. Cost: $100–$300.

## Steps

1. Read maintenance history records from `~/Documents/aireadylife/vault/home/00_current/`
2. Load the built-in seasonal task calendar (hardcoded in this skill)
3. For each recurring task, calculate next due date from last-completion date and frequency
4. Determine current season from today's date (spring: Mar–May, summer: Jun–Aug, fall: Sep–Nov, winter: Dec–Feb)
5. Filter to tasks due this season or already overdue
6. For each task: look up the assigned vendor in config.md if one exists
7. Flag overdue tasks (past next-due date) with escalating urgency:
   - 0–14 days overdue: flag as due-soon
   - 15–30 days overdue: flag as overdue
   - 31+ days overdue: flag as significantly-overdue
8. Sort full list: overdue first by days overdue, then due-this-season by due date
9. Return formatted schedule to calling op

## Input

- `~/Documents/aireadylife/vault/home/00_current/` — task completion history records
- `~/Documents/aireadylife/vault/home/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/home/config.md` — vendor assignments per task, home-specific details (1-inch vs. 4-inch HVAC filter, whether home has irrigation system, chimney/fireplace)

## Output Format

| Urgency | Task | Frequency | Last Done | Next Due | Days Until/Past | Vendor | Est. Cost |
|---------|------|-----------|-----------|----------|-----------------|--------|-----------|
| OVERDUE | Furnace inspection | Annual | 2023-10-01 | 2024-10-01 | -180 days | Aire Serv | $80–$150 |
| DUE NOW | Gutter cleaning | 2×/yr | 2024-04-15 | 2024-10-01 | 0 days | Clean Gutters LLC | $150 |
| UPCOMING | HVAC filter | 90 days | 2024-09-01 | 2024-12-01 | 50 days | DIY | $25 |

## Configuration

Required in `~/Documents/aireadylife/vault/home/config.md`:
- `hvac_filter_type` — "1-inch" (monthly) or "4-inch" (90-day)
- `has_irrigation_system` — true/false (triggers sprinkler blow-out task)
- `has_chimney` — true/false (triggers chimney inspection task)
- Vendor assignments: `hvac_vendor`, `gutter_vendor`, `pest_vendor`, etc.

## Error Handling

- If no maintenance history for a task: flag as "no completion record — schedule as due" and treat as overdue
- If config.md missing home type details: use conservative defaults (assume 1-inch filter, no irrigation, no chimney)
- If vendor is not assigned for a task: show "No vendor assigned" in the vendor column

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/home/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/home/00_current/`
- Reads from: `~/Documents/aireadylife/vault/home/config.md`
- Writes to: `~/Documents/aireadylife/vault/home/00_current/YYYY-{season}-schedule.md`
