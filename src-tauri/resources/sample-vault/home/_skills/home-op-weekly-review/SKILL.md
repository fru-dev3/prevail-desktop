---
name: aireadylife-home-op-weekly-review
type: op
cadence: weekly
description: >
  Weekly home check. Reviews open maintenance items for urgent or overdue status, surfaces
  seasonal tasks due this week, checks for stale vendor responses, and flags any newly
  critical items. Stays silent if nothing needs attention. Triggers: "weekly home review",
  "home this week", "maintenance this week", "home check".
---

# aireadylife-home-weekly-review

**Cadence:** Weekly (Monday) — only outputs when items need attention
**Produces:** Weekly home snapshot in `~/Documents/aireadylife/vault/home/00_current/weekly-snapshot.md` when items are flagged

## What It Does

This op is the lightweight weekly check between monthly syncs — the Monday morning scan that surfaces only what actually needs attention this week. It is designed to be fast (under 30 seconds to read), silent when there's nothing to act on, and specific when there is.

The op checks three things. First, open maintenance items: are any of the current open items now overdue (past their target completion date)? Have any routine items escalated to urgent because of time elapsed (14+ days overdue)? Are any emergency items still open from the prior week without a logged vendor completion — this is a critical flag. Second, seasonal tasks: is anything from the current season's checklist due within the next 7 days with no completion record? If a furnace inspection is due this week and no appointment is logged, that needs to surface. Third, vendor follow-ups: has a vendor been contacted about any open item without a response logged in more than 7 days? Stale vendor follow-ups are a common source of maintenance items that drift into overdue status — following up proactively prevents this.

The op stays completely silent — produces no output and writes no brief — when all three checks come back clean: no overdue items, no seasonal tasks due within 7 days, and no stale vendor follow-ups. This is by design. A home that is on top of its maintenance should not generate noise every Monday. The user learns quickly that silence means clean, and output means action.

When the op does identify items, it writes a brief weekly snapshot with only the flagged items — not a full status report. The snapshot is written to the vault but also delivered directly as a conversational response. The format is deliberately minimal: a bulleted list of what needs attention this week, with vendor contact info already pulled in from the vault.

## Triggers

- "Home check this week"
- "What maintenance needs attention?"
- "Weekly home review"
- "Anything due at home this week?"
- "Home Monday check"
- "Any overdue maintenance?"

## Steps

1. Read all open maintenance items from `~/Documents/aireadylife/vault/home/00_current/`
2. Check each item's target completion date against today; identify any now overdue
3. Check urgency escalation: routine items overdue 14+ days → flag as urgent
4. Check emergency items for completion or vendor appointment within 72 hours of opening; flag if unresolved
5. Read seasonal checklist from `~/Documents/aireadylife/vault/home/00_current/YYYY-{season}-checklist.md`; identify tasks due within next 7 days
6. Scan open maintenance items for vendor follow-up notes with no update in 7+ days; flag as stale
7. If all checks are clean: confirm "Home is on track — nothing requires attention this week" and exit without writing a snapshot
8. If any items flagged: write brief snapshot to `~/Documents/aireadylife/vault/home/00_current/weekly-snapshot.md`
9. Present flagged items only, with vendor contact info and recommended action

## Input

- `~/Documents/aireadylife/vault/home/00_current/`
- `~/Documents/aireadylife/vault/home/00_current/` (prior week's snapshot for comparison)
- `~/Documents/aireadylife/vault/home/01_prior/` — prior period records for trend comparison

## Output Format

When items are found:
```
# Home — Week of [Date]

## Requires Action This Week
- [OVERDUE] HVAC filter replacement — 21 days overdue (target: Oct 1). Vendor: DIY. Est. 15 min, $25.
- [DUE THIS WEEK] Furnace inspection — due Oct 15. Vendor: Aire Serv (555-1234). Book appointment today.
- [STALE FOLLOW-UP] Gutter cleaning — contacted Clean Gutters LLC on Oct 3 (8 days ago), no response. Follow up or find alternative vendor.
```

When nothing needs attention:
"Home is on track this week. No overdue items, no tasks due within 7 days."

## Configuration

No additional configuration required beyond vault existing and seasonal checklist generated.

## Error Handling

- If seasonal checklist has not been generated for the current season: run seasonal-maintenance op first; note it in the weekly output
- If no maintenance items in vault at all: note "No maintenance items tracked — add items using home-task-flag-maintenance-item"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/home/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/home/00_current/`
- Writes to: `~/Documents/aireadylife/vault/home/00_current/weekly-snapshot.md` (only when items flagged)
