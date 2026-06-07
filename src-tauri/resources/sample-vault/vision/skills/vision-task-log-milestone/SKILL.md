---
name: aireadylife-vision-task-log-milestone
type: task
cadence: as-achieved
description: >
  Records a life milestone to vault/vision/00_current/ with domain, description,
  date achieved, and notes. Feeds the annual review retrospective and monthly
  scorecard positive signals.
---

# aireadylife-vision-log-milestone

**Cadence:** As-achieved (logged whenever a meaningful milestone is reached)
**Produces:** New milestone entry in ~/Documents/aireadylife/vault/vision/00_current/milestones.md

## What It Does

This task is the achievement recording mechanism for the entire AI Ready Life system. It captures significant life accomplishments to the vault so they can be surfaced in monthly scorecard scoring, quarterly reviews, and the annual retrospective. Without this log, the system can only measure what hasn't been done — open loops, at-risk goals, pending deadlines. The milestone log provides the counterweight: evidence of what has been accomplished, against which the open backlog is always measured.

**What qualifies as a milestone:** A milestone is any accomplishment meaningful enough to remember a year from now and worth consciously acknowledging. Examples across domains: publishing a product or content piece, hitting a savings or investment target, completing a health goal (completing a 5k, seeing a doctor for a long-avoided checkup, hitting a consistent exercise streak), executing an estate planning task (signing a will, opening an HSA, naming a beneficiary), resolving a long-standing professional goal (completing a certification, landing a promotion, publishing work), making a significant relationship investment (a meaningful trip, reconnecting with an estranged connection, hosting an important gathering), completing a learning goal (finishing a course, reading a book that changed a perspective), or resolving any 🔴 open loop that has been persistent.

**Entry fields:** Each milestone entry captures: the domain it belongs to (one of the 13 vision domains), a short title (under 10 words), a description of what was accomplished and why it matters (2-5 sentences), the date achieved, and optionally: what made it possible (the key factor that enabled this achievement), what it unlocks (the next opportunity or decision that this milestone opens), and relevant context (dollar amount saved, hours invested, people involved).

**Scorecard integration:** The monthly scorecard's build-scorecard flow reads milestones.md and counts milestones per domain per month. Each logged milestone adds positive weight to the domain's score (milestone factor: 0 milestones = 0 points, 1 = 7 points, 2 = 9 points, 3+ = 10 points). Logging milestones promptly — within a day or two of the achievement — ensures they are counted in the correct month's scorecard.

**Annual review integration:** The annual review reads the full year's milestone log to build the achievements section. Without the milestone log, year-end review relies on memory, which is heavily biased toward recent events. The log creates a complete and accurate picture of what was actually accomplished over the year — often more than people remember.

## Steps

1. Receive milestone details from user or calling op: domain, title, description, date achieved
2. Classify domain from the 13 vision domains; if ambiguous, ask the user
3. Generate milestone entry with all required fields
4. Append entry to vault/vision/00_current/milestones.md in reverse chronological order (newest first)
5. If the milestone resolves an active open loop in the relevant domain: note the open loop reference
6. Return confirmation to user with the entry added

## Input

- Milestone data from user or calling op (domain, title, description, date achieved, optional fields)
- ~/Documents/aireadylife/vault/vision/00_current/milestones.md (for appending)

## Output Format

Entry appended to vault/vision/00_current/milestones.md:
```markdown
---

## [Short Title]
**Domain:** [domain]
**Date:** [YYYY-MM-DD]

[2-5 sentence description of what was accomplished and why it matters]

**What made it possible:** [optional]
**What it unlocks:** [optional]
**Notes:** [optional — dollar amount, people involved, context]
```

Full file format:
```markdown
# Life Milestones

_Updated: YYYY-MM-DD_

---

## Memosa Published on App Store
**Domain:** career
**Date:** 2026-03-19

Launched Memosa — an AI-powered memory assistant — on the Mac App Store after 6 months of development. First public software product published under the fru.dev brand. App is live and receiving downloads.

**What it unlocks:** Foundation for AI Ready Life product line and content business.

---
[additional entries...]
```

## Configuration

No configuration required.

## Error Handling

- **Domain not determinable from description:** Ask user: "Which of the 13 life domains does this belong to? (health, wealth, career, relationships, learning, creativity, home, family, fun, community, spirituality, finance, personal growth)"
- **milestones.md missing:** Create the file with standard header before writing.
- **Date not provided:** Use today's date with a note to confirm if the achievement happened on a different day.

## Vault Paths

- Reads from: ~/Documents/aireadylife/vault/vision/00_current/milestones.md
- Writes to: ~/Documents/aireadylife/vault/vision/00_current/milestones.md
