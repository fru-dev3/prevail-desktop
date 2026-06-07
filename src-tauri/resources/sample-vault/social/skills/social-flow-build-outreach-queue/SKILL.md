---
name: aireadylife-social-flow-build-outreach-queue
type: flow
trigger: called-by-op
description: >
  Generates a prioritized outreach list covering birthdays in 14 days, overdue relationships, and
  warm reconnect opportunities.
---

# aireadylife-social-build-outreach-queue

**Trigger:** Called by `aireadylife-social-op-birthday-watch`, `aireadylife-social-op-review-brief`, `aireadylife-social-op-relationship-review`
**Produces:** Prioritized outreach queue with suggested action and conversation context per person

## What It Does

This flow builds the outreach queue — the list of specific people to reach out to, in priority order, with the context needed to make each outreach feel genuine and meaningful. It is the key output that makes the social domain actionable rather than just informational.

**Input data:** The flow receives the relationship health summary data (contacts with their tier, last-contact date, days since contact, and health status) from the calling op. It also reads the birthday calendar for the next 14 days directly from vault/social/00_current/.

**Priority ranking:** The queue is built using a strict four-level priority hierarchy. Level 1 — Birthday contacts (due in next 7 days): these appear first regardless of relationship health. A birthday in 3 days beats a 200-day overdue Tier 3 contact every time. Within Level 1, contacts with birthdays in the next 2 days are 🔴, 3-7 days are 🟡. Level 2 — Overdue Tier 1 contacts (60+ days): inner circle relationships that have crossed the overdue threshold. Level 3 — Overdue Tier 2 contacts (90+ days): close relationships that have crossed the overdue threshold. Level 4 — Fading contacts (approaching overdue threshold): Tier 1 contacts at 30-60 days, Tier 2 contacts at 60-90 days — these are the most leverage-efficient outreach targets because a simple check-in now prevents a much harder reconnect later.

**Queue size:** The weekly brief queue is limited to 5 contacts (achievable in a week without feeling overwhelming). The monthly outreach plan queue is limited to 15-20 contacts (achievable over a month). The calling op specifies which size is needed.

**Context generation:** For each contact in the queue, the flow reads the most recent entry in vault/social/00_current/ for that contact and extracts: the date and type of the last interaction, any topics discussed, any follow-up items promised, and any notes about the contact's life situation (job, family, recent events). This context is synthesized into a 1-2 sentence context note that gives the user the background to make the outreach feel personal rather than generic. "Last talked October — mentioned their daughter was starting kindergarten. Would be a natural thing to ask about."

**Outreach medium suggestion:** The suggested outreach medium is calibrated to three factors: the relationship tier (closer tiers get more direct/personal media), the days since last contact (longer gaps get warmer media — a call is more appropriate than a text for a 6-month lapse), and the contact's known communication preferences if noted in the interaction log.

**Reconnect flagging:** If a contact appears in the queue because they are both overdue and have an upcoming birthday, this is explicitly flagged: "Birthday + overdue — excellent reconnect opportunity." Birthday outreach is naturally low-awkwardness, so it is the best possible moment to re-establish contact after a longer gap.

## Steps

1. Receive relationship health data from calling op (all contacts with tier, days since contact, health status)
2. Read vault/social/00_current/ for contacts with birthdays in next 14 days
3. Apply four-level priority ranking: birthdays (Level 1) → T1 overdue (Level 2) → T2 overdue (Level 3) → fading T1/T2 (Level 4)
4. Within each level: sort by urgency (most urgent first)
5. Truncate to queue size specified by calling op (5 for weekly brief, 15-20 for monthly plan)
6. For each contact in queue: read vault/social/00_current/ for last interaction details
7. Extract context: last interaction date, topics discussed, follow-up promises, life situation notes
8. Generate 1-2 sentence context note per contact
9. Assign outreach medium (text, phone call, email, LinkedIn, coffee) based on tier + gap + preferences
10. Flag contacts that are both overdue and have upcoming birthday as reconnect opportunities
11. Return ranked queue with context to calling op

## Input

- Relationship health data from calling op (contacts, tiers, days since contact, health status)
- ~/Documents/aireadylife/vault/social/00_current/ (for birthday check)
- ~/Documents/aireadylife/vault/social/00_current/ (for context generation)
- `~/Documents/aireadylife/vault/social/01_prior/` — prior period records for trend comparison

## Output Format

Returns structured queue to calling op:
```
[
  { priority: 1, name: "[Name]", tier: "T1", event: "Birthday Apr 18", days_since_contact: 45, health: "fading",
    suggested_medium: "Phone call", context: "Last spoke in November. They mentioned their daughter was starting kindergarten. Would be natural to ask how that's going. Overdue + birthday = ideal reconnect call.", reconnect_opportunity: true },
  { priority: 2, name: "[Name]", tier: "T1", event: null, days_since_contact: 122, health: "overdue",
    suggested_medium: "Phone call", context: "Last spoke in December. Were going through a job search at the time. Good to follow up on how that resolved.", reconnect_opportunity: false },
  ...
]
```

## Configuration

Optional in vault/social/config.md:
- `communication_preferences` — per-contact preferred outreach medium
- `outreach_queue_size` — weekly default 5, monthly default 15-20; overrideable by calling op

## Error Handling

- **No interaction history for a contact:** Include in queue if health status qualifies; note "No interaction log found — check vault/social/00_current/." Context note will be blank.
- **Queue size request cannot be filled (not enough qualifying contacts):** Return however many qualify; do not pad with low-priority contacts.
- **Birthday calendar missing:** Skip Level 1 priority; build queue from Levels 2-4 only.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/social/01_prior/` — prior period records
- Reads from: ~/Documents/aireadylife/vault/social/00_current/, ~/Documents/aireadylife/vault/social/00_current/
- Writes to: none (returns data to calling op)
