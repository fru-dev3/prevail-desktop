---
name: aireadylife-social-op-monthly-sync
type: op
cadence: monthly
description: >
  Full social data sync on the 1st of each month. Reviews all relationship health
  scores, identifies who needs a check-in, and updates the outreach queue for the month.
  Triggers: "social monthly sync", "relationship review", "refresh social vault".
---

# aireadylife-social-monthly-sync

**Cadence:** Monthly (1st of month)
**Produces:** Full vault refresh with updated health status, monthly outreach plan, and open-loops update

## What It Does

The monthly sync is the comprehensive maintenance operation for the social domain — it recalculates everything and brings the vault fully up to date. Where the weekly brief focuses on the most urgent 5 outreach actions, and the monthly relationship review produces the full contact health picture, the monthly sync handles the underlying data refresh that both depend on.

**Contact roster refresh:** The sync reads vault/social/00_current/contacts.md and checks for: contacts with no interaction log entries (never tracked), contacts with outdated tier assignments (the user may want to promote or demote based on how relationships have evolved), contacts missing birthday records, and contacts with no next-action note. Data gaps are surfaced as a brief "vault hygiene" section in the sync output, not as urgent flags — they're housekeeping reminders.

**Health recalculation:** The sync recalculates relationship health scores for all contacts from scratch, rather than relying on incremental updates. This ensures any interaction log entries added since the last sync are reflected. The full recalculation produces the most accurate picture of the social portfolio's health.

**Birthday calendar forward scan:** The sync reads vault/social/00_current/ and checks the next 30 days' birthdays — beyond the weekly 14-day window — to give the user a full month's awareness of upcoming social obligations. Any contact with a birthday in the next 30 days but no recent interaction is noted as a priority reconnect opportunity to plan for.

**Outreach log review:** The sync reads vault/social/00_current/ for any interactions logged since the last sync. It identifies: follow-up promises made that haven't been logged as completed ("said I'd send the article"), reciprocity gaps (relationships where the user has been receiving but not giving recently), and positive momentum contacts (people the relationship is deepening with, worth recognizing and continuing to invest in).

**Monthly outreach plan:** After the full refresh, the sync generates the month's complete outreach plan — not just the immediate urgent queue but a month-level intention: which 15-20 contacts the user plans to meaningfully connect with over the month, allocated across the four weeks.

## Triggers

- "social monthly sync"
- "relationship review"
- "refresh social vault"
- "sync my social"
- "update relationship tracker"
- "monthly check-in"

## Steps

1. Verify vault/social/ exists and config.md is filled in
2. Read vault/social/00_current/contacts.md; identify data gaps (no interactions, no birthday, no tier)
3. Read all interaction log entries in vault/social/00_current/ since the last sync date
4. Recalculate health status for all contacts from full interaction history
5. Read vault/social/00_current/ for next 30 days; note contacts with upcoming birthdays
6. Review follow-up promises in interaction log for outstanding deliverables
7. Check reciprocity balance for Tier 1 and Tier 2 contacts (give vs. ask ratio)
8. Generate monthly outreach plan (15-20 contacts across the month)
9. Update vault/social/00_current/contacts.md with refreshed health status and next-action notes
10. Call `social-task-update-open-loops` to write all overdue flags and resolve completed items
11. Write monthly sync summary to vault/social/00_current/sync-YYYY-MM.md
12. Return sync summary to user

## Input

- ~/Documents/aireadylife/vault/social/00_current/contacts.md
- ~/Documents/aireadylife/vault/social/00_current/ (complete interaction log)
- ~/Documents/aireadylife/vault/social/00_current/
- `~/Documents/aireadylife/vault/social/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/social/config.md

## Output Format

```
# Social Monthly Sync — [Month YYYY]

## Portfolio Health (Recalculated)
| Tier           | Total | Healthy | Fading | Overdue |
|----------------|-------|---------|--------|---------|
| T1 Inner (12)  | 12    | 7       | 4      | 1       |
| T2 Close (22)  | 22    | 14      | 5      | 3       |
| T3 Active (35) | 35    | 18      | 12     | 5       |

## Vault Hygiene
- 3 contacts with no birthday recorded: [Name], [Name], [Name]
- 1 contact with no tier assigned: [Name]
- 2 contacts with no interaction log entries: [Name], [Name]

## Upcoming Birthdays (Next 30 Days)
- [Name] — Apr 18 (5 days) — T1 — 45 days since contact
- [Name] — Apr 26 — T3 — 95 days since contact (overdue + birthday = reconnect)
- [Name] — May 8 — T2 — 22 days since contact (healthy)

## Follow-Up Promises Outstanding
- [Name]: Send article on [topic] — promised [date]
- [Name]: Intro to [person] — promised [date]

## Monthly Outreach Plan
Week 1 (Apr 14-20): [Name] birthday call, [Name] reconnect text, [Name] email
Week 2 (Apr 21-27): [Name] birthday LinkedIn, [Name] coffee (overdue), [Name] text
Week 3 (Apr 28–May 4): [Name] follow-up on promised intro, [Name] check-in text
Week 4 (May 5-11): [Name] birthday text, [Name] seasonal reconnect email
```

## Configuration

Required in vault/social/config.md:
- Tier definitions and health thresholds
- `outreach_plan_contacts_per_month` — default 15-20

## Error Handling

- **Interaction log empty:** Run sync with no health data; note "No interaction history — add contacts and start logging interactions to enable health tracking."
- **Contact list empty:** Note "No contacts on file. Populate vault/social/00_current/contacts.md to start relationship tracking."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/social/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/social/00_current/contacts.md, ~/Documents/aireadylife/vault/social/00_current/, ~/Documents/aireadylife/vault/social/00_current/, ~/Documents/aireadylife/vault/social/config.md
- Writes to: ~/Documents/aireadylife/vault/social/00_current/contacts.md (refreshed health), ~/Documents/aireadylife/vault/social/00_current/sync-YYYY-MM.md, ~/Documents/aireadylife/vault/social/open-loops.md
