---
name: aireadylife-intel-op-review-brief
type: op
cadence: daily
description: >
  Daily morning intelligence brief. Scans configured sources, filters stories through
  the user's interest lens, and produces a top 5-8 story brief with summaries and flags.
  Triggers: "intel brief", "morning brief", "what's the news", "daily intel", "news summary".
---

## What It Does

Produces the daily morning intelligence brief — the version optimized for the user who wants the complete picture in a single, well-formatted document that integrates digest stories, thread updates, open priority flags, and the source health status. This op is functionally similar to the daily briefing op but adds the broader context layer: how does today's news fit into the ongoing tracked threads, and what open intelligence items are still unresolved from prior days?

Reads the day's digest by calling `aireadylife-intel-flow-build-news-digest`. Then reads all active thread files from vault/intel/00_current/ to produce a thread status section — a one-line per thread update showing what changed today and the overall thread status (developing, stable, closing). Reads vault/intel/open-loops.md for any priority stories still flagged as unread or requiring action from prior days. Reads vault/intel/00_current/ to check whether any sources have not produced new content in more than 7 days (stale source signal).

The resulting brief has three sections: today's top stories, ongoing thread updates, and outstanding flags. This gives the user both the news and the context — they know what is new today and where each ongoing story stands. Writes the brief to vault/intel/02_briefs/ and updates threads and open-loops.

## Triggers

- "intel brief"
- "morning brief"
- "what's the news"
- "daily intel"
- "news summary"
- "briefing"
- "catch me up on the news"

## Steps

1. Confirm vault/intel/ is set up with config.md and at least one active source
2. Call `aireadylife-intel-flow-build-news-digest` for today's filtered, ranked digest
3. Read all files in `~/Documents/aireadylife/vault/intel/00_current/`; identify active threads (not marked closed)
4. For each active thread: check if any stories in today's digest match the thread topic; prepare a one-line status update
5. For threads with no update today: confirm they are still active (check last-updated date); if last updated >7 days ago with no new developments, flag as potentially closing
6. Read vault/intel/open-loops.md for any 🔴 priority story flags that are unresolved (user has not read or acted on them yet)
7. Check source-list.md for any sources with last-activity date >7 days ago; note as potentially stale (will surface in next weekly source scan)
8. Write complete brief with all three sections to vault/intel/02_briefs/{YYYY-MM-DD}-morning.md
9. Call `aireadylife-intel-task-update-open-loops` if any new priority flags were generated
10. Present brief to user

## Input

- `~/Documents/aireadylife/vault/intel/config.md` — topics, sources, priorities
- `~/Documents/aireadylife/vault/intel/00_current/source-list.md` — source registry
- `~/Documents/aireadylife/vault/intel/00_current/` — active story threads
- `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/intel/open-loops.md` — outstanding priority flags
- `~/Documents/aireadylife/vault/intel/02_briefs/` — prior briefs for thread context

## Output Format

```
# Intelligence Brief — {YYYY-MM-DD}

## Today's Top Stories
[5-8 stories from build-news-digest, formatted as: Headline | Source | Time | 1-sentence summary | Tag]

## Ongoing Threads
| Thread              | Status     | Today's Update                              | Watch       |
|---------------------|------------|---------------------------------------------|-------------|
| AI EU Regulation    | Developing | Parliament released draft text this morning | Vote: May 15 |
| Fed Rate Policy     | Stable     | No new developments today                  | FOMC: Jun 12 |
| [Thread 3]          | Closing    | Final ruling expected this week             | —           |

## Outstanding Priority Flags
🔴 [Story from {date}] — [1-line summary] — Action: {read/share/decision needed}

## Source Health
{All active / X source(s) have not published in >7 days: [source names] — review in next source scan}

---
Brief generated: {timestamp} | Sources: {X} active | Thread count: {Y}
```

## Configuration

Same as intel-op-daily-briefing. No additional configuration required.

## Error Handling

- If vault/intel/ is not set up: "Intel vault not found. Purchase at frudev.gumroad.com/l/aireadylife-intel and set up at ~/Documents/aireadylife/vault/intel/."
- If in demo mode (vault-demo/intel/): use demo data; prefix all content with "[DEMO]."
- If config.md topics are empty: produce digest without topic filtering (all stories pass); warn "No topics configured — brief includes unfiltered content. Set topics_include in config.md."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/intel/config.md`, `~/Documents/aireadylife/vault/intel/00_current/`, `~/Documents/aireadylife/vault/intel/00_current/`, `~/Documents/aireadylife/vault/intel/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/intel/02_briefs/{YYYY-MM-DD}-morning.md`, `~/Documents/aireadylife/vault/intel/open-loops.md`
