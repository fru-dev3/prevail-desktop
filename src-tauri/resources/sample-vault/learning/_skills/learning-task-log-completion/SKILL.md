---
name: aireadylife-learning-task-log-completion
type: task
cadence: as-completed
description: >
  Records a completed course, certification, or book to vault/learning/01_prior/ with full context: title, type, platform, completion date, estimated hours invested, 1-3 key takeaways in plain language (Feynman-style), personal rating (1-5), and any credential earned with ID or URL. Moves the item from active vault to archive. Triggers: "log completion", "I finished", "mark as complete", "I passed my exam", "I finished reading", "course complete".
---

## What It Does

Creates a permanent completion record when a learning item is finished. The completion archive serves three purposes: it feeds into pace calculations and YTD counts for the monthly and quarterly reviews, it provides a searchable history of everything learned over time that can be referenced when preparing for interviews or performance reviews, and it records the key takeaways while they are fresh — the most reliable preservation of what was actually learned before the forgetting curve erodes the details.

**What gets recorded:**

*Title and metadata:* Title, type (course / certification / book / podcast series / workshop), platform or publisher, and completion date. For certifications: the specific exam passed (e.g., "AWS SAA-C03"), the passing score if available, and the credential ID or certificate URL.

*Time investment:* Estimated total hours invested. For courses: the platform's stated duration or the user's actual time logged. For books: estimated hours = pages × (pages per minute for the user's typical reading speed, defaulting to 1 page/minute = 60 pages/hour for a 300-word/min reader of a 300-word/page nonfiction book). For certifications: actual study hours logged plus exam time.

*Key takeaways:* 1-3 specific, concrete takeaways written in plain language using the Feynman technique — what would you explain to someone unfamiliar with this topic that represents the most valuable thing you learned? Vague takeaways ("learned about cloud computing") are rejected in favor of specific ones ("AWS S3 lifecycle policies can auto-transition objects to cheaper storage tiers after N days, reducing storage costs 40-70% for cold data without changing application code"). These takeaways are searchable and useful for months or years after completion.

*Rating:* 1-5 personal rating with optional short rationale. Useful for evaluating whether to recommend a resource to others or whether to revisit it for a deeper dive.

*Skills updated:* The task updates the skills inventory in `vault/career/00_current/skills.md` (if Career plugin is installed) to reflect any skills that should now be at a higher proficiency level following completion. This closes the loop between the learning portfolio and the career skills gap analysis.

## Triggers

- "log completion"
- "I finished [item]"
- "mark as complete"
- "I passed my [cert] exam"
- "I finished reading [book]"
- "course complete — [name]"
- "add to completed learning"

## Steps

1. Collect item details: title, type, platform, completion date (today by default).
2. Confirm it is in the active vault (`vault/learning/00_current/`) — retrieve existing record for metadata continuity.
3. Collect key takeaways (prompt user for 1-3 if not provided).
4. Collect rating (1-5) and any credential details (cert ID, certificate URL).
5. Estimate hours invested: from study log in `vault/learning/00_current/study-log.md` if tracked, or from user input or platform stated duration.
6. Compose completion record with all fields.
7. Write completion record to `vault/learning/01_prior/` with filename format: `YYYY-MM-DD-[type]-[title-slug].md`.
8. Remove item from `vault/learning/00_current/` active items (or mark status as "completed" in the active item record).
9. If type is course or certification: check if any skills in `vault/career/00_current/skills.md` should be updated. Prompt user to confirm skill level update.
10. Return confirmation with archive file location and updated skill inventory changes.

## Input

- User-provided completion details (title, type, takeaways, rating, credential)
- `~/Documents/aireadylife/vault/learning/00_current/` — existing item record if present
- `~/Documents/aireadylife/vault/learning/00_current/study-log.md` — for hours calculation

## Output Format

Completion record written to `vault/learning/01_prior/YYYY-MM-DD-[type]-[slug].md`:

```yaml
title: "[name]"
type: course / certification / book / workshop
platform: "[platform or publisher]"
date_completed: "YYYY-MM-DD"
hours_invested: X
rating: X  # 1-5

key_takeaways:
  - "[specific, plain-language takeaway 1]"
  - "[specific, plain-language takeaway 2]"
  - "[specific, plain-language takeaway 3]"

credential:
  name: "[credential name if applicable]"
  id: "[credential ID]"
  url: "[certificate URL]"
  expiry: "YYYY-MM-DD"  # if applicable

skills_updated:
  - skill: "[skill name]"
    new_proficiency: working / proficient / expert

notes: "[optional additional context]"
```

Confirmation returned to user:
```
Logged: [Title] — [Type] — Completed [date]
Archive: vault/learning/01_prior/[filename]
Hours invested: X
Takeaways recorded: X
Skills updated: [list if any]
YTD completions: X ([type breakdown])
```

## Configuration

No configuration required beyond standard vault setup. Archive directory auto-created if it does not exist.

## Error Handling

- **Title not provided:** Cannot log without a title. Prompt for title.
- **Item not found in active vault:** Can still log the completion — create the archive record from user-provided details. Note that the item was not in the active tracker.
- **No takeaways provided:** Prompt the user for at least 1 key takeaway before completing the log. A completion record with no takeaways has lower long-term value. Accept if user declines after one prompt.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/learning/00_current/`
- Writes to: `~/Documents/aireadylife/vault/learning/01_prior/`, `~/Documents/aireadylife/vault/career/00_current/skills.md` (if Career plugin installed)
