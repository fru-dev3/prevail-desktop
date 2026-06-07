---
name: aireadylife-brand-flow-analyze-mentions
type: flow
trigger: called-by-op
description: >
  Scans recent brand mentions for sentiment, source type, and context. Flags mentions needing a
  response and surfaces notable sources.
---

## What It Does

Reads the mention log from `~/Documents/aireadylife/vault/brand/00_current/` where all logged brand mentions are stored as structured records with platform, author, date, content summary, and sentiment pre-classification from when they were logged. Aggregates mentions by sentiment (positive, neutral, negative) and calculates the sentiment distribution for the period (e.g., "73% positive, 21% neutral, 6% negative"). Tracks change in sentiment distribution vs. prior month — a shift toward neutral or negative is an early reputation signal worth investigating before it becomes a pattern.

Identifies notable sources: accounts whose mentions warrant immediate or priority attention. Notable source criteria: verified journalist or media publication, follower count above the threshold configured in config.md (default: 10,000 followers), academic or institutional affiliation, or previous interaction history marked as high-priority. Notable sources are surfaced separately from the bulk mention list.

Scans for unanswered mentions — any mention classified as negative or neutral that has not been marked "responded" and is within the response window (configurable; default 7 days). These are response opportunities that are still live. Mentions older than the response window are flagged separately as "response window closed — monitor only."

Identifies patterns: which topics or content pieces are driving the most mentions, which platforms generate the most brand discussion, and whether specific posts or events triggered mention spikes. Returns the full analysis to the calling op for embedding in the monthly synthesis.

## Triggers

Called internally by `aireadylife-brand-op-monthly-synthesis`. Not invoked directly by the user.

## Steps

1. Read all mention records from `~/Documents/aireadylife/vault/brand/00_current/` for the current period (default: prior 30 days)
2. Count mentions by sentiment (positive / neutral / negative) and calculate percentage distribution
3. Load prior month mention counts for sentiment trend comparison
4. Identify notable sources: check each author against the notable-threshold config (follower count > threshold OR source type = journalist/publication)
5. For each notable source mention: flag with author name, platform, follower count, sentiment, and content summary
6. Scan for unanswered mentions: status != "responded" AND sentiment = negative or neutral AND age <= response window threshold
7. For unanswered mentions beyond the response window: flag as "window closed — monitor for escalation"
8. Identify top mention-driving topics by matching mention content summaries to content piece titles in vault/brand/00_current/
9. Return: sentiment summary, notable source list, unanswered mention list, topic pattern summary

## Input

- `~/Documents/aireadylife/vault/brand/00_current/` — mention records; each should include: platform, author, author-handle, author-follower-count, date, sentiment, content-summary, link, responded-status
- `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/brand/config.md` — notable follower threshold, response window days

## Output Format

```
## Mention Analysis — {Period}

**Total Mentions:** {X} | Positive: {X}% | Neutral: {X}% | Negative: {X}%
**MoM Sentiment Trend:** {Positive ▲/▼ X%, Negative ▲/▼ X%}

### Notable Sources ({X})
| Author          | Platform  | Followers | Sentiment | Summary                   |
|-----------------|-----------|-----------|-----------|---------------------------|
| @{handle}       | Twitter/X | 45K       | Positive  | Referenced your [post]... |

### Unanswered — Response Window Open ({X})
| Author    | Platform  | Sentiment | Days Since | Content Summary          | Action         |
|-----------|-----------|-----------|------------|--------------------------|----------------|
| @{handle} | LinkedIn  | Neutral   | 3 days     | Asked about [topic]      | Reply to engage|

### Topic Patterns
- [Content piece / topic]: {X} mentions this period
- Platform generating most mentions: {platform}
```

## Configuration

Required in `~/Documents/aireadylife/vault/brand/config.md`:
- `mention_notable_follower_threshold` — follower count above which an author is flagged as notable (default: 10000)
- `mention_response_window_days` — days within which a negative/neutral mention should receive a response (default: 7)

## Error Handling

- If `03_mentions/` is empty: return "No mentions logged for this period. Use brand-task-log-mention to record brand mentions when you discover them."
- If a mention record is missing sentiment classification: include it in "unclassified" and note "X mentions need sentiment classification — update records."
- If prior month mention counts are not available: skip MoM trend calculation and note "No prior month data for trend comparison."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/brand/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/brand/00_current/`, `~/Documents/aireadylife/vault/brand/config.md`
- Writes to: returns data to calling op; no direct file writes
