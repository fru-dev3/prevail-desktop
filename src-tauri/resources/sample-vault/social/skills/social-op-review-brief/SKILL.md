---
name: aireadylife-social-op-review-brief
type: op
cadence: weekly
description: >
  Weekly social review brief. Compiles upcoming birthdays, relationship health flags,
  and outreach suggestions into a single briefing for Ben's morning brief.
  Triggers: "social brief", "relationship update", "who should I reach out to", "birthday reminders".
---

# aireadylife-social-review-brief

**Cadence:** Weekly (Monday)
**Produces:** Weekly social brief at ~/Documents/aireadylife/vault/social/02_briefs/YYYY-MM-DD-social-brief.md

## What It Does

The weekly social brief is the primary output of the social domain — the briefing that makes relationship maintenance actionable every Monday morning. It surfaces exactly what needs to happen this week for the user's social life: who has a birthday, who is overdue for a check-in, and who the best 3-5 outreach opportunities are this week.

The brief is designed to be specific and executable — not a list of "you should reach out to people" but "here are 5 specific people, here is why each one matters right now, here is what to do, and here is the context that will make the outreach feel genuine."

**Birthday and milestone section:** The brief opens with any birthdays or life milestones in the next 14 days, surfaced by `social-op-birthday-watch`. For each person: their name, the event (birthday, work anniversary, etc.), the date, their tier, days since last contact (the gap context), and a suggested outreach action. If a birthday contact is also overdue, this is noted explicitly — the birthday is an excellent reconnect opportunity.

**Relationship health summary:** The brief includes a condensed version of the relationship health check: how many Tier 1, Tier 2, Tier 3 contacts are currently in each health status (healthy / fading / overdue). This gives the user a weekly pulse on overall relationship health without requiring them to scroll through every contact.

**Outreach queue:** The brief's core is the outreach queue — 5 specific people the user should reach out to this week, with suggested action and conversation context. The queue is built by `social-flow-build-outreach-queue` using the priority hierarchy: birthdays first, then overdue Tier 1 contacts, then overdue Tier 2 contacts, then fading Tier 1 contacts, then warm professional reconnects. For each person in the queue: name, relationship tier, days since last contact, suggested outreach medium (text/call/email/LinkedIn/coffee), and a brief context note (what was discussed last time, what's been happening in their life, why this week is a good time to reach out).

**Follow-up promises:** If any prior interaction log entry contains a "follow-up promised" note (e.g., "said I'd send the article on X" or "promised to make the intro to Y"), these appear as a standing section in the brief until the follow-up is logged as complete.

## Triggers

- "social brief"
- "relationship update"
- "who should I reach out to"
- "birthday reminders"
- "outreach queue"
- "social this week"
- "relationship check"

## Steps

1. Verify vault/social/ exists and config.md is filled in
2. Read vault/social/00_current/ for birthdays and milestones in the next 14 days
3. Read vault/social/00_current/ for last-contact dates per person; calculate days since last contact
4. Calculate relationship health status per contact (healthy/fading/overdue) based on tier thresholds
5. Build health summary counts by tier and status
6. Call `social-flow-build-outreach-queue` for ranked 5-contact outreach queue with context
7. Read vault/social/00_current/ for any unresolved follow-up promises from prior interactions
8. Assemble brief in standard four-section format
9. Write to vault/social/02_briefs/YYYY-MM-DD-social-brief.md
10. Call `social-task-update-open-loops` to write any overdue flags from this scan
11. Return formatted brief to user

## Input

- ~/Documents/aireadylife/vault/social/00_current/contacts.md
- ~/Documents/aireadylife/vault/social/00_current/ (interaction log for last-contact dates)
- ~/Documents/aireadylife/vault/social/00_current/ (birthday and milestone calendar)
- `~/Documents/aireadylife/vault/social/01_prior/` — prior period records for trend comparison
- ~/Documents/aireadylife/vault/social/open-loops.md
- ~/Documents/aireadylife/vault/social/config.md

## Output Format

```
# Social Brief — [Week of Month DD, YYYY]

## Birthdays & Milestones (Next 14 Days)
| Person       | Event           | Date    | Tier | Last Contact | Suggested Action                     |
|--------------|-----------------|---------|------|--------------|--------------------------------------|
| [Name]       | Birthday        | Apr 18  | T1   | 45 days ago  | 🔴 Call — overdue + birthday, call today |
| [Name]       | New job start   | Apr 20  | T2   | 22 days ago  | 🟡 Text congratulations by Apr 20       |

## Relationship Health This Week
| Tier          | Healthy | Fading | Overdue |
|---------------|---------|--------|---------|
| T1 Inner (12) | 8       | 3      | 1       |
| T2 Close (22) | 15      | 5      | 2       |
| T3 Active (35)| 20      | 10     | 5       |

## This Week's Outreach Queue
1. **[Name]** — T1 Inner Circle — Last contact: 68 days ago (overdue)
   Suggested: Phone call | Context: [Last topic discussed]; [recent life event if known]
   Why now: 68 days is past the 60-day threshold; don't let this slip further

2. **[Name]** — T2 Close — Last contact: 85 days ago (overdue)
   Suggested: Text or short email | Context: [relevant context]

3. **[Name]** — Birthday Apr 18 — T1 Inner — Last contact: 45 days ago
   Suggested: Phone call on Apr 18 | Context: [personal note from last conversation]

4. **[Name]** — T3 Active — Last contact: 175 days ago (fading)
   Suggested: LinkedIn message | Context: [professional context]

5. **[Name]** — T2 Close — Last contact: 55 days ago (fading)
   Suggested: Text | Context: [relevant shared interest or recent event]

## Follow-Up Promises
- [Name]: Send the article on [topic] — promised [date]
- [Name]: Make intro to [person] — promised [date]
```

## Configuration

Required in vault/social/config.md:
- `tier_definitions` — tier names and membership criteria
- `health_thresholds` — days-since-contact thresholds per tier for healthy/fading/overdue
- `outreach_queue_size` — default 5 (contacts per week); adjustable

## Error Handling

- **No contacts in vault:** Note "Contact list empty. Add contacts to vault/social/00_current/contacts.md to start relationship tracking."
- **Interaction log missing or empty:** Cannot calculate last-contact dates — note "Run social-task-log-interaction after each meaningful contact to enable health calculations."
- **Birthday calendar empty:** Skip birthday section; note "Add birthdays to vault/social/00_current/ to receive birthday reminders."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/social/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/social/00_current/contacts.md, ~/Documents/aireadylife/vault/social/00_current/, ~/Documents/aireadylife/vault/social/00_current/, ~/Documents/aireadylife/vault/social/open-loops.md
- Writes to: ~/Documents/aireadylife/vault/social/02_briefs/YYYY-MM-DD-social-brief.md, ~/Documents/aireadylife/vault/social/open-loops.md
