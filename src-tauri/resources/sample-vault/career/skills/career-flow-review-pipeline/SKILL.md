---
name: aireadylife-career-flow-review-pipeline
type: flow
trigger: called-by-op
description: >
  Reviews the active application pipeline for staleness and stall signals. Flags applications with no response in 7+ business days, opportunities at the same stage for 14+ days, and watch-list items that have closed. Produces a status report with prioritized follow-up actions for each flagged item.
---

## What It Does

Called by `aireadylife-career-op-monthly-sync` and `aireadylife-career-op-network-review` to audit the active pipeline and surface what needs attention. Most job searches fail not because of a lack of applications but because of poor pipeline management — following up too late, letting promising opportunities go cold, or losing track of what stage each opportunity is at.

**Reading the pipeline:** Loads all active pipeline entries from `vault/career/00_current/`. Each entry stores: company, role title, source (how you found the role — LinkedIn, referral, company site, recruiter), stage (watch / applied / phone-screen / technical / final / offer), date of last activity, contact name, and next planned action. The flow does not process archived (closed) pipeline items.

**Staleness rules by stage:** Different stages have different follow-up windows. After submitting an application: no response in 7 business days = follow-up recommended with a brief check-in message. After a phone screen: no next step in 5 business days = nudge the recruiter on timeline. After a technical or final interview: no response in 5 business days = follow-up is warranted; at 10 business days, it is appropriate to reach out directly to the hiring manager. After receiving an offer: the follow-up window is whatever the stated deadline is. Watch-list items: no posting update in 30 days = check if the posting is still active.

**Stall signal:** An opportunity at the same stage for 14+ days without a logged next step is classified as stalled. This is different from follow-up waiting — stalled means there is no clear path forward. For stalled items, the flow generates three choices: (1) follow up assertively with a specific ask (timeline question, additional materials offer), (2) deprioritize to a lower-attention status while keeping the opportunity technically open, or (3) archive the opportunity as closed (no response = rejection signal).

**Closed watch-list cleanup:** For watch-list items, checks if the posting source URL (stored in the pipeline entry) still returns an active posting. If the posting has been removed or marked "no longer accepting applications," archives the watch-list item and notes the close reason.

## Steps

1. Load all active pipeline entries from `vault/career/00_current/` where stage is not "archived".
2. Calculate business days since last activity for each entry.
3. Apply staleness thresholds by stage: applied (7 days), post-screen (5 days), post-interview (5 days), offer pending (per stated deadline).
4. Flag each entry exceeding its threshold as "follow-up needed" with suggested message angle.
5. Calculate total days at current stage for each entry; flag entries at same stage for 14+ days as "stalled".
6. For each stalled entry: generate three path options (assertive follow-up / deprioritize / archive).
7. Check all watch-list entries for posting status (active / closed).
8. Archive watch-list items where posting is confirmed closed.
9. Count pipeline entries by stage — produce stage funnel counts.
10. Sort flagged items by urgency: offer deadlines first, then post-final follow-ups, then post-screen, then post-apply.
11. Return status report with stage funnel counts, all flagged items sorted by urgency, and recommended action per item.

## Input

- `~/Documents/aireadylife/vault/career/00_current/` — all active pipeline entries
- `~/Documents/aireadylife/vault/career/01_prior/` — prior period records for trend comparison

## Output Format

Structured status report returned to calling op:

```
## Pipeline Status

Stage Funnel:
  Watching: X | Applied: X | Screening: X | Technical: X | Final: X | Offer: X

## Requires Action (sorted by urgency)

[Company] — [Role] — [Stage]
  Last activity: [date] ([X] business days ago)
  Follow-up type: [Post-apply check-in / Post-interview nudge / Stalled decision]
  Suggested action: [specific message angle or decision]
  Action by: [date]

## Watching — Posting Status Check
  [Company] — [Role] — Posting [Active / Closed] — [action]

## Recently Archived (this run)
  [Company] — [Role] — Reason: [posting closed / 90+ days no response]
```

## Configuration

No additional configuration required. Pipeline entry format at `vault/career/00_current/`:
```yaml
company: "[name]"
role: "[title]"
stage: watch / applied / screen / technical / final / offer
date_applied: "YYYY-MM-DD"
last_activity_date: "YYYY-MM-DD"
contact_name: "[name]"
contact_email: "[email]"
source: linkedin / referral / company-site / recruiter
comp_range: "$X–$X"
notes: "[interview notes, follow-up log]"
posting_url: "[url for watch-list staleness check]"
```

## Error Handling

- **Pipeline entry missing required fields:** Note which fields are absent and proceed with available data; missing `last_activity_date` defaults to `date_applied` for staleness calculation.
- **Posting URL unavailable for watch-list check:** Cannot confirm posting status — note as "status unknown" and suggest manual verification.
- **No active pipeline entries:** Return stage funnel with all zeros — not an error, just a state. Note in calling op's brief.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/career/00_current/`
- Writes to: `~/Documents/aireadylife/vault/career/00_current/` (archive updates)
