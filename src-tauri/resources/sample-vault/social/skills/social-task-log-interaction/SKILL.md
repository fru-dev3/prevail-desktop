---
name: aireadylife-social-task-log-interaction
type: task
cadence: as-happened
description: >
  Records a contact interaction to vault/social/00_current/ with contact name, date, type,
  notes, and any follow-up promised.
---

# aireadylife-social-log-interaction

**Cadence:** As-happened (after any meaningful contact with a tracked person)
**Produces:** Interaction record in ~/Documents/aireadylife/vault/social/00_current/

## What It Does

This task is the most frequently used skill in the entire social domain — and the most important one. Every other social capability depends on accurate, timely interaction logs. The relationship health calculations, the outreach queue, the overdue-contact detector, and the outreach queue context generation all depend on knowing when the user last meaningfully connected with each person. Without this data, the system can track contacts but cannot assess health.

**What counts as a loggable interaction:** A meaningful interaction is any contact where genuine engagement occurred — not a passive signal like seeing someone's social media post. Loggable: a phone call (even a brief one), a video call, a coffee or meal together, an in-person meeting at an event, a substantive text exchange (more than "happy to connect" type exchanges), a meaningful email exchange, a LinkedIn message exchange that went beyond a surface-level "congrats" response. Not loggable: seeing someone's LinkedIn post and clicking like, receiving an automated birthday reminder email, seeing someone at an event but not actually talking.

**Interaction entry fields:** The task records seven fields for each interaction. Contact name: the exact name as it appears in vault/social/00_current/contacts.md — this is what the health summary flow uses to join. Date: the date the interaction occurred (today by default; overridable if logging retroactively). Interaction type: one of the standard types — text, phone call, video call, coffee/lunch/dinner, event/in-person, email, LinkedIn message, other. Notes: free-form notes about what was discussed, what was happening in the person's life, any context that would be useful in the next outreach. Length: short (under 15 min), medium (15-60 min), extended (60+ min) — optional but useful for context. Follow-up promised: any specific commitment made during the interaction that needs to happen ("said I'd send the article on X," "promised to make the intro to Y," "going to follow up about Z"). Follow-up status: open (default) or completed.

**Efficiency:** Logging an interaction should take 60-90 seconds — a brief exchange of information, not a detailed journal entry. The notes field is for a few key points, not a transcript. The goal is to capture the most useful context for the next interaction, not to document everything.

**How this drives the system:** When a new interaction is logged, it immediately updates the contact's last-contact date in the health calculation for all subsequent ops. An overdue flag in vault/social/open-loops.md for the same contact is automatically resolved on the next scan. If the logged interaction includes a follow-up promise, that promise appears in the weekly social brief's "Follow-Up Promises Outstanding" section until it is marked completed.

## Steps

1. Receive interaction details from user: contact name, date, type, notes, follow-up promised (if any)
2. Verify contact name exists in vault/social/00_current/contacts.md; if not found, ask to confirm spelling or add as new contact
3. Determine interaction log file path: vault/social/00_current/{contact-slug}.md or combined log
4. Append interaction entry to the log file
5. If follow-up promised: also write a follow-up item to vault/social/open-loops.md
6. Return confirmation with the entry logged and any follow-up item noted

## Input

- Interaction details from user (contact name, date, type, notes, follow-up)
- ~/Documents/aireadylife/vault/social/00_current/contacts.md (for contact verification)
- ~/Documents/aireadylife/vault/social/00_current/ (for appending)

## Output Format

Entry in vault/social/00_current/{contact-slug}.md (or combined log):
```markdown
---

## [YYYY-MM-DD] — [Interaction Type]
**Contact:** [Name]
**Type:** [Phone call / Text / Coffee / Video call / etc.]
**Length:** [Short / Medium / Extended]

[Free-form notes: what was discussed, what's happening in their life, context for next time]

**Follow-up promised:** [Specific commitment, or "None"]
**Follow-up status:** [Open / Completed]
```

Example entry:
```markdown
---

## 2026-04-13 — Phone call
**Contact:** [Name]
**Type:** Phone call
**Length:** Medium (~35 min)

Caught up after a few months. Starting a new role at Google in May — excited but nervous about the adjustment. Their daughter just turned 5 and started kindergarten. Mentioned they've been thinking about buying a house in the East Bay.

**Follow-up promised:** Send the Redfin link I mentioned for East Bay neighborhoods
**Follow-up status:** Open
```

## Configuration

No configuration required. Contact name must match vault/social/00_current/contacts.md entries for health calculation to work correctly.

## Error Handling

- **Contact name not found in contacts.md:** Ask user: "I don't see [name] in your contact roster. Would you like to add them as a new contact first, or is this a different spelling?" Do not log to an unmatched contact name — the health calculations require exact name matching.
- **Date not provided:** Default to today. Note: "Logged for today — update the date if the interaction happened on a different day."
- **01_interactions/ directory missing:** Create before writing.
- **Follow-up promised without a specific description:** Ask: "What specifically did you promise to follow up on?" Do not log a vague "will follow up" — it won't be actionable later.

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/social/00_current/contacts.md
- Writes to: ~/Documents/aireadylife/vault/social/00_current/{contact-slug}.md, ~/Documents/aireadylife/vault/social/open-loops.md (if follow-up promised)
