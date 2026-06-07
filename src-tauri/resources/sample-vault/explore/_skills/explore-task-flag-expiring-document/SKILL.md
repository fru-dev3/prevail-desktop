---
name: aireadylife-explore-task-flag-expiring-document
type: task
description: >
  Writes a document expiration flag to vault/explore/open-loops.md with document type, person,
  expiration date, renewal timeline, and action needed.
---

# aireadylife-explore-flag-expiring-document

**Trigger:** Called by explore document-checking flows and ops
**Produces:** Expiration flag entry in ~/Documents/aireadylife/vault/explore/open-loops.md

## What It Does

This task writes a structured expiration flag whenever a travel document is found within the alert window for its type. Its purpose is to ensure that document renewal actions are visible and persistent — not just in a periodic audit report, but as standing open-loop items that surface in the Chief brief every day until the renewal is complete.

**Flag content:** Each flag entry captures the complete context needed to take action immediately: document type (US passport, Global Entry, TSA PreCheck, Nexus, [country] visa, Yellow Fever vaccination, etc.), the person the document belongs to, the exact expiration date, the days remaining as of the flag date, the renewal lead time specific to that document type (so the user knows whether they need to act now or in the next few months), the recommended action stated specifically (including the URL, phone number, or location to start the renewal process), and the urgency tier based on days remaining vs. lead time.

**Urgency calibration:** The urgency assigned depends on whether there is still comfortable time to renew before the document creates a travel constraint. For example, a passport with 9 months remaining and a 10-13 week renewal time gets a 🟡 flag ("Start renewal process — comfortable window but don't delay"). The same passport at 5 months remaining gets 🔴 ("Renew immediately — approaching the window where travel may be restricted"). For Global Entry, which has 2-6 month processing and requires an interview (which may have 3-12 month booking waits), the 🔴 flag starts 12 months before expiry.

**Deduplication:** Before writing, the task checks vault/explore/open-loops.md for an existing unresolved flag for the same document + person combination. If found: it updates the existing entry with the current days-remaining count rather than creating a duplicate. Each update is timestamped in the entry's escalation log. This ensures the flag count in vault/explore/open-loops.md doesn't inflate with repeated monthly scan flags for the same underlying issue.

**Resolution condition:** The flag is marked resolved when the task is called with a completion signal (the renewal was submitted and the new document is on file), or when `explore-task-update-open-loops` detects that the document record in vault/explore/00_current/ has been updated with a new expiry date beyond the alert window.

## Steps

1. Receive document details from calling flow: type, person, expiry date, days remaining, urgency
2. Generate flag entry with full content: document type, person, expiry, days remaining, lead time, action, urgency
3. Check vault/explore/open-loops.md for existing unresolved flag matching same document + person
4. If existing flag found: update days-remaining count and add escalation timestamp; do not create duplicate
5. If no existing flag: append new flag entry at top of active section
6. Return confirmation to calling flow

## Input

- Document data from calling flow (type, person, expiry date, days remaining, urgency tier)
- ~/Documents/aireadylife/vault/explore/open-loops.md (for deduplication check)

## Output Format

Entry appended to vault/explore/open-loops.md:
```markdown
- [ ] 🔴 **Renew Global Entry — [Person Name]** — Expires Mar 1, 2026 (52 days)
  - document: Global Entry
  - person: [Name]
  - expires: 2026-03-01
  - days_remaining: 52
  - renewal_lead_time: 2-6 months processing + 3-12 month interview wait
  - action: Submit renewal NOW at cbp.gov/ttp — login, select "Renew Membership"
  - cost: $100 (check your credit card for Global Entry fee reimbursement)
  - urgency: 🔴
  - flagged_date: 2026-04-13
  - escalation_log:
    - 2026-04-13: Flagged — 52 days remaining
```

```markdown
- [ ] 🟡 **Renew US Passport — [Person Name]** — Expires Feb 14, 2027 (307 days)
  - document: US Passport
  - person: [Name]
  - expires: 2027-02-14
  - days_remaining: 307
  - renewal_lead_time: Standard 10-13 weeks / Expedited 4-6 weeks
  - action: Renew via state.dept.gov/passports by August 2026 to maintain full travel flexibility
  - cost: $130 renewal fee (standard) or $190 (expedited)
  - urgency: 🟡
  - flagged_date: 2026-04-13
```

## Configuration

No configuration required. Document type determines lead time and action copy.

## Error Handling

- **open-loops.md missing:** Create the file before writing.
- **Days-remaining calculation produces negative number (document already expired):** Escalate urgency to 🔴 regardless of type; flag as "EXPIRED — immediate action required."
- **Renewal URL or process unknown for a document type:** Write flag with "Verify renewal process at [general URL or agency]" rather than leaving the action blank.

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/explore/open-loops.md
- Writes to: ~/Documents/aireadylife/vault/explore/open-loops.md
