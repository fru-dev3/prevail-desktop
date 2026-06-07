---
name: aireadylife-estate-flow-check-maintenance-schedule
type: flow
trigger: called-by-op
description: >
  Reviews all open maintenance items and upcoming seasonal tasks across all rental properties
  against the current date. Flags items that are overdue or due within 30 days, escalates
  urgency by days overdue, and checks vendor appointment status for scheduled tasks.
---

# aireadylife-estate-check-maintenance-schedule

**Trigger:** Called by `aireadylife-estate-maintenance-review`
**Produces:** Maintenance status list with open items, overdue flags, seasonal tasks due, and urgency escalations returned to the calling op

## What It Does

This flow reads all open maintenance records across every rental property and evaluates each against the current date, applying a tiered escalation model based on how overdue an item is and its initial urgency classification. It also runs through a built-in seasonal maintenance calendar and checks whether recurring preventive tasks are due this month and whether completion records exist for them.

**Open maintenance items** are read from the maintenance folder for each property. Each item carries an initial urgency classification set when it was logged: routine (scheduled preventive task — no immediate consequence if slightly delayed), urgent (functional issue that degrades habitability or property condition — needs resolution within 14 days), or emergency (immediate safety risk or habitability threat — legally requires resolution within 24–72 hours in most states). The flow checks each item's target completion date against today's date:

- Routine items are flagged as overdue when past their target date. They escalate to urgent classification when 14+ days overdue.
- Urgent items that are 3+ days overdue escalate to emergency classification.
- Emergency items with no logged vendor appointment or repair action within 24 hours are flagged as critical with an immediate escalation note.

**Seasonal maintenance calendar** checks: For each property, the flow evaluates the following recurring tasks against the current calendar month and checks for a completion record in the vault from the current season. HVAC filter replacement: every 90 days per property — if the last replacement date logged is more than 90 days ago, flag as due. Gutter cleaning: April and October (flag if in these months and no completion record for current season). Annual furnace/boiler inspection: September or October (flag if approaching and no current-year record). Smoke and CO detector test: October (once per year, flag if no record for current year). Exterior inspection post-winter: April (check roof, siding, foundation for freeze damage). Lawn winterization: October–November. Pest control treatment: spring (April–May) and fall (September–October). For vendor-dependent tasks (HVAC inspection, pest control), the flow also checks whether a vendor appointment is logged — if not, this is a separate flag ("task due but no appointment scheduled").

**CapEx reserve tracking:** For each property, the flow checks the ages of major capital items recorded in the vault (roof installation date, HVAC installation date, water heater installation date) against their expected useful life (roof: 20 years, HVAC: 15 years, water heater: 10 years). Any item within 3 years of end of useful life is flagged as "CapEx approaching" so the owner can begin setting aside replacement reserves.

## Steps

1. Read all open maintenance items from `~/Documents/aireadylife/vault/estate/00_current/` for each property
2. Check each item's target completion date against today; classify as on-track, due-soon (≤30 days), or overdue
3. Apply urgency escalation: routine overdue 14+ days → urgent; urgent overdue 3+ days → emergency
4. Load built-in seasonal maintenance calendar; evaluate which seasonal tasks are due this month for each property
5. Check vault for completion records for each seasonal task in the current season; flag any missing records
6. For vendor-dependent seasonal tasks, check for logged appointment; flag if task due but no appointment
7. Read major capital item installation dates from property records; flag any CapEx item within 3 years of end-of-life
8. Categorize all flags by property and urgency level
9. Return full maintenance status list to calling op

## Input

- `~/Documents/aireadylife/vault/estate/00_current/` — open maintenance items per property
- `~/Documents/aireadylife/vault/estate/00_current/` — property records with major capital item installation dates
- `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records for trend comparison
- Built-in seasonal maintenance calendar (hardcoded schedule, no vault source required)

## Output Format

**Maintenance Status by Property:**

For each property:
```
### [Property Address]
**Open Items:**
| Item | Urgency | Due Date | Days Overdue | Vendor | Status |

**Seasonal Tasks Due This Month:**
| Task | Frequency | Last Done | Due | Appointment? |

**CapEx Approaching:**
| System | Installed | Life (yr) | Years Remaining |
```

**Summary:** Total open items by urgency across all properties (X emergency, Y urgent, Z routine)

## Configuration

Required in `~/Documents/aireadylife/vault/estate/config.md`:
- Property list with addresses
- Per property in `00_properties/`: `roof_installed`, `hvac_installed`, `water_heater_installed` dates

## Error Handling

- If no maintenance records exist for a property: output "No open items" and still run seasonal check
- If a capital item installation date is missing: note "Installation date unknown — cannot calculate remaining life"
- If a seasonal task has no completion record at all (new vault): flag as due and note "No prior completion records"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Writes to: `~/Documents/aireadylife/vault/estate/00_current/YYYY-MM-maintenance-status.md`
