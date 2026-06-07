---
name: aireadylife-career-op-network-review
type: op
cadence: monthly
description: >
  Monthly professional network health check. Reviews relationship recency across strategic contacts, identifies warm reconnects (60-90 day dormant relationships), surfaces new connections worth pursuing at target companies, and drafts personalized outreach messages ready for the user to send. Triggers: "network review", "who should I reach out to", "networking check", "keep my network warm", "professional connections", "outreach drafts".
---

## What It Does

Your professional network is your highest-value career asset — and it decays faster than most people realize. A contact not touched in 90 days is cooling; at 180 days you are a near-stranger. This op runs monthly to keep relationships alive at a sustainable pace: 2-4 targeted outreach messages per month, each personalized and specific rather than a generic "staying in touch" note. Monthly cadence is frequent enough to keep relationships warm, infrequent enough that it never feels transactional.

The op reads your contact log from `vault/career/` — which stores each strategic contact with their current role, company, how you know them, the date and nature of your last interaction, and any notes about their situation or interests. It calculates recency for each contact and categorizes them into three groups: active (last contact within 60 days — no action needed), warm (60-90 days — prime reconnect window), and cooling (90-180 days — reconnect while the relationship still has context to anchor to).

From the warm and cooling groups, it selects the highest-priority contacts for outreach based on strategic value: hiring managers or team leads at target companies, former colleagues now in relevant roles or at interesting companies, connectors with wide networks in your target industry, and mentors or sponsors whose perspective is periodically valuable. For each selected contact, it calls `aireadylife-career-task-draft-outreach-message` with the contact's record and a context type (warm reconnect, referral request, networking maintenance, or intro request). The resulting message draft is specific — it references something real about the contact's current work, a shared experience, or a relevant industry development — not a template with the contact's name swapped in.

The op also scans for new first-degree connections added in the last 30 days and flags any from target companies for immediate light engagement (commenting on their recent posts or a brief welcome message). It also surfaces any open pipeline items with a named contact who has not been followed up on within the standard window — these are treated as pipeline follow-ups, not network maintenance.

## Triggers

- "network review"
- "who should I reach out to this month"
- "networking check"
- "keep my network warm"
- "professional connections review"
- "draft outreach messages"
- "reconnect with contacts"

## Steps

1. Read network contact log from `vault/career/` — load all contacts with last interaction date, relationship type, and strategic notes.
2. Calculate days since last interaction for each contact.
3. Categorize: active (<60 days), warm (60-90 days), cooling (90-180 days), dormant (180+ days).
4. Score warm and cooling contacts by strategic priority: target company hiring managers (highest), former colleagues in relevant roles, connectors in your industry, mentors/sponsors.
5. Select top 3-5 contacts for outreach this month from warm and cooling groups, weighted by strategic priority.
6. For each selected contact, call `aireadylife-career-task-draft-outreach-message` with contact record and context type.
7. Review open pipeline items from `vault/career/00_current/` — identify any with a named contact who needs follow-up separate from the network maintenance pass.
8. Scan LinkedIn new connections from last 30 days — flag any from target companies for light engagement.
9. Write network review summary to `vault/career/02_briefs/YYYY-MM-network-review.md` with selected contacts, draft messages, and rationale.
10. Update contact log with planned outreach date for each selected contact.
11. Call `aireadylife-career-task-update-open-loops` with follow-up reminders for each drafted message (2-week follow-up window if no response).

## Input

- `~/Documents/aireadylife/vault/career/` — contact log with relationship recency data
- `~/Documents/aireadylife/vault/career/00_current/` — active pipeline for contact overlap check
- `~/Documents/aireadylife/vault/career/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/career/config.md` — target companies and industries for contact prioritization

## Output Format

**Network Review Summary** — saved as `vault/career/02_briefs/YYYY-MM-network-review.md`

```
## Network Health — [Month Year]

Active (last 60 days): X contacts
Warm (60-90 days): X contacts — [names of top priority]
Cooling (90-180 days): X contacts
Dormant (180+ days): X contacts — flagged for decision

## Outreach This Month (X selected)

### [Contact Name] — [Their Company] — [Context Type]
Relationship: [How you know them]
Last contact: [date] — [X days ago]
Draft message:
> [personalized 3-4 sentence message]

## New Connections to Engage
- [Name] @ [Company] — connected [date]

## Pipeline Follow-Ups (via network contacts)
- [Company/Contact] — [follow-up action needed]
```

## Configuration

Required fields in `vault/career/config.md`:
- `target_companies` — list of target employer companies for contact prioritization
- `linkedin_profile_url` — your profile for new connection scanning
- `linkedin_chrome_profile` — path to Chrome profile

Contact records should be stored in `vault/career/` with fields: name, current company, role, how_we_met, last_contact_date, last_contact_type, notes.

## Error Handling

- **Contact log empty or missing:** Prompt user to populate `vault/career/` with at least their top 10-20 strategic contacts before the network review can produce useful output.
- **LinkedIn access unavailable:** Skip new connection scan; complete the rest of the review from vault contact log alone.
- **No contacts in warm/cooling range:** Report that all contacts are either active or dormant. For dormant contacts, present the list and ask the user to identify which are worth attempting to revive with a specific reconnect hook.
- **Draft message quality check:** If a contact record has no notes or context beyond name and company, flag that the draft message will be generic and ask the user to add context before sending.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/career/` (contact log), `~/Documents/aireadylife/vault/career/00_current/`, `~/Documents/aireadylife/vault/career/config.md`
- Writes to: `~/Documents/aireadylife/vault/career/02_briefs/`, `~/Documents/aireadylife/vault/career/open-loops.md`, `~/Documents/aireadylife/vault/career/` (contact log updates)
