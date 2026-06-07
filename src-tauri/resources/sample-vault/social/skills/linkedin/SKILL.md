---
name: linkedin
type: app
description: >
  Accesses LinkedIn connections list, profile data, and messaging via Playwright with Chrome
  cookies. Used by social-agent for professional relationship review, dormant connection
  identification, and reconnection queuing. Must use headless=False — LinkedIn blocks headless
  browsers. Configure Chrome profile path in vault/social/config.md.
---

# LinkedIn — Social Plugin

**Auth:** Playwright + Chrome cookies (headless=False required)
**URL:** https://www.linkedin.com
**Configuration:** Set profile URL and Chrome profile path in `vault/social/config.md`

## What It Does

Provides the social-agent with professional relationship data from LinkedIn — connection lists,
mutual connections, recent activity, and messaging history — to supplement the vault contact files
for professional-tier contacts. LinkedIn is used for reconnection context (what someone is working
on now, recent job changes, shared posts) rather than as a primary relationship tracker. The vault
contact files remain the source of truth; LinkedIn provides current professional context for
outreach personalization.

## Data Available

- Connections list (name, current title, company, connection date)
- Profile activity: recent posts, comments, job changes, work anniversaries
- Messaging thread history per connection — last message sent/received and date
- Birthday notifications (from LinkedIn's native birthday alerts)
- Work anniversary notifications — reconnect opportunities for professional contacts
- Mutual connections count — useful when warming up a dormant professional relationship
- "People You May Know" — optional; identifies new contacts to add to vault

## Configuration

Add to `vault/social/config.md`:
```
linkedin_profile_url: https://www.linkedin.com/in/YOUR-HANDLE
linkedin_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
linkedin_connections_export_path: ~/Documents/aireadylife/vault/social/00_current/linkedin-connections.csv
```

**Chrome profile requirement:** LinkedIn detects headless browsers and bot-like behavior. Must use
`headless=False` with a Chrome profile that has an active LinkedIn session. The session cookies in
the Chrome profile provide authentication — no username/password needed in the script.

**Connections CSV export (recommended for roster):** LinkedIn Settings → Data Privacy → Get a copy
of your data → Connections → Request archive (delivered by email within 24 hours). CSV contains:
First Name, Last Name, Email Address, Company, Position, Connected On. Use this for bulk roster
analysis rather than scraping the connections list page.

## Notes

- **headless=False is required** — LinkedIn uses browser fingerprinting and bot detection that
  reliably blocks headless Playwright. Always launch with `headless=False`.
- Rate-limit all message-related reads: max 50 profile loads per session, 10-15 message threads per
  session. LinkedIn may flag accounts that load hundreds of profiles rapidly.
- LinkedIn connections are not the same as real relationships. Use LinkedIn data as context for
  professional-tier contacts (T3/T4) already in the vault — do not auto-create vault records for
  every LinkedIn connection.
- Work anniversaries and job changes are high-quality reconnect triggers for professional contacts
  who have gone dormant. Surface these in the outreach queue with specific context ("just moved to
  Director role at Acme — good moment to reconnect").
- Birthday notifications on LinkedIn are often approximate (LinkedIn prompts users to add birthdays
  without requiring the year). Cross-reference with Contacts app for accurate birthday data.
- LinkedIn messaging history shows last sent/received date — useful for confirming that a contact
  flagged as overdue in the vault has actually had no recent contact.

## Used By

- `social-op-relationship-review` — audit dormant professional connections (T3/T4) against vault
  records; surface work anniversary and job change reconnect opportunities
- `social-op-monthly-sync` — check for new connections added since last sync; identify LinkedIn
  contacts who should be added to vault contact files; pull recent activity for context refresh
- `social-flow-build-outreach-queue` — enrich queue entries for professional contacts with current
  title, company, and recent LinkedIn activity for outreach personalization

## Vault Output

`~/Documents/aireadylife/vault/social/00_current/linkedin-connections.csv` — raw connections export
`~/Documents/aireadylife/vault/social/00_current/` — enriched context written to individual contact
files by social-op-monthly-sync and social-flow-build-outreach-queue, not by this skill directly
