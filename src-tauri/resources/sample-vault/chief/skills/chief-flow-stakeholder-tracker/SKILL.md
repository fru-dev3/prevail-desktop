---
name: prevail-chief-flow-stakeholder-tracker
type: flow
cadence: on-demand
description: >
  Tracks who you owe a response to. Watches recent email/Slack/Telegram
  threads + meeting follow-ups + calendar invites needing a reply, and
  surfaces a single list of "people waiting on you." Color-codes by how
  long they've been waiting. Triggers: "who am I behind on", "follow
  ups", "people waiting on me", "owed responses", "stakeholder check
  in".
---

# chief-flow-stakeholder-tracker

**Cadence:** On-demand + auto-runs in daily brief
**Produces:** `vault/chief/00_current/owed.md`

## What It Does

Synthesizes a "people who are waiting on me" list from every signal the
vault can see:

- Unread/un-replied Gmail threads where you were the last-needed responder
- Slack mentions older than 24 hours with no response from you
- Calendar invites needing accept/decline
- `pending` items in any domain's `open-loops.md` that name a person
- Meeting notes where you committed to send something ("I'll send the
  doc by Wednesday")

Output ranks by:
- **Days waiting** — anything >5 days is flagged red
- **Stakes** — your manager, your spouse, your CFO outrank random ones
  (stakes weight read from `vault/chief/00_current/stakeholder-map.md`)

## Inputs

- Gmail connector (if wired)
- Slack connector (if wired)
- Google Calendar connector (if wired)
- Every domain's `open-loops.md` for `@person` mentions
- `vault/chief/00_current/stakeholder-map.md` (rank list)

## Outputs

- `vault/chief/00_current/owed.md` — a ranked list with one row per
  person + the specific thing you owe them
- Surface count goes into the daily brief: "5 people waiting on you,
  oldest 8 days"
