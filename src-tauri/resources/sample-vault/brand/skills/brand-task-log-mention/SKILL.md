---
name: aireadylife-brand-task-log-mention
type: task
cadence: as-received
description: >
  Records a brand mention to vault/brand/00_current/ with platform, author, date, sentiment,
  content summary, and link. Flags high-priority mentions (journalist, viral potential) for
  immediate action.
---

## What It Does

Accepts a brand mention — surfaced by the user, detected via a Google Alert, or found during a manual social scan — and logs it as a structured record in `~/Documents/aireadylife/vault/brand/00_current/`. This log is the source of truth for the monthly mention analysis and brand health score sentiment component.

Each record captures: platform where the mention appeared (LinkedIn, Twitter/X, YouTube comments, news article, podcast, blog, forum, other), the author's name and handle, their approximate follower count if known, the date and time of the mention, sentiment classification (positive / neutral / negative based on the tone and intent of the mention), a 2-3 sentence summary of the mention content (what was said, in what context, whether the user was praised, cited, critiqued, or questioned), a link or URL to the original post, and a "responded" status field (default: no).

Applies a high-priority assessment using three criteria: author type (verified journalist, named publication, or academic institution), follower threshold (above configured threshold, default 10,000), or engagement signal (post already has 100+ likes, shares, or comments indicating viral potential). If any criterion is met, writes an immediate 🔴 urgent flag to vault/brand/open-loops.md with a recommended response action and an explicit 24-hour response window note — after 24 hours, the social media response window closes for most posts. Standard mentions are logged without an immediate flag and are picked up in the next monthly mention analysis.

For negative mentions specifically: always flags for review regardless of author size. A negative mention from a small account is manageable; ignored, it can still be screenshot and shared. The response window for negative mentions is shorter than for positive ones — address constructive criticism gracefully and promptly.

## Triggers

- "log a mention"
- "someone mentioned me on [platform]"
- "I got a shoutout from [author]"
- "add this mention to my brand log"
- "[author] wrote about me"
- Called as-received when a brand mention is discovered

## Steps

1. Collect mention details from the user: platform, author (name + handle), author follower count (approximate, if known), date of mention, link to the original post
2. Read or be told the content of the mention; classify sentiment: positive (praise, recommendation, citation in positive context), neutral (factual reference, question, mention without judgment), negative (criticism, complaint, correction, dispute)
3. Write a 2-3 sentence content summary: what was said, why they mentioned the user, context of the mention
4. Apply high-priority check: follower count > configured threshold OR author type = journalist/publication/institution OR engagement already > 100 (likes+shares+comments)
5. Check for a duplicate record: look for an existing entry in vault/brand/00_current/ with the same author handle and date; if found, ask whether to update or log as a separate entry
6. Write mention record to vault/brand/00_current/{YYYY-MM-DD}-{platform}-{author-slug}.md
7. If high-priority: write 🔴 urgent flag to vault/brand/open-loops.md with author, platform, mention summary, and recommended response action with 24-hour window note
8. For any negative mention (any size): write 🟡 flag to open-loops regardless of author size, with content summary and suggested response approach
9. Return confirmation of record written and any flags created

## Input

User-provided information:
- Platform (required)
- Author name and handle (required)
- Date of mention (required; defaults to today if not specified)
- Link to original post (required; helps with verification and response)
- Content of the mention (required; user can paste the text or describe it)
- Author follower count (optional but enables high-priority assessment)
- Sentiment (optional; if not provided, assess from content description)

## Output Format

Written record at `~/Documents/aireadylife/vault/brand/00_current/{YYYY-MM-DD}-{platform}-{author-slug}.md`:
```
# Mention Record

platform: {platform}
author_name: {name}
author_handle: @{handle}
author_followers: {approximate count or "unknown"}
date: {YYYY-MM-DD}
sentiment: {positive / neutral / negative}
content_summary: >
  {2-3 sentence summary of what was said and in what context}
link: {URL}
responded: no
high_priority: {yes / no}
notes: {optional additional context}
```

## Configuration

Required in `~/Documents/aireadylife/vault/brand/config.md`:
- `mention_notable_follower_threshold` — follower count above which a mention triggers high-priority flag (default: 10000)
- `mention_notable_author_types` — list of author types that always trigger high-priority (e.g., ["journalist", "publication", "academic"])

## Error Handling

- If no link is provided: log the mention but flag it as "link missing — verify and add URL for future reference."
- If follower count is unknown: set to "unknown" and skip follower-threshold high-priority check; other criteria still apply.
- If the content of the mention is unknown (user only knows they were mentioned but has not seen the content yet): log a placeholder record with sentiment "unknown" and flag for follow-up: "Mention recorded without content — retrieve and update record after viewing."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/brand/config.md`, `~/Documents/aireadylife/vault/brand/00_current/` (duplicate check)
- Writes to: `~/Documents/aireadylife/vault/brand/00_current/{YYYY-MM-DD}-{platform}-{author-slug}.md`, `~/Documents/aireadylife/vault/brand/open-loops.md` (if high-priority or negative)
