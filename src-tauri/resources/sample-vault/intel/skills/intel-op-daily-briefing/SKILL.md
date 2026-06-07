---
name: aireadylife-intel-op-daily-briefing
type: op
cadence: daily
description: >
  Generates a daily news digest filtered to configured priority topics and sources. Triggers:
  "daily briefing", "news briefing", "what's happening today", "morning news".
---

## What It Does

Produces the morning intelligence brief filtered to the user's configured interest lens. This is the core daily deliverable of the intel plugin — a 5-8 story digest that the user reads in under 3 minutes to know what happened overnight and this morning that matters to them.

Calls `aireadylife-intel-flow-build-news-digest` to ingest, filter, deduplicate, and rank stories from all configured sources. The digest flow handles the heavy lifting of source quality scoring and relevance filtering; this op handles the additional intelligence layers: story thread updates, priority story flagging, and Ben routing.

Updates active story threads in `vault/intel/00_current/`: for each story in the digest that matches an existing tracked thread, appends a dated update entry to that thread file. This is what maintains context continuity across multi-day stories — the AI regulation story that has been developing for 2 weeks has all its daily updates in one thread file, so the user can review the full arc at any point.

Calls `aireadylife-intel-task-flag-priority-story` for any digest story that: originates from a Tier 1 source on a configured top-priority topic, represents a significant development (first reporting, official government action, major market move), or has explicit action implications for the user (a personal finance rate change, a tech platform policy affecting the user's work).

Routes market-moving stories (Federal Reserve actions, significant earnings releases, major market moves) to Wealth Agent via vault routing. Routes tech policy and AI regulation stories to Content Agent as potential content opportunities. Routes career-relevant stories to Career Agent.

## Triggers

- "daily briefing"
- "morning brief"
- "morning news"
- "what's happening today"
- "news briefing"
- "intel update"
- "what's going on"

## Steps

1. Confirm vault/intel/ is set up and config.md has at least 3 configured sources and at least 1 configured topic
2. Call `aireadylife-intel-flow-build-news-digest` for the filtered, ranked, deduplicated daily digest
3. Read `~/Documents/aireadylife/vault/intel/00_current/` to get list of all active tracked threads
4. For each story in the digest: check if it matches an active thread (same topic, same key entities); if yes, append a dated update to that thread file
5. For each story that meets priority flagging criteria (Tier 1 source + top-priority topic, OR explicit action implication): call `aireadylife-intel-task-flag-priority-story`
6. Identify any market-moving stories (interest rates, market indices, major policy action); route summary to Wealth Agent via vault/intel/routing/ note
7. Identify any AI/tech platform stories relevant to content opportunities; route to Content Agent
8. Call `aireadylife-intel-task-update-open-loops` with any new priority story flags
9. Write the complete morning brief to `vault/intel/02_briefs/{YYYY-MM-DD}-morning.md`
10. Present the formatted brief to the user

## Input

- `~/Documents/aireadylife/vault/intel/00_current/source-list.md` — source registry
- `~/Documents/aireadylife/vault/intel/config.md` — topics, keywords, source priorities
- `~/Documents/aireadylife/vault/intel/00_current/` — active story threads for update
- `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records for trend comparison
- Recent article data from configured sources

## Output Format

```
# Morning Brief — {YYYY-MM-DD}

## Top Stories

**1. [Headline]** | Reuters | 3 hours ago [PRIORITY]
{One-sentence summary, informative on its own.} Why it matters: {1-4 word tag}

**2. [Headline]** | MIT Technology Review | 5 hours ago
{One-sentence summary.} Why it matters: AI Breakthrough

**3. [Headline]** | Financial Times | 7 hours ago
{One-sentence summary.} Why it matters: Market-Moving → routed to Wealth Agent

[4-8 more stories]

## Thread Updates
- **[Thread: AI Regulation]** — New: {1-sentence update from today's coverage}
- **[Thread: Fed Policy]** — New: {1-sentence update}

## Priority Flags
🔴 [Story flagged for immediate read/action] — see open-loops.md

---
Sources scanned: {X} | Stories filtered: {Y} | Duplicates removed: {Z} | Stories in brief: {X}
```

## Configuration

Required in `~/Documents/aireadylife/vault/intel/config.md`:
- `topics_include` — interest topics (minimum 1)
- `topics_priority` — top-priority topics for flag triggering
- `keywords_exclude` — noise exclusion list
- `sources` — at least 3 active sources
- `routing_wealth_trigger_keywords` — keywords that trigger Wealth Agent routing (e.g., ["Fed", "interest rate", "inflation", "market"])

## Error Handling

- If source registry is empty: "No sources configured. Add at least one source to vault/intel/00_current/source-list.md and run the source scan to validate it."
- If fewer than 5 stories pass filtering: include all that pass; suggest broadening topic filters if the problem persists.
- If config.md is missing or incomplete: "Intel vault not fully configured. Open vault/intel/config.md and complete the topics, keywords, and source settings."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/intel/00_current/`, `~/Documents/aireadylife/vault/intel/config.md`, `~/Documents/aireadylife/vault/intel/00_current/`
- Writes to: `~/Documents/aireadylife/vault/intel/02_briefs/{YYYY-MM-DD}-morning.md`, `~/Documents/aireadylife/vault/intel/00_current/` (thread updates), `~/Documents/aireadylife/vault/intel/open-loops.md`
