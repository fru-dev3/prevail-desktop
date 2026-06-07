---
name: aireadylife-intel-task-flag-priority-story
type: task
description: >
  Writes a flag to vault/intel/open-loops.md when a story on a configured priority topic appears
  from a high-credibility source, with headline, source, summary, why it matters, and action needed.
---

## What It Does

Fires when a story meets the priority flag criteria during the digest build or daily briefing process. The flag captures the full context needed to decide what to do with the story immediately, without having to re-read the digest or search for the source.

Priority flag criteria: the story must satisfy at least one of the following — (A) it originates from a Tier 1 source (Reuters, AP, FT, WSJ, Bloomberg, Economist, MIT Tech Review) and covers a configured top-priority topic; (B) it represents a genuinely significant development on any configured topic (first official reporting on a new policy, significant market move, product launch with direct implications, official government action); (C) it has explicit and immediate action implications for the user based on their configured context (a Fed rate change when the user has variable-rate debt, a platform policy change affecting their business, a tax law change relevant to their situation).

The flag captures: headline, source name and credibility tier, publication date and time, a 2-3 sentence summary of the specific development (what happened, who is involved, what changed), an explanation of why this particular story matters (new development, contradicts prior understanding, significant source weight, time-sensitive action trigger), and a suggested action (read in full, share on LinkedIn/newsletter, route to wealth/tax/career agent, take a specific real-world action, or monitor for follow-up).

Before writing, checks vault/intel/open-loops.md for an existing unresolved flag for the same story (same headline or same source + date). Priority story flags are not deduplicated by topic alone — two significant stories on the same topic are two separate flags. Flags are resolved once the user has acted on them (read, shared, or made the relevant decision).

## Triggers

Called internally by `aireadylife-intel-op-daily-briefing` and `aireadylife-intel-op-review-brief` when a priority story is detected.

## Steps

1. Receive story data from calling op: headline, source name, tier, publication date, article summary, priority trigger reason (which criterion A/B/C was met)
2. Compose the "why it matters" explanation: 1-2 sentences specific to this story's significance, not generic
3. Determine the suggested action: based on the priority trigger reason and the user's configured context in config.md, assign the most appropriate action (read/share/route/act/monitor)
4. For routing suggestions: specify which agent to route to and why (e.g., "Route to Wealth Agent — Fed rate cut affects savings rate and variable debt")
5. Check vault/intel/open-loops.md for existing flag for same story (same headline); if found, skip write and return "already flagged"
6. Write flag entry to vault/intel/open-loops.md with all fields
7. Return confirmation to calling op

## Input

- Story data from calling op (headline, source, tier, date, summary)
- `~/Documents/aireadylife/vault/intel/config.md` — user context, priority topics, routing rules
- `~/Documents/aireadylife/vault/intel/open-loops.md` — for duplicate check

## Output Format

Flag written to `~/Documents/aireadylife/vault/intel/open-loops.md`:
```
🔴 PRIORITY STORY — {Source} | Tier {1/2} | {YYYY-MM-DD HH:MM}
Headline: "{Exact headline}"
Summary: {2-3 sentences: what happened, who is involved, what changed}
Why it matters: {1-2 sentences specific to this story's significance}
Priority trigger: {Criterion A/B/C — description}
Suggested action: {Read in full / Share on [platform] / Route to [agent] / Act: [specific action] / Monitor}
Source URL: {URL}
Source: intel-op-daily-briefing | Raised: {YYYY-MM-DD}
```

## Configuration

Required in `~/Documents/aireadylife/vault/intel/config.md`:
- `topics_priority` — top-priority topics that trigger Criterion A flags
- `user_context` — brief description of the user's situation for Criterion C relevance assessment (e.g., "has variable rate mortgage, owns LLC, content creator")
- `routing_rules` — which story types route to which agents (wealth, tax, career, content)

## Error Handling

- If story data is incomplete (missing source tier or publication date): still write the flag with "tier unknown" or "date unknown" and note the incomplete data.
- If vault/intel/open-loops.md does not exist: create it before writing.
- If the "why it matters" cannot be determined from the available data: write "Why it matters: Investigate — context unclear. Read the full article."
- If priority trigger criterion cannot be determined: default to Criterion B (significant development) and flag the classification uncertainty.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/intel/config.md`, `~/Documents/aireadylife/vault/intel/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/intel/open-loops.md`
