---
name: aireadylife-estate-op-maintenance-review
type: op
cadence: monthly
description: >
  Monthly maintenance review across all rental properties. Checks open maintenance items,
  upcoming seasonal tasks, vendor follow-ups, warranty expirations, and CapEx replacement
  timelines. Flags items overdue or due within 30 days with urgency escalation.
  Triggers: "maintenance review", "property maintenance", "what needs fixing", "maintenance status".
---

# aireadylife-estate-maintenance-review

**Cadence:** Monthly (1st of month)
**Produces:** Maintenance status report in `~/Documents/aireadylife/vault/estate/00_current/` with all open items, seasonal tasks, vendor follow-ups, and open loop flags

## What It Does

This op reviews the complete maintenance picture across all rental properties monthly. Deferred maintenance is one of the biggest destroyers of rental property profitability — a $200 HVAC filter replacement ignored for a year can lead to a $5,000 compressor failure; a $150 gutter cleaning skipped for two years can produce $15,000 in water damage. This op exists to prevent that outcome by keeping maintenance visible and prioritized.

The review works in four layers. First, open items: the op reads all maintenance items currently logged across every property and categorizes them by status (new, in-progress, awaiting-vendor, awaiting-parts, completed). For each open item, it checks the target completion date and flags items overdue or approaching (within 30 days). Emergency items (safety risk, habitability threat) that appear without a logged vendor appointment within 24 hours are escalated immediately — landlords have legal obligations in most states to remedy habitability issues within 24–72 hours depending on the issue.

Second, the seasonal schedule: the op checks the built-in seasonal maintenance calendar against the current month and property-specific last-service records. Key recurring tasks across all properties: HVAC filter replacement every 90 days (filter cost: $15–$40; skipping it reduces efficiency and shortens compressor life), gutter cleaning in April and October ($75–$200/property — prevents ice dams and fascia rot), annual furnace or boiler inspection in September/October ($80–$150/unit — catches heat exchanger cracks before winter), smoke and CO detector test and battery replacement in October, exterior walk-through in April after freeze-thaw season, lawn winterization and sprinkler blow-out in October/November.

Third, vendor follow-ups: the op scans all maintenance items and seasonal tasks where a vendor was contacted, and checks whether a quote was received, appointment was scheduled, or work was completed. Any vendor follow-up open for more than 14 days without a resolution event is flagged.

Fourth, warranty tracking: the op checks all appliances and HVAC systems recorded in the vault for warranty expiration within 90 days. Expired warranties on major systems (HVAC, water heater, refrigerator) mean repair costs shift fully to the owner — knowing this in advance enables proactive decisions like purchasing an extended warranty or scheduling replacement.

## Triggers

- "Review maintenance across my properties"
- "What maintenance is due this month?"
- "Property maintenance update"
- "What needs fixing at my rentals?"
- "Maintenance status"
- "Any deferred maintenance I should know about?"
- "Check seasonal tasks"
- "Vendor follow-ups"

## Steps

1. Read all open maintenance items from `~/Documents/aireadylife/vault/estate/00_current/` for each property
2. Call `aireadylife-estate-check-maintenance-schedule` to evaluate open items and seasonal tasks
3. Check each item's target date and vendor status; apply urgency escalation rules (14-day routine → urgent; 3-day urgent → emergency)
4. Check seasonal maintenance calendar for current month; identify tasks due with no current-season completion record
5. Scan all vendor follow-up notes; flag any open more than 14 days without update
6. Check appliance and HVAC warranty records for items expiring within 90 days
7. Call `aireadylife-estate-flag-maintenance-item` for any newly identified issue or urgency escalation
8. Write per-property maintenance summary to `~/Documents/aireadylife/vault/estate/00_current/YYYY-MM-maintenance-report.md`
9. Call `aireadylife-estate-update-open-loops` with all flagged items
10. Present full report organized by property, sorted by urgency

## Input

- `~/Documents/aireadylife/vault/estate/00_current/` — all open maintenance items and vendor notes
- `~/Documents/aireadylife/vault/estate/00_current/` — appliance/HVAC warranty records and capital item installation dates
- `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records for trend comparison

## Output Format

**Maintenance Review — [Month Year]**

Per property section:
```
### [Property Address]
**Open Items:** [count] (X emergency, Y urgent, Z routine)
| Item | Status | Due Date | Days O/D | Vendor | Vendor Last Contact |

**Seasonal Tasks Due:**
| Task | Last Done | Due This Month | Appointment? |

**Vendor Follow-Ups Stale >14 Days:**
| Vendor | Task | Last Contact | Days Without Update |

**Warranties Expiring Within 90 Days:**
| Item | Warranty Expires | Action |
```

**Action Items (sorted by urgency):** Full list across all properties

## Configuration

Required in `~/Documents/aireadylife/vault/estate/config.md`:
- Property list with addresses
- Per property: appliance warranty dates in property record, capital item installation dates

## Error Handling

- If no maintenance records for a property: output "No open items" and run seasonal check
- If appliance warranty data not in vault: note "Warranty data not tracked — add to property record to enable warranty monitoring"
- If vault missing: direct to frudev.gumroad.com/l/aireadylife-estate

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Reads from: `~/Documents/aireadylife/vault/estate/00_current/`
- Writes to: `~/Documents/aireadylife/vault/estate/00_current/YYYY-MM-maintenance-report.md`
- Writes to: `~/Documents/aireadylife/vault/estate/open-loops.md`
