---
name: aireadylife-social-op-relationship-review
type: op
cadence: monthly
description: >
  Monthly relationship health check that reviews contact recency, flags relationships going cold,
  and generates a prioritized outreach queue. Triggers: "relationship review", "who should I reach
  out to", "social health", "relationship check".
---

# aireadylife-social-relationship-review

**Cadence:** Monthly (1st of month)
**Produces:** Relationship health table and outreach queue at ~/Documents/aireadylife/vault/social/00_current/

## What It Does

The monthly relationship review is a full account of every tracked contact's health status. Unlike the weekly brief (which surfaces the most urgent 5 actions), the monthly review covers the complete picture — every contact, every tier, every health status — giving the user a comprehensive view of relationship portfolio health once a month.

The op calls `social-flow-build-relationship-health-summary` to produce the full health table. For each contact, the flow joins the contacts.md roster with the interaction log to calculate days since last meaningful contact (not just any contact, but a substantive interaction — a reply to a brief text doesn't count the same as a real conversation or in-person interaction, though the interaction log entry is what determines "last contact" in the system). Health status is assigned per tier thresholds from vault/social/config.md.

The monthly review also identifies structural patterns in relationship health that the weekly brief can't see. If multiple Tier 1 contacts are all fading in the same month, this suggests a systemic attention deficit to the inner circle — not just individual outreach items. If professional contacts as a group are all going dormant, this may suggest the user has entered a busy period and needs to intentionally protect time for relationship maintenance. The review surfaces these patterns as observations, not just as individual contact flags.

After producing the health table, the op calls `social-flow-build-outreach-queue` to generate the month's outreach plan — a broader list of 10-15 contacts to reach out to over the course of the month (not just this week), organized by urgency tier. The monthly outreach plan complements the weekly queue by giving a fuller picture of the month's social intentions.

## Triggers

- "relationship review"
- "who should I reach out to"
- "social health"
- "relationship check"
- "monthly social review"
- "how are my relationships"

## Steps

1. Verify vault/social/ exists and has contacts and interaction log data
2. Call `social-flow-build-relationship-health-summary` to compute health status for all contacts
3. Receive health table: each contact with tier, last contact date, days since contact, health status
4. Identify structural patterns: tier-level health concentration, overall portfolio health trend vs. prior month
5. Segment contacts: identify overdue, fading, healthy by tier
6. Call `social-flow-build-outreach-queue` for full month's outreach plan (10-15 contacts)
7. For each overdue Tier 1 or Tier 2 contact: call `social-task-flag-overdue-contact`
8. Write health summary to vault/social/00_current/health-YYYY-MM.md
9. Call `social-task-update-open-loops` to write all new overdue flags and resolve completed items
10. Return formatted relationship review to user

## Input

- ~/Documents/aireadylife/vault/social/00_current/contacts.md
- ~/Documents/aireadylife/vault/social/00_current/ (last-contact dates)
- `~/Documents/aireadylife/vault/social/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/social/config.md (tier thresholds)

## Output Format

```
# Relationship Review — [Month YYYY]

## Portfolio Health Summary
| Tier             | Total | Healthy | Fading | Overdue |
|------------------|-------|---------|--------|---------|
| T1 Inner (12)    | 12    | 7       | 4      | 1       |
| T2 Close (22)    | 22    | 14      | 6      | 2       |
| T3 Active (35)   | 35    | 18      | 12     | 5       |

**Observations:** 4 Tier 1 contacts fading this month — higher than usual. Inner circle may need
dedicated attention in April. Consider blocking a social evening for a group dinner.

## Overdue Contacts (Require Action This Month)
| Name       | Tier | Last Contact   | Days Overdue | Suggested Action                           |
|------------|------|----------------|--------------|---------------------------------------------|
| [Name]     | T1   | Dec 12, 2025   | 122 days     | 🔴 Phone call — inner circle overdue        |
| [Name]     | T2   | Jan 15, 2026   | 88 days      | 🟡 Text or email reconnect                  |

## Monthly Outreach Plan (10-15 contacts)
**Priority 1 — Birthdays (0)**
[None this month]

**Priority 2 — Overdue**
1. [Name] — T1 — 122 days — Phone call this week
2. [Name] — T2 — 88 days — Email reconnect by mid-April

**Priority 3 — Fading (most at-risk)**
3. [Name] — T1 — 52 days — Text check-in
4. [Name] — T2 — 75 days — Coffee (local)
5. [Name] — T3 — 170 days — LinkedIn message
...

## Relationship Wins (Resolved Since Last Review)
- [Name]: Reconnected after 4-month gap — great call last week
```

## Configuration

Required in vault/social/config.md:
- `health_thresholds` — per-tier overdue/fading thresholds in days
- Contact and interaction data must be in vault for health calculations

## Error Handling

- **No interaction log data:** Cannot calculate last-contact dates — display contacts with "No interactions logged" health status; recommend running social-task-log-interaction to populate.
- **Only 1-2 contacts in vault:** Run review for available contacts; note "Add more contacts to vault/social/00_current/contacts.md for a fuller health picture."
- **No prior month health summary:** Skip trend comparison; note "Trend available after second monthly review."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/social/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/social/00_current/contacts.md, ~/Documents/aireadylife/vault/social/00_current/, ~/Documents/aireadylife/vault/social/config.md
- Writes to: ~/Documents/aireadylife/vault/social/00_current/health-YYYY-MM.md, ~/Documents/aireadylife/vault/social/open-loops.md
