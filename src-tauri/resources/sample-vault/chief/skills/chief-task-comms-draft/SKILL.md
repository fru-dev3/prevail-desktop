---
name: prevail-chief-task-comms-draft
type: task
cadence: on-demand
description: >
  Drafts external communications (email, Slack DM, LinkedIn message,
  memo) from a few bullet points. Tone-matches the recipient — formal
  for board members, casual for peers, warm for personal. Produces a
  ready-to-send draft + a 30-second TL;DR the recipient could skim if
  they don't read the whole thing. Triggers: "draft an email to X",
  "write a message to X about Y", "compose a response", "memo from
  these notes".
---

# chief-task-comms-draft

**Cadence:** On-demand
**Produces:** `vault/chief/00_current/drafts/<recipient>-<topic>-YYYY-MM-DD.md`

## What It Does

User provides:
- **Recipient** (name or role)
- **Topic / intent** (one sentence)
- **Key points** (bullets)
- Optional: **Tone** (formal / casual / warm / urgent)

Skill drafts the communication following these rules:

1. **TL;DR at the top** — 1-2 sentences in case the recipient only reads
   the first line of your email
2. **One ask per message** — if the bullets contain multiple asks, the
   skill flags this and asks you to split
3. **No filler** — no "I hope this finds you well." Start with substance.
4. **Recipient context** — pulls from `vault/chief/00_current/stakeholder-map.md`
   for tone defaults (your manager gets concise + outcome-first; your
   spouse gets warm + relational; a vendor gets crisp + specific)
5. **Prior thread context** — if you've written to this person before
   (matches name in any `_log/` file), uses similar phrasing/tone

## Inputs

- User's bullet points
- `vault/chief/00_current/stakeholder-map.md` (tone defaults per person)
- Prior `_log/` entries mentioning the recipient (style transfer)

## Outputs

- `vault/chief/00_current/drafts/<recipient>-<topic>-YYYY-MM-DD.md`
  containing: TL;DR + subject line + body + suggested send-time
