---
name: aireadylife-social-task-flag-overdue-contact
type: task
description: >
  Writes a relationship flag to vault/social/open-loops.md when a close contact hasn't been reached
  in 90+ days or a professional contact in 180+ days, with name, last contact date, and suggested
  outreach type.
---

# aireadylife-social-flag-overdue-contact

**Trigger:** Called by social relationship review flows when a contact crosses the overdue threshold
**Produces:** Overdue relationship flag in ~/Documents/aireadylife/vault/social/open-loops.md

## What It Does

This task fires when the relationship health flow identifies a contact who has crossed the overdue threshold for their tier. Its purpose is to ensure that overdue relationships don't silently stay overdue — they become visible open-loop items that surface in the Chief brief every day until resolved.

**Threshold logic:** Overdue thresholds are tier-specific (from vault/social/config.md defaults): Tier 1 (Inner Circle): overdue at 60+ days. Tier 2 (Close): overdue at 90+ days. Tier 3 (Active): overdue at 180+ days. When a contact crosses their tier's threshold, this task is called to write the flag.

**Flag content:** The flag includes the contact's name, tier, the date of the last logged interaction, the number of days that have elapsed since that interaction (as of today), the relationship description from contacts.md (what this person means to the user — their context in the relationship), and a suggested outreach approach calibrated to the gap and tier. For Tier 1 at 60-90 days: text or short email. For Tier 1 at 90-180 days: phone call. For Tier 1 at 180+ days: either phone call with a genuine personal note or an in-person reconnect if local. For Tier 2 at 90-180 days: text or email. For Tier 2 at 180+ days: a warmer reconnect (phone call or coffee). For Tier 3 at 180+ days: LinkedIn message or professional email.

**Reconnect framing:** The flag includes a brief suggested conversation opener — not a script, but a context note that helps the user avoid the generic "Hey, haven't talked in a while!" opener. It pulls from the most recent interaction log entry for that contact to suggest a natural reconnect hook: "Last talked in October — they were going through a job search. Natural opener: asking how that resolved."

**Deduplication:** Before writing, the task checks vault/social/open-loops.md for an existing unresolved flag for the same contact. If found: it adds an escalation timestamp with the updated days-since-contact count rather than creating a duplicate. The escalation shows the contact is getting further overdue, which may prompt the user to increase the urgency of the outreach.

**Resolution:** The flag is marked resolved when a new interaction is logged in vault/social/00_current/ for that contact. The next time `social-task-update-open-loops` runs, it detects the new interaction and marks the corresponding open-loop flag as complete.

## Steps

1. Receive contact details from calling flow: name, tier, last contact date, days since contact
2. Look up contact description and last interaction notes from vault/social/00_current/
3. Determine suggested outreach medium based on tier + days-since-contact
4. Generate reconnect hook from last interaction context
5. Check vault/social/open-loops.md for existing unresolved flag for this contact
6. If existing flag: update with escalation timestamp and refreshed days-since count; do not duplicate
7. If no existing flag: write new flag entry with full content
8. Return confirmation to calling flow

## Input

- Contact data from calling flow (name, tier, last contact date, days since contact)
- ~/Documents/aireadylife/vault/social/00_current/{contact-slug}.md (for reconnect context)
- ~/Documents/aireadylife/vault/social/open-loops.md (for deduplication check)

## Output Format

Entry in vault/social/open-loops.md:
```markdown
- [ ] 🔴 **Reach out to [Name]** — T1 Inner Circle — Last contact: 122 days ago (Dec 12, 2025)
  - tier: T1
  - days_overdue: 62 (threshold: 60)
  - suggested_medium: Phone call
  - reconnect_hook: Last talked in December — they were just starting a new job. Ask how the first few months went.
  - flagged_date: 2026-04-13
  - escalation_log:
    - 2026-04-13: Flagged — 122 days since last contact (62 days overdue)
```

```markdown
- [ ] 🟡 **Reach out to [Name]** — T2 Close — Last contact: 95 days ago (Jan 7, 2026)
  - tier: T2
  - days_overdue: 5 (threshold: 90)
  - suggested_medium: Text or email
  - reconnect_hook: Had coffee in January — mentioned they were thinking about moving to Austin. Good check-in topic.
  - flagged_date: 2026-04-13
```

## Configuration

Optional in vault/social/config.md:
- `health_thresholds` — per-tier overdue thresholds in days (defaults: T1=60, T2=90, T3=180)

## Error Handling

- **No interaction log for contact:** Write flag with "No interaction history found" as reconnect context. Don't suppress the flag — the overdue threshold is met regardless of whether we know why.
- **open-loops.md missing:** Create before writing.
- **Contact tier not assigned:** Default to Tier 2 thresholds and suggest email outreach.

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/social/00_current/, ~/Documents/aireadylife/vault/social/open-loops.md
- Writes to: ~/Documents/aireadylife/vault/social/open-loops.md
