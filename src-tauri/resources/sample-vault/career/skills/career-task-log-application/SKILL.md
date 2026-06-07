---
name: aireadylife-career-task-log-application
type: task
cadence: as-received
description: >
  Records a new job application (or pre-application watch item) to vault/career/00_current/ with full context: company, role, date, source, contact, comp range, tech stack, work arrangement, fit notes, and default follow-up window. Sets a 7-business-day follow-up reminder. Triggers: "log application", "add to pipeline", "track this application", "I applied to", "add this job to my tracker".
---

## What It Does

Records every job application to the pipeline immediately upon submission — not at the end of the week or month, but at the moment it happens. The purpose of immediate logging is to ensure the 7-business-day follow-up timer starts from the correct date and that all application context (the specific version of the resume submitted, the job description text, the contact who referred you) is captured while it is still fresh.

**What gets logged:** Company name, role title and level, date applied, application source (LinkedIn Easy Apply / company website / employee referral / recruiter outreach / cold application), the name and contact method of any internal employee referral or recruiter contact involved, the stated or estimated compensation range for the role, work arrangement (remote / hybrid / onsite), a brief tech stack match assessment (what fraction of required skills are in your inventory), and the initial stage ("applied"). For roles tracked before application (watch stage), all the same fields are captured except date_applied (populated when actually applying).

**Follow-up logic:** A default follow-up reminder is set for 7 business days from the application date. This reminder surfaces in the pipeline review flow, which will flag the application as "follow-up due" if no response has been logged by that date. The reminder is not a commitment to follow up — it is a decision point to either follow up, extend the wait, or acknowledge silence as a soft rejection.

**Offer letter capture:** When an offer is received, this task or a manual update to the pipeline entry captures: base salary offered, signing bonus, equity grant details (shares, cliff, vesting schedule), target bonus percentage, start date, and offer expiry deadline. The offer comparison framework (base / bonus / equity / benefits / remote / PTO / growth) is appended as a structured evaluation section.

**Pre-application tracking:** The task also handles "watch" stage logging — tracking a role from discovery through the application decision. Watch entries include posting URL (for staleness checks in the pipeline review), the reason it is on watch (strong company match, target role alignment, waiting for referral connection), and a decision-by date.

## Triggers

- "log application"
- "add to pipeline"
- "track this application"
- "I applied to [company]"
- "I just applied for [role] at [company]"
- "add this role to my watch list"
- "I got a recruiter message from [company]"

## Steps

1. Collect required fields from user: company, role title, date applied (or today if not specified), and source.
2. Collect optional enrichment fields: contact name, contact method, comp range, remote policy, tech stack match.
3. Determine stage: "applied" for submitted applications, "watch" for pre-application tracking, "offer" if an offer is being logged.
4. For "applied" stage: calculate follow-up date as date_applied + 7 business days.
5. For "watch" stage: set decision_by date if provided; default to 30 days from today.
6. For "offer" stage: capture full offer details and calculate offer expiry date.
7. Assess tech stack match if job description is provided: count required skills from JD that appear in `vault/career/00_current/skills.md`. Report as X/Y required skills matched.
8. Write complete pipeline entry to `vault/career/00_current/COMPANY-ROLE-YYYYMMDD.md`.
9. Return confirmation with follow-up date and any missing fields the user should fill in later.

## Input

- User-provided application details (company, role, source, etc.)
- Job description text (optional, for tech stack match assessment)
- `~/Documents/aireadylife/vault/career/00_current/skills.md` — for stack match calculation

## Output Format

Pipeline entry written to `vault/career/00_current/COMPANY-ROLE-YYYYMMDD.md`:

```yaml
company: "[name]"
role: "[title]"
level: "[level if stated]"
stage: applied / watch / offer
date_applied: "YYYY-MM-DD"
date_logged: "YYYY-MM-DD"
source: linkedin / referral / company-site / recruiter / cold
contact_name: "[name]"
contact_email: "[email or linkedin]"
comp_range: "$X–$X"
remote_policy: remote / hybrid / onsite
tech_stack_match: "X/Y required skills matched"
follow_up_date: "YYYY-MM-DD"
last_activity_date: "YYYY-MM-DD"
notes: "[any relevant context]"
posting_url: "[url]"
status: active
```

Confirmation returned to user:
```
Application logged: [Company] — [Role] — [stage]
Follow-up reminder set: [date]
Missing fields (fill in later): [list if any]
Tech stack match: X/Y required skills matched
```

## Configuration

No configuration required beyond standard vault setup. Pipeline entries stored in `vault/career/00_current/`.

## Error Handling

- **Company or role not provided:** Prompt for both before creating the entry — these are required for the pipeline to be useful.
- **Date applied not provided:** Default to today's date and note it in the entry.
- **Duplicate entry detected (same company + similar role + date within 7 days):** Flag potential duplicate and ask user to confirm before creating a second entry.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/00_current/skills.md` (optional, for stack match)
- Writes to: `~/Documents/aireadylife/vault/career/00_current/`
