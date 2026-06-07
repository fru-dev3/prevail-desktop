---
name: aireadylife-intel-flow-build-topic-summary
type: flow
trigger: called-by-op
description: >
  Aggregates recent coverage on a specific topic into a structured summary: current state, key
  players, recent developments, and open questions.
---

## What It Does

Gathers all relevant recent coverage on the requested topic from the vault's source registry and any articles in the vault's existing topic files, then synthesizes it into a structured intelligence brief. This flow is the research engine behind the topic deep-dive op — it does the analytical work of turning a collection of articles and sources into a coherent, organized summary that a decision-maker can act from.

The brief follows a fixed structure that covers all the dimensions needed to understand a developing story: background (what is the history and context of this issue), current state (where things stand as of the latest credible reporting), key players (who are the individuals, organizations, governments, or companies driving the story and what is each one's position or interest), recent developments (the 3-5 most significant events or statements in chronological order from the past 30 days), expert and source divergence (where do credible sources agree and where do they disagree — this is often where the most important insight lives), and open questions and signals to watch (what are the known unknowns, and what specific future events or disclosures would change the picture).

Distinguishes between factual reporting (Reuters wire, regulatory filings, official statements) and opinion or analysis (editorials, think tank papers, commentary). The brief clearly labels which sections are fact-based and which are analytical. When sources directly contradict each other on factual claims, notes the contradiction rather than silently choosing one version — letting the user assess credibility themselves.

Returns the formatted multi-paragraph topic brief to the calling op. The calling op writes it to vault/intel/00_current/ if it is tracking an ongoing story, or vault/intel/02_briefs/ if it is a one-time deep dive.

## Triggers

Called internally by `aireadylife-intel-op-topic-deep-dive`. Not invoked directly by the user.

## Steps

1. Receive the topic name and any specific focus angle from the calling op
2. Search `~/Documents/aireadylife/vault/intel/` for all existing content covering this topic: existing thread files in 02_threads/, prior briefs mentioning this topic in 01_briefs/, and any saved articles in the source data
3. Read all relevant files; sort by date to establish chronological order
4. Identify key players mentioned across sources: name each individual or organization, their role, and their stated position or interest in the topic
5. Extract the 3-5 most significant recent developments (past 30 days); sort chronologically
6. Identify where sources agree (consensus facts) and where they diverge (disputed claims or interpretations)
7. Formulate the 3-5 most important open questions — things that are not yet known but would significantly change the picture if answered
8. Identify 2-3 specific signals to monitor (upcoming events, expected disclosures, scheduled decisions) that will advance the story
9. Synthesize into the structured brief format (Background → Current State → Key Players → Recent Developments → Source Divergence → Open Questions → What to Watch)
10. Return formatted brief to calling op

## Input

- Topic name and optional focus angle (from calling op)
- `~/Documents/aireadylife/vault/intel/00_current/` — existing thread files on related topics
- `~/Documents/aireadylife/vault/intel/02_briefs/` — prior briefs for context and history
- `~/Documents/aireadylife/vault/intel/00_current/source-list.md` — source registry for credibility reference
- `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/intel/config.md` — topic priorities for relevance weighting

## Output Format

```
## Topic Brief: {Topic Name}
Compiled: {YYYY-MM-DD} | Coverage: {date range of sources used}

### Background
[2-3 sentences of context: what this issue is, why it matters, how it developed to this point]

### Current State (as of {date})
[2-3 sentences on where things stand right now, based on most recent credible reporting]

### Key Players
| Player           | Role / Organization         | Position / Interest                      |
|------------------|-----------------------------|------------------------------------------|
| [Name]           | [Role]                      | [Their stated position and interest]     |

### Recent Developments (chronological, past 30 days)
1. {Date}: {Development} — Source: {Source name}
2. {Date}: {Development} — Source: {Source name}
[3-5 entries]

### Source Agreement vs Divergence
- **Consensus:** {What credible sources agree on}
- **Disputed:** {Where sources diverge and why — do not resolve, report the disagreement}

### Open Questions
1. {Question that would significantly change the picture if answered}
2. {Question}
3. {Question}

### What to Watch
- {Specific upcoming event, expected date, why it matters}
- {Specific disclosure or decision to watch}
```

## Configuration

Required in `~/Documents/aireadylife/vault/intel/config.md`:
- `topics_include` — for relevance weighting when determining which sources to prioritize
- `source_list` — credibility tiers used for fact vs opinion labeling

## Error Handling

- If no vault content exists on the topic and no source data is available: "No existing coverage found on '{topic}' in the vault. To research this topic, ensure relevant sources are in your source registry and have been scanned recently. I can provide a general overview from training data with the caveat that it may not reflect the most recent developments."
- If only Tier 3 sources cover the topic: note "Coverage of this topic comes primarily from Tier 3 sources — treat as trend signal rather than confirmed reporting. Seek Tier 1 or Tier 2 sources for verification."
- If topic is too broad: ask "This topic is broad — can you narrow it? For example: [AI regulation] could focus on EU AI Act, US executive orders, or China's AI policy framework."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/intel/00_current/`, `~/Documents/aireadylife/vault/intel/02_briefs/`, `~/Documents/aireadylife/vault/intel/00_current/`, `~/Documents/aireadylife/vault/intel/config.md`
- Writes to: called by ops that write to `~/Documents/aireadylife/vault/intel/00_current/` or `01_briefs/`
