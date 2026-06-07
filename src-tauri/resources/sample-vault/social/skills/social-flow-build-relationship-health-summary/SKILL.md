---
name: aireadylife-social-flow-build-relationship-health-summary
type: flow
trigger: called-by-op
description: >
  Generates a relationship health table showing all tracked contacts with last contact date, health
  status, and relationship tier.
---

# aireadylife-social-build-relationship-health-summary

**Trigger:** Called by `aireadylife-social-op-relationship-review`, `aireadylife-social-op-monthly-sync`
**Produces:** Relationship health table sorted by urgency returned to calling op

## What It Does

This flow is the measurement engine for the social domain. It joins the contact roster (vault/social/00_current/contacts.md) with the interaction log (vault/social/00_current/) to produce a full health assessment of every tracked relationship.

**Last-contact calculation:** For each contact in the roster, the flow reads their interaction log file (or scans the combined interaction log for their name) and finds the most recent entry. The date of the most recent entry is the last-contact date. "Contact" is defined as a meaningful interaction — a logged interaction entry in vault/social/00_current/. The flow does not count implicit signals (like seeing someone's LinkedIn post) as contact — only explicitly logged interactions count.

**Health status assignment:** Health status is assigned based on days since last contact and the contact's tier. Thresholds are read from vault/social/config.md; defaults are:
- Tier 1 (Inner Circle): Healthy = <30 days, Fading = 30-60 days, Overdue = 60+ days
- Tier 2 (Close): Healthy = <60 days, Fading = 60-90 days, Overdue = 90+ days
- Tier 3 (Active): Healthy = <90 days, Fading = 90-180 days, Overdue = 180+ days
- Tier 4 (Dormant): No active health tracking; show last-contact date only

**Table construction:** The flow builds a contact-by-contact health table. Columns: name, tier, last contact date (or "No log" if no interaction recorded), days since contact, health status, and next-recommended-contact-date (today for overdue, the threshold date minus 7 days for healthy/fading — a proactive date that keeps the user ahead of the threshold). The table is sorted by urgency: overdue contacts first (sorted by most-overdue first), then fading (sorted by most-at-risk first), then healthy.

**Statistical summary:** After the full contact table, the flow calculates aggregate statistics: total contacts by tier, total overdue by tier, total fading by tier, and the percentage of each tier in healthy status. These aggregate numbers feed the portfolio health summary section of the calling op's output.

**Data quality flags:** The flow identifies contacts in the roster with missing data: no interaction log entries (never tracked — "No log" in the table), no tier assignment (defaults to Tier 3), no birthday record (flagged as a data gap). These are returned as data quality notes for the calling op to include in its vault hygiene section.

## Steps

1. Read vault/social/00_current/contacts.md for complete contact roster
2. Read tier definitions and health thresholds from vault/social/config.md
3. For each contact: read vault/social/00_current/ for most recent interaction entry
4. Calculate days since last contact for each contact (or flag as "No log")
5. Apply tier-specific health thresholds; assign status (Healthy / Fading / Overdue / No log)
6. Calculate next-recommended-contact-date per contact
7. Build sorted health table: Overdue first → Fading → Healthy → No log
8. Calculate portfolio statistics: totals by tier and health status
9. Identify data quality gaps: no log, no tier, no birthday
10. Return health table, statistics, and data quality notes to calling op

## Input

- ~/Documents/aireadylife/vault/social/00_current/contacts.md
- ~/Documents/aireadylife/vault/social/00_current/ (all interaction logs)
- `~/Documents/aireadylife/vault/social/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/social/config.md (tier thresholds)

## Output Format

Returns structured data to calling op:
```
{
  contacts: [
    { name: "[Name]", tier: "T1", last_contact: "2025-12-12", days_since: 122, status: "Overdue", next_recommended: "Today" },
    { name: "[Name]", tier: "T2", last_contact: "2026-01-15", days_since: 88, status: "Overdue", next_recommended: "Today" },
    { name: "[Name]", tier: "T1", last_contact: "2026-03-08", days_since: 36, status: "Fading", next_recommended: "Apr 17" },
    { name: "[Name]", tier: "T3", last_contact: null, days_since: null, status: "No log", next_recommended: "Add interaction" },
    ...
  ],
  statistics: {
    T1: { total: 12, healthy: 7, fading: 4, overdue: 1 },
    T2: { total: 22, healthy: 14, fading: 5, overdue: 3 },
    T3: { total: 35, healthy: 18, fading: 12, overdue: 5 }
  },
  data_quality: {
    no_log: ["[Name]", "[Name]"],
    no_tier: ["[Name]"],
    no_birthday: ["[Name]", "[Name]", "[Name]"]
  }
}
```

## Configuration

Required in vault/social/config.md:
- `health_thresholds` — per-tier healthy/fading/overdue day thresholds

## Error Handling

- **contacts.md missing:** Cannot run. Return error to calling op: "Contact roster missing. Create vault/social/00_current/contacts.md to enable health tracking."
- **No interaction log entries for any contact:** Return table with all contacts as "No log" status; note "No interactions logged — the social domain requires vault/social/00_current/ data."
- **config.md missing health thresholds:** Use defaults (T1: 30/60, T2: 60/90, T3: 90/180).

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/social/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/social/00_current/contacts.md, ~/Documents/aireadylife/vault/social/00_current/, ~/Documents/aireadylife/vault/social/config.md
- Writes to: none (returns data to calling op)
