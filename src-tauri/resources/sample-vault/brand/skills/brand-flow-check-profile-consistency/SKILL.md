---
name: aireadylife-brand-flow-check-profile-consistency
type: flow
trigger: called-by-op
description: >
  Compares brand profile elements (bio, headshot, handle, URL) across all platforms to the master
  brand profile and flags any discrepancies.
---

## What It Does

Reads the master brand profile from `~/Documents/aireadylife/vault/brand/00_current/master-profile.md`, which is the canonical reference for all brand identity fields. The master profile defines: display name (exact spelling and capitalization), short bio (100-200 characters), long bio / "About" section (500-2,000 characters depending on platform), headshot filename (the specific image file that should be used), primary website URL, primary handle or username, LinkedIn vanity URL, Twitter/X handle, YouTube channel URL, GitHub username (if applicable), and current tagline or headline.

For each configured platform, reads the stored current-state snapshot from `~/Documents/aireadylife/vault/brand/00_current/{platform}.md`. These snapshots are updated manually after each profile edit (the profile audit op prompts the user to update them). Performs a field-by-field comparison between each platform snapshot and the master profile.

For each field that differs from master: records the platform, field name, current value on the platform, expected value from master, and a plain-language recommended action. Prioritizes discrepancies by impact: missing or wrong website URL on any platform is 🔴 (direct SEO and traffic impact), outdated headline on LinkedIn is 🔴 (primary professional discovery signal), wrong headshot is 🟡 (brand consistency), minor bio wording variation is 🟢 (low priority). Treats missing platform snapshot files as "unknown — manual verification needed" rather than assuming consistency.

Returns the full discrepancy list with prioritization to the calling op.

## Triggers

Called internally by `aireadylife-brand-op-profile-audit`. Not invoked directly by the user.

## Steps

1. Read `~/Documents/aireadylife/vault/brand/00_current/master-profile.md` and extract all canonical field values
2. List all platform snapshot files present in `~/Documents/aireadylife/vault/brand/00_current/` (e.g., linkedin.md, twitter.md, youtube.md, github.md, personal-site.md)
3. For each configured platform in config.md: check whether a snapshot file exists; if missing, record as "unknown — manual verification needed"
4. For each existing platform snapshot: compare each field to master; record any field where the values differ
5. Assign priority to each discrepancy: website URL or primary handle mismatch = 🔴; headline or bio drift = 🟡 if LinkedIn/YouTube, 🟢 if secondary platform; headshot mismatch = 🟡; cosmetic bio wording variation = 🟢
6. Check for fields that have been intentionally customized per platform (noted in master-profile.md as "platform-specific") — exclude these from discrepancy list
7. Calculate a consistency score: (total fields checked - total discrepancies) / total fields checked, as a percentage
8. Return: discrepancy list with priorities, consistency score, and missing-snapshot warnings

## Input

- `~/Documents/aireadylife/vault/brand/00_current/master-profile.md` — canonical brand identity fields
- `~/Documents/aireadylife/vault/brand/00_current/{platform}.md` — per-platform current-state snapshots
- `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/brand/config.md` — list of configured platforms, platform-specific override fields

## Output Format

```
## Profile Consistency Check — {Month} {Year}

**Consistency Score:** XX% ({X} of {Y} fields consistent across all platforms)

| Platform       | Field          | Current Value         | Expected Value        | Priority | Action                    |
|----------------|----------------|-----------------------|-----------------------|----------|---------------------------|
| LinkedIn       | Website URL    | (missing)             | https://example.com   | 🔴       | Add website URL to profile |
| Twitter/X      | Bio            | "Engineer & creator"  | "[Current tagline]"   | 🟡       | Update to current bio      |
| GitHub         | Profile photo  | old-headshot.jpg      | headshot-2026.jpg     | 🟡       | Update profile photo       |

### Unknown — Manual Verification Needed
- Instagram (no snapshot file found — last audit: never)

### Platform-Specific Fields (intentional variations — not flagged)
- LinkedIn: extended "About" section (platform-specific long form)
```

## Configuration

Required in `~/Documents/aireadylife/vault/brand/00_current/master-profile.md`:
- All canonical fields must be defined. Platform-specific overrides (intentional variations) should be noted with a comment so they are not flagged as discrepancies.

Required in `~/Documents/aireadylife/vault/brand/config.md`:
- `platforms` — list of all platforms to check
- `platform_specific_fields` — fields that are intentionally different per platform (excluded from discrepancy check)

## Error Handling

- If master-profile.md does not exist: "Master brand profile not found. Create ~/Documents/aireadylife/vault/brand/00_current/master-profile.md with your canonical brand identity fields before running a profile audit."
- If master-profile.md exists but is missing key fields (e.g., no website URL): flag "master profile incomplete — add {field} to enable consistency checking on that field."
- If no platform snapshots exist at all: "No platform snapshots found. After setting up your master profile, run the profile audit and update each platform snapshot with your current profile state."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/config.md`
- Writes to: returns data to calling op; no direct file writes
