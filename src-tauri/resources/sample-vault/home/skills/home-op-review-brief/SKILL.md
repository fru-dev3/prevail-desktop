---
name: aireadylife-home-op-review-brief
type: op
cadence: weekly
description: >
  Home review brief — produced weekly when maintenance items are flagged or seasonal tasks
  are due, or on-demand. Compiles open maintenance items, seasonal tasks due within 14 days,
  current month home expenses, renewal alerts, and home value tracking.
  Triggers: "home brief", "home review", "maintenance check", "home status", "what's due at home".
---

# aireadylife-home-review-brief

**Cadence:** Weekly (when items flagged) or on-demand
**Produces:** Home brief — open maintenance, seasonal tasks, home expenses, renewal alerts, and action items

## What It Does

This op generates the home brief — a concise, ready-to-act summary of everything requiring attention for the home. It is designed to be readable in under two minutes and actionable immediately, with all relevant vendors, costs, and deadlines already surfaced.

The brief opens with a status line: whether there are any critical maintenance items requiring immediate action (safety issues, habitability risks), or whether the home is in routine maintenance mode. This framing tells the user at a glance whether they need to act today or whether the brief is informational.

The maintenance section shows all open items from the vault sorted by urgency and days open. Critical items (structural, safety, or habitability issues) are shown first regardless of age. Routine items that have been open more than 30 days are highlighted — these tend to be tasks that get deferred repeatedly and benefit from explicit surfacing. For each item: the task description, location in the home, how long it has been open, the assigned vendor if one exists, and estimated cost.

The seasonal tasks section focuses on what's due in the next 14 days — the immediate action window. It pulls from the seasonal maintenance schedule for the current month and shows any tasks without a completion record. Each task includes the last completed date (so the user can judge whether it was done recently enough to skip), the vendor for the task if assigned, and the estimated cost to budget. Tasks that are past due are flagged prominently with a count of how many days overdue.

The expenses section shows the current month's total home spend to date, broken down by category, and how it compares to budget. For renters, this includes rent, utilities, and any services. For homeowners, it includes mortgage context (how much of the monthly payment is interest vs. principal), utilities, maintenance, and any project expenses.

The renewal alerts section surfaces any upcoming deadlines: insurance renewal within 60 days, lease renewal window within 90 days (if renting), home warranty expiring within 30 days, or any contractor warranty on recent work expiring within 60 days.

For homeowners, the brief optionally includes a home value section: the most recent Zillow Zestimate or Redfin Estimate, the purchase price (for equity calculation), and the outstanding mortgage balance — giving a snapshot of current equity. This section is short and numerical.

## Triggers

- "Give me my home brief"
- "Home status update"
- "What maintenance is due?"
- "Home review"
- "What's happening at home this week?"
- "Any home items I should know about?"
- "Run the home brief"

## Steps

1. Read all open maintenance items from `~/Documents/aireadylife/vault/home/00_current/`; sort by urgency and days open
2. Read seasonal maintenance schedule from most recent schedule file; filter to tasks due within 14 days with no completion record
3. Read current month expense file from `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expenses.md`; calculate total to date
4. Read open-loops.md for any existing unresolved flags
5. Check renewal dates from config.md (insurance, lease, home warranty); flag any within threshold
6. If homeowner: pull Zestimate or most recent appraisal value from `~/Documents/aireadylife/vault/home/config.md`; calculate equity snapshot
7. Compile all sections into brief structure
8. Write brief to `~/Documents/aireadylife/vault/home/02_briefs/YYYY-MM-DD-home-brief.md`
9. Call `aireadylife-home-update-open-loops` with any new flags from the brief

## Input

- `~/Documents/aireadylife/vault/home/00_current/`
- `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expenses.md`
- `~/Documents/aireadylife/vault/home/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/home/open-loops.md`
- `~/Documents/aireadylife/vault/home/config.md`

## Output Format

```
# Home Brief — [Date]

## Status
[NORMAL / ATTENTION NEEDED / ACTION REQUIRED]

## Open Maintenance Items
| Item | Location | Open Days | Urgency | Vendor | Est. Cost |

## Seasonal Tasks — Due Within 14 Days
| Task | Last Done | Due Date | Days | Vendor | Est. Cost |

## Home Expenses — Month to Date
| Category | Spent | Budget | Remaining |
| Total | $X | $X | $X |

## Renewal Alerts
| Item | Expires | Days | Action |

## Home Value Snapshot (Homeowners)
Zestimate: $X | Mortgage Balance: $X | Equity: $X

## Action Items — This Week
## Action Items — This Month
## Watching
```

## Configuration

Required in `~/Documents/aireadylife/vault/home/config.md`:
- `home_type`, `insurance_renewal_date`, `lease_end_date` (if renting)
- `home_value` or most recent Zestimate date and value (for equity section)

## Error Handling

- If vault missing: direct to frudev.gumroad.com/l/aireadylife-home
- If no open maintenance items: note "No open items — home is in routine maintenance mode"
- If no expenses logged yet for the month: show $0 with note to log expenses

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/home/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/home/00_current/`, `02_expenses/`, `open-loops.md`, `config.md`
- Writes to: `~/Documents/aireadylife/vault/home/02_briefs/YYYY-MM-DD-home-brief.md`
- Writes to: `~/Documents/aireadylife/vault/home/open-loops.md`
