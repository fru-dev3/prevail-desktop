---
name: aireadylife-social-op-birthday-watch
type: op
cadence: weekly
description: >
  Weekly birthday and milestone watch that surfaces upcoming birthdays and life events in the next
  14 days with suggested actions. Triggers: "birthdays this week", "upcoming birthdays", "who has
  a birthday", "milestone check".
---

# aireadylife-social-birthday-watch

**Cadence:** Weekly (Monday morning)
**Produces:** Upcoming birthday and milestone list with suggested actions for the next 14 days

## What It Does

The birthday watch is the single most important social skill for day-of relationship maintenance. Missing a close friend's birthday costs relationship capital that takes months to recover. This op ensures that no birthday or meaningful milestone for any tracked contact passes without the user having been given advance notice and a suggested action.

The op reads vault/social/00_current/ to find all birthdays and milestones scheduled in the next 14 days. The 14-day window is used because some close relationships deserve more than a same-day text — a planned phone call or a mailed card requires 3-7 days of lead time. The op also checks the milestone calendar for non-birthday events tracked for contacts: work anniversaries (which the contact may or may not celebrate depending on the relationship), first-year milestones after major life events (one year after a loss, one year in a new city, etc.), and any custom milestone dates the user has logged for specific contacts.

**Action calibration by tier and gap:** For each upcoming event, the op suggests a specific outreach action calibrated to two factors: the contact's tier and the days since last contact. A Tier 1 contact gets a personal phone call (unless the relationship context makes text more appropriate). A Tier 2 contact gets a personal text or short personal email. A Tier 3 contact gets a LinkedIn message or simple email. If the contact is also in the overdue zone (days since last contact exceeds the tier's overdue threshold), the birthday is explicitly flagged as a reconnect opportunity: "This contact is 85 days overdue — the birthday is a natural, low-awkwardness reconnect moment. Call, not text."

The op calls `social-flow-build-outreach-queue` to incorporate the birthday contacts into the broader weekly outreach queue, ensuring birthday outreach is prioritized above other outreach items for the same week. It also calls `social-task-update-open-loops` to write any birthday items within 7 days as active open-loop flags so they surface in the Chief morning brief under the social domain.

## Triggers

- "birthdays this week"
- "upcoming birthdays"
- "who has a birthday"
- "milestone check"
- "birthday watch"
- "any birthdays coming up"

## Steps

1. Verify vault/social/00_current/ exists and has data
2. Read all birthday and milestone entries; filter for the next 14 days
3. For each upcoming event: read contact's tier from vault/social/00_current/contacts.md
4. For each upcoming event: read last-contact date from vault/social/00_current/; calculate days since contact
5. Assign urgency: 🔴 if event in next 2 days, 🟡 if 3-7 days, 🟢 if 8-14 days
6. Calibrate suggested outreach action based on tier + days-since-contact gap
7. Flag contacts in overdue zone as reconnect opportunities at the birthday
8. Call `social-flow-build-outreach-queue` to incorporate birthday contacts into ranked outreach queue
9. For events within 7 days: call `social-task-update-open-loops` to write as active flags
10. Return formatted birthday and milestone list to user

## Input

- ~/Documents/aireadylife/vault/social/00_current/ (birthday and milestone calendar)
- ~/Documents/aireadylife/vault/social/00_current/contacts.md (tier assignments)
- ~/Documents/aireadylife/vault/social/00_current/ (last-contact dates)
- `~/Documents/aireadylife/vault/social/01_prior/` — prior period records for trend comparison

## Output Format

```
# Birthday & Milestone Watch — Week of [Date]

## Upcoming Events (Next 14 Days)
| Person  | Event     | Date   | Tier | Last Contact    | Suggested Action                         |
|---------|-----------|--------|------|-----------------|------------------------------------------|
| [Name]  | Birthday  | Apr 18 | T1   | 45 days ago     | 🔴 Call (overdue + birthday) — call today if Apr 16 |
| [Name]  | New job   | Apr 20 | T2   | 22 days ago     | 🟡 Text congrats by Apr 20               |
| [Name]  | Birthday  | Apr 26 | T3   | 95 days ago     | 🟢 LinkedIn message or email by Apr 26   |

## Reconnect Opportunities (Birthday + Overdue)
[Name] — Birthday Apr 18 — 45 days overdue. This is a low-awkwardness reconnect window.
Suggested: Phone call on the day. Mention [something relevant to your relationship].

## No upcoming events in the next 14 days
[If empty calendar window — provide "Next upcoming event: [Name], birthday [Date]"]
```

## Configuration

Required in vault/social/00_current/:
- Birthday entries for each tracked contact
- Format: name, date (MM-DD), event type, notes

## Error Handling

- **vault/social/00_current/ empty or missing:** Note "No birthdays on file. Add contact birthdays to vault/social/00_current/ to receive birthday alerts."
- **Contact not found in contacts.md:** Still surface the event; note tier as unknown and use default Tier 2 outreach suggestion.
- **Interaction log missing for a contact:** Cannot calculate days-since-contact; note "No interaction log — add last-contact date to vault/social/00_current/ for health tracking."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/social/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/social/00_current/, ~/Documents/aireadylife/vault/social/00_current/contacts.md, ~/Documents/aireadylife/vault/social/00_current/
- Writes to: ~/Documents/aireadylife/vault/social/open-loops.md (via social-task-update-open-loops)
