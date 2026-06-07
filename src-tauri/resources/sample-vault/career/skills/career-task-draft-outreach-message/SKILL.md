---
name: aireadylife-career-task-draft-outreach-message
type: task
cadence: called-by-op
description: >
  Drafts a personalized professional outreach message for a specific contact, tailored to the context type (warm reconnect, referral request, networking maintenance, or intro request). Reads the contact's record from vault, incorporates specific details, and produces a 3-4 sentence message ready for the user to review and send via LinkedIn or email.
---

## What It Does

Called by `aireadylife-career-op-network-review` for each contact selected for outreach. A generic "just checking in" message is worse than no message — it signals that you are not paying attention to the person, which is the opposite of what networking is supposed to do. This task produces messages that are specific, human, and have a clear but low-pressure purpose.

**Reading the contact record:** Loads the contact's data from `vault/career/` including their current role and company, how you know them (shared employer, conference, introduction, etc.), the date and substance of the last interaction, any notes about their current work or situation, and any recent activity visible on LinkedIn (new role, post, promotion). The more context in the contact record, the stronger the message.

**Context types and message shape:**

*Warm reconnect* (60-90 day dormant relationship): purpose is to re-establish contact before the relationship goes cold. References something specific and current — a relevant company announcement, a shared industry development, or something the contact recently posted or shared. Ends with a low-pressure invite: "would love to catch up for 20 minutes sometime if you're open to it." No ask for help, no mention of job search.

*Referral request*: purpose is to ask the contact to refer you to a specific open role at their company. Only used when you have an established, warm relationship with the person and a specific role in mind. References how you know them, states clearly and briefly why you would be a strong fit for the specific role, and makes a direct but polite ask: "Would you be comfortable passing along my profile to [hiring team]?" Never sent cold or to a near-stranger.

*Networking maintenance* (active relationship, checking in): for contacts where the relationship is already active and warm. Shares something useful or relevant to them — an article, an intro they might value, a relevant event — rather than asking for anything. Positions you as a connector, not a taker.

*Intro request*: asking a mutual contact to make an introduction to someone in their network. States clearly who you want to meet and why (specific, not vague), makes it easy for the connector to say yes by offering a draft intro note, and gives the connector an easy out if the timing is not right.

**Message length and tone:** All messages are 3-4 sentences maximum for LinkedIn; email versions can run 4-6 sentences but still remain brief. Tone is professional but warm — reads like a human, not a template. Never mentions that it was drafted by AI.

## Steps

1. Load contact record from `vault/career/` — extract name, current company, role, how_we_met, last_contact_date, last_contact_type, and notes.
2. Identify context type passed by calling op (warm reconnect / referral / networking / intro request).
3. Check last_contact_date — calculate days since last contact to calibrate message warmth.
4. Identify most relevant hook for the message: specific company news, recent LinkedIn post by contact, shared industry development, or mutual connection update.
5. Draft message opening: personal and specific — references the hook or the shared history.
6. Draft message body: purpose statement appropriate to context type (catch-up invite / referral ask / value-add share / intro request with specific target).
7. Draft message close: clear but low-pressure call to action with easy response path.
8. Review draft for: specificity (no generic phrases), appropriate tone for relationship warmth, length (3-4 sentences for LinkedIn), absence of desperation signals.
9. Return final draft message to calling op with channel recommendation (LinkedIn DM vs. email) and any notes about message limitations (e.g., limited context in record).

## Input

- `~/Documents/aireadylife/vault/career/` — contact record for the specific person
- Context type passed by calling op
- Role information from `vault/career/config.md` if context type is referral or intro request

## Output Format

```
## Outreach Draft — [Contact Name] — [Context Type]

Channel: LinkedIn DM / Email
Subject (if email): [subject line]

---
[Draft message — 3-4 sentences]
---

Notes: [Any caveats about message quality — e.g., "limited contact record, message is more generic than ideal; consider adding notes to their contact record after this interaction"]

Follow-up reminder: If no response in 14 days, [suggested follow-up action or archive]
```

## Configuration

Contact records at `vault/career/` with fields: name, current_company, current_role, how_we_met, last_contact_date, last_contact_notes, linkedin_url, email. The richer the record, the more specific the message.

## Error Handling

- **Contact record is sparse (name + company only):** Draft a more generic message, note the limitation prominently, and suggest the user review and personalize before sending.
- **Context type is "referral" but no specific role provided:** Request the specific role title and company from the user before drafting — a referral request for "any role at your company" is not an effective message.
- **Contact is at a company the user has listed as excluded:** Flag this before drafting — confirm the user intended to include this contact in outreach.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/` (contact log), `~/Documents/aireadylife/vault/career/config.md`
- Writes to: None (returns draft to calling op; op may save to `vault/career/00_current/` if follow-up tracking is needed)
