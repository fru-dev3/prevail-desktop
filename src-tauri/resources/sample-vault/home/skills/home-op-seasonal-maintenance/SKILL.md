---
name: aireadylife-home-op-seasonal-maintenance
type: op
cadence: quarterly
description: >
  Quarterly seasonal maintenance planner. Generates the seasonal checklist for the upcoming
  season (spring/summer/fall/winter), computes what's overdue vs. due, assigns vendors,
  and estimates total seasonal maintenance cost. Triggers: "seasonal maintenance",
  "home maintenance", "maintenance checklist", "spring maintenance", "fall maintenance".
---

# aireadylife-home-seasonal-maintenance

**Cadence:** Quarterly (March, June, September, December)
**Produces:** Seasonal maintenance checklist with due dates, vendors, costs, and total seasonal budget

## What It Does

This op runs at the start of each season to produce the complete seasonal maintenance plan for the home. It translates the abstract idea of "keeping up with home maintenance" into a concrete, budgeted, vendor-assigned action list for the next three months — the kind of plan that prevents the deferred maintenance spiral where small issues compound into expensive repairs.

The op reads the home's complete maintenance history to calculate what's overdue, what becomes due this season, and what can wait. This prevents both over-scheduling (doing things that don't need doing yet) and under-scheduling (missing tasks that are past due). For each task in the seasonal plan, it identifies whether the user has a preferred vendor from prior history logged in the vault, provides the estimated cost range based on national averages and home size, and notes the recommended scheduling window within the season (e.g., "furnace inspection: schedule September 15–October 15 — HVAC companies book out in late October").

The seasonal schedule by season:

**Spring (March–May):** AC tune-up ($75–$150), gutter cleaning ($75–$300 depending on height and linear footage), roof inspection — visual or professional ($0 DIY / $100–$300 pro), window and door seal check ($0 DIY), exterior walk-through for winter damage ($0 DIY), irrigation system activation and head check ($50–$100 pro or $0 DIY), deck and patio inspection for winter damage ($0 DIY), test smoke and CO detectors.

**Summer (June–August):** HVAC filter replacement if 1-inch type (every 30 days), deck sealing if needed (every 2–3 years — check condition), window cleaning ($100–$300 if using service), exterior paint touch-up inspection, pest control treatment if on schedule.

**Fall (September–November):** Furnace or boiler inspection and tune-up ($80–$150 — HIGHEST PRIORITY of all seasonal tasks), gutter cleaning second pass ($75–$300), weatherstripping replacement if needed ($20–$60 DIY), sprinkler system winterization ($50–$100 if applicable), pipe insulation check (any exposed exterior pipes), water heater flush ($0 DIY or $50–$100 pro), smoke detector battery replacement (October — replace all with fresh batteries), dryer vent cleaning ($100–$175 pro), chimney inspection if applicable ($100–$250).

**Winter (December–February):** Exterior faucet and hose bib verification (shut-off valves closed), check weatherstripping on all exterior doors and garage, monitor for ice dams (if in cold climate), HVAC filter replacement if 1-inch type.

The op calculates total estimated seasonal maintenance cost across all planned tasks, giving the user a pre-season budget. It then flags any task that has been deferred from a prior season as overdue with an elevated urgency notation and a cost-of-deferral note where applicable (e.g., "Furnace inspection deferred from last fall — running furnace uninspected through winter risks heat exchanger failure. Estimated emergency repair cost if failure occurs: $1,500–$3,500").

## Triggers

- "Run seasonal maintenance planning"
- "What home maintenance is due this season?"
- "Spring maintenance checklist"
- "Fall maintenance tasks"
- "Home maintenance plan for [season]"
- "What do I need to schedule for [month]?"
- "Home seasonal prep"

## Steps

1. Determine current season from today's date (spring: Mar–May, summer: Jun–Aug, fall: Sep–Nov, winter: Dec–Feb)
2. Call `aireadylife-home-build-maintenance-schedule` to compute task due dates and overdue status
3. Filter to current season's task set plus any overdue tasks from prior seasons
4. For each task: look up preferred vendor in config.md; note vendor contact info if present
5. Flag any tasks deferred from a prior season as overdue with cost-of-deferral context
6. Calculate total estimated seasonal maintenance cost (sum of all task cost estimates using midpoint of range)
7. Write seasonal checklist to `~/Documents/aireadylife/vault/home/00_current/YYYY-{season}-checklist.md`
8. Call `aireadylife-home-flag-maintenance-item` for any overdue or significantly-overdue items
9. Call `aireadylife-home-update-open-loops` with all newly flagged items
10. Present checklist sorted by urgency with total cost estimate and scheduling notes

## Input

- `~/Documents/aireadylife/vault/home/00_current/` — maintenance history
- `~/Documents/aireadylife/vault/home/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/home/config.md` — vendor assignments, home type details, HVAC filter type, irrigation/chimney presence

## Output Format

**Seasonal Maintenance Plan — [Season] [Year]**
**Total Estimated Cost: $X–$X**

| Priority | Task | Due Window | Last Done | Vendor | Est. Cost | Status |
|----------|------|------------|-----------|--------|-----------|--------|
| OVERDUE | Furnace inspection | Sep–Oct | Never | Aire Serv | $80–$150 | Schedule today |
| HIGH | Gutter cleaning | Oct 1–31 | Apr 2024 | Clean Gutters | $150 | Schedule Oct |
| MEDIUM | Weatherstripping | Oct–Nov | Jun 2023 | DIY | $20–$60 | Do this month |

**Cost-of-Deferral Notes:** For any overdue item

**Vendor Contact List:** Compiled from config.md for all tasks in the plan

## Configuration

Required in `~/Documents/aireadylife/vault/home/config.md`:
- `hvac_filter_type`, `has_irrigation_system`, `has_chimney`, `has_deck`
- Vendor assignments: `hvac_vendor`, `gutter_vendor`, `pest_vendor`, `irrigation_vendor`

## Error Handling

- If vault missing: direct to frudev.gumroad.com/l/aireadylife-home
- If no maintenance history: treat all seasonal tasks as due; note this is first-run behavior
- If vendor not assigned for a task: suggest searching Angi or Thumbtack for the service type and zip code

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/home/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/home/00_current/`, `config.md`
- Writes to: `~/Documents/aireadylife/vault/home/00_current/YYYY-{season}-checklist.md`
- Writes to: `~/Documents/aireadylife/vault/home/open-loops.md`
