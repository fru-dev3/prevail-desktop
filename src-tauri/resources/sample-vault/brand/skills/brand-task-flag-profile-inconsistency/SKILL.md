---
name: aireadylife-brand-task-flag-profile-inconsistency
type: task
description: >
  Writes a flag to vault/brand/open-loops.md when a platform profile field diverges from the
  master brand profile. Records platform, field, current value, expected value, and fix action.
---

## What It Does

Receives a discrepancy record from the profile-audit op or the check-profile-consistency flow and writes a structured, actionable flag to `~/Documents/aireadylife/vault/brand/open-loops.md` for each inconsistency. Each flag contains everything the user needs to fix the problem: where the inconsistency is, what the wrong value is, what the correct value should be, and the precise action to take.

Assigns priority based on the field type and the platform's strategic importance. Fields that affect brand discoverability and SEO are the highest priority because they directly impact how people find the user: missing or wrong website URL on any platform is 🔴 (every platform link to the website is a backlink signal and a traffic source), LinkedIn headline or bio drift is 🔴 (LinkedIn is the primary professional discovery platform, and the algorithm surfaces you based on headline keywords), wrong headshot on LinkedIn or YouTube is 🟡 (visual brand consistency affects perception, not discoverability directly). On secondary platforms (GitHub profile, forum bios), the same fields are typically one tier lower priority. Minor bio wording variations that do not change meaning are 🟢.

Deduplicates before writing: checks vault/brand/open-loops.md for an existing unresolved flag for the same platform-field combination. If one exists, updates the "last surfaced" date rather than adding a duplicate. This prevents the same inconsistency from accumulating multiple flags across monthly audit cycles.

## Triggers

Called internally by `aireadylife-brand-op-profile-audit` and `aireadylife-brand-flow-check-profile-consistency` when a discrepancy is identified.

## Steps

1. Receive discrepancy record: platform, field name, current value on platform, expected value from master profile, calling op
2. Determine priority: website URL mismatch = 🔴; LinkedIn headline/bio on primary platform = 🔴; headshot mismatch = 🟡; URL mismatch on secondary platform = 🟡; wording variation = 🟢
3. Compose the fix action: platform name + specific field + what to change it to + where to make the change (e.g., "LinkedIn → Edit Profile → Website → add https://example.com")
4. Read vault/brand/open-loops.md; search for existing unresolved entry with same platform + field combination
5. If duplicate found: update the "last surfaced" date on the existing entry; do not add a new entry
6. If no duplicate: append new flag entry with full details
7. Return confirmation of flag written (or updated) to calling op

## Input

- Discrepancy record from calling op: platform, field, current-value, expected-value
- `~/Documents/aireadylife/vault/brand/open-loops.md` — for duplicate check
- `~/Documents/aireadylife/vault/brand/config.md` — platform priority classifications

## Output Format

Each flag written to `vault/brand/open-loops.md`:
```
{Priority} PROFILE INCONSISTENCY — {Platform} | Field: {field name}
Current: "{current value on platform}"
Expected: "{expected value from master profile}"
Fix: {Platform} → {navigation path} → update to "{expected value}"
Source: brand-op-profile-audit | Raised: {today's date} | Last surfaced: {date}
```

## Configuration

Required in `~/Documents/aireadylife/vault/brand/config.md`:
- `platforms_primary` — primary platforms receive higher priority escalation for the same field type
- `platforms_secondary` — secondary platforms receive one tier lower priority

## Error Handling

- If vault/brand/open-loops.md does not exist: create it with standard header, then write the flag entry.
- If a discrepancy record is missing the expected value (master profile field is blank): write flag as "master profile field is empty — fill in master-profile.md before this discrepancy can be verified."
- If priority cannot be determined (unknown field type): default to 🟡.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/brand/open-loops.md`, `~/Documents/aireadylife/vault/brand/config.md`
- Writes to: `~/Documents/aireadylife/vault/brand/open-loops.md`
