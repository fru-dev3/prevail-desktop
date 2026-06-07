---
name: aireadylife-brand-op-profile-audit
type: op
cadence: quarterly
description: >
  Quarterly audit of brand profile consistency across platforms (LinkedIn, Twitter/X, GitHub,
  YouTube, personal site). Checks bio, headshot, handle, URL, and bio text for drift from master
  profile. Triggers: "profile audit", "brand consistency", "update my profiles".
---

## What It Does

Runs quarterly (January, April, July, October) to produce a complete brand profile consistency assessment across all configured platforms. Profile drift is one of the most common and damaging brand problems — a LinkedIn bio that was updated but a Twitter/X bio that was not, a website URL changed but not reflected on 3 platforms, a new headshot rolled out to some platforms but not others. Audiences notice inconsistency even when they cannot articulate why it feels off.

Calls `aireadylife-brand-flow-check-profile-consistency` to perform the field-by-field comparison of each platform's current-state snapshot against the master brand profile. For each discrepancy found, calls `aireadylife-brand-task-flag-profile-inconsistency` to write a prioritized fix action to open-loops. Presents the full audit results in a format that makes it easy for the user to go update each platform in a single session — a "profile update checklist" rather than just a list of problems.

Checks LinkedIn specifically for profile completeness signals that affect algorithmic discoverability: headline is present and keyword-rich, summary is filled (2,000 characters is the limit — use it), featured section has at least one item, skills section has 10+ endorsed skills, and all experience entries have descriptions. A complete LinkedIn profile generates 40x more opportunities than an incomplete one.

Also checks for the user's author presence across any blogs, guest publications, or media mentions — consistent author name and bio on external sites contributes to Google Knowledge Panel development and personal brand SEO authority. Writes a dated audit report to vault/brand/02_briefs/ and updates open-loops.

## Triggers

- "profile audit"
- "brand consistency check"
- "update my profiles"
- "check my bio across platforms"
- "are my profiles consistent"
- "quarterly brand audit"
- "LinkedIn profile audit"

## Steps

1. Confirm master-profile.md exists; if not, prompt user to create it and provide field template
2. Call `aireadylife-brand-flow-check-profile-consistency`; receive discrepancy list, consistency score, and missing-snapshot warnings
3. For each 🔴 discrepancy: call `aireadylife-brand-task-flag-profile-inconsistency` to write to open-loops
4. For each 🟡 discrepancy: call `aireadylife-brand-task-flag-profile-inconsistency` with 🟡 priority
5. For each missing platform snapshot: add a note prompting manual verification and snapshot update after the user has checked the platform
6. Check LinkedIn specifically for completeness signals: headline, summary character count, featured section items, skills count; flag any that are below target
7. Check for consistent author name/bio on any external publications or media mentions configured in config.md
8. Compile full audit report with: consistency score, per-platform status table (green / needs update), update checklist ordered by priority
9. Write audit report to vault/brand/02_briefs/profile-audit-{Q}-{YYYY}.md
10. Call `aireadylife-brand-task-update-open-loops` with all flags from the audit

## Input

- `~/Documents/aireadylife/vault/brand/00_current/master-profile.md` — canonical brand identity
- `~/Documents/aireadylife/vault/brand/00_current/{platform}.md` — per-platform snapshots
- `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/brand/config.md` — platforms, LinkedIn completeness targets, external publication list

## Output Format

```
# Profile Audit — Q{X} {Year}

**Consistency Score:** XX% | **LinkedIn Completeness:** XX%

## Per-Platform Status
| Platform     | Status         | Issues Found                           |
|--------------|----------------|----------------------------------------|
| LinkedIn     | Needs update   | Bio outdated, featured section empty   |
| Twitter/X    | Current        | —                                      |
| YouTube      | Needs update   | Channel description outdated           |
| Personal site| Current        | —                                      |
| GitHub       | Unknown        | No snapshot — verify manually          |

## Update Checklist (ordered by priority)
🔴 LinkedIn: Add website URL (currently missing — direct SEO and traffic impact)
🟡 LinkedIn: Update bio to current version (3 words differ from master)
🟡 YouTube: Update channel description to current long bio
🟢 Twitter/X: Minor tagline wording variation (acceptable or update next pass)

## LinkedIn Completeness
- Headline: ✓ | Summary: 1,200 chars (target: 1,800+) | Featured: 1 item (target: 3+)
- Skills: 12 endorsed | Experience descriptions: ✓

## After Updating
For each platform you update, refresh the snapshot file at:
vault/brand/00_current/{platform}.md
```

## Configuration

Required in `~/Documents/aireadylife/vault/brand/config.md`:
- `platforms` — list of all platforms to audit
- `linkedin_headline_target_length` — minimum character count for LinkedIn headline (default: 100)
- `linkedin_summary_target_length` — target character count for summary (default: 1800)
- `external_publications` — list of external sites where the user has an author profile (for bio consistency check)

## Error Handling

- If master-profile.md is missing: "Cannot run profile audit without a master brand profile. Create vault/brand/00_current/master-profile.md first."
- If all platform snapshots are outdated (more than 6 months old): flag "All snapshots may be stale — update each platform's snapshot file after checking current profile state."
- If consistency score is below 60%: lead the audit report with "Brand consistency is low. Multiple platforms are out of sync. Complete the update checklist this week."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/config.md`
- Writes to: `~/Documents/aireadylife/vault/brand/02_briefs/profile-audit-{Q}-{YYYY}.md`, `~/Documents/aireadylife/vault/brand/open-loops.md`
