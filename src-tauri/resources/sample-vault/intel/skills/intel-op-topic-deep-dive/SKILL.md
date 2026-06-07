---
name: aireadylife-intel-op-topic-deep-dive
type: op
cadence: on-demand
description: >
  On-demand deep dive on a specific topic that pulls recent coverage, identifies key voices, and
  summarizes the state of play. Triggers: "deep dive", "tell me about", "topic research",
  "what's happening with".
---

## What It Does

Produces a structured intelligence brief on a single topic the user wants to understand deeply. Unlike the morning brief which covers 5-8 topics at one sentence each, the topic deep dive covers one topic at paragraph depth. This is for when the user has encountered a story in the morning brief and wants to go deeper, or when they need background on a topic before a meeting, investment decision, or content creation session.

Calls `aireadylife-intel-flow-build-topic-summary` to do the analytical synthesis work. The deep dive op adds the user-facing experience layer: clarifying the topic scope if it is ambiguous, asking whether to track this as an ongoing thread in the vault, and providing the formatted output with clear sections.

After presenting the topic brief, asks whether to: (1) save the brief to vault/intel/02_briefs/ as a one-time reference, (2) create a new thread in vault/intel/00_current/ to track this topic across future daily briefings, or (3) both. If the user creates a thread, writes a thread file with today's brief as the opening entry and a thread status of "developing." Future daily briefings will then append updates to this thread automatically.

Also checks vault/intel/config.md to see whether this topic should be added to the active interest topics list. If the topic is not currently configured as an include topic, asks if the user wants to add it — this would cause the daily digest to include stories on this topic going forward.

## Triggers

- "deep dive on [topic]"
- "tell me about [topic]"
- "what's happening with [topic]"
- "topic research"
- "give me background on [topic]"
- "what do I need to know about [topic]"
- "explain [topic] to me"

## Steps

1. Identify the topic from the user's request; if ambiguous, ask a clarifying question ("You mentioned AI regulation — do you want to focus on the EU AI Act, US executive orders, or China's AI governance framework?")
2. Check `~/Documents/aireadylife/vault/intel/00_current/` for an existing thread on this topic; if found, offer to update the existing thread rather than creating a new brief
3. Call `aireadylife-intel-flow-build-topic-summary` with the topic name and any focus angle specified
4. Present the formatted topic brief to the user
5. After presenting the brief: ask "Would you like to track this as an ongoing thread in your intel vault? I'll update it in each morning briefing when new developments appear."
6. If user says yes to thread tracking: write thread file to vault/intel/00_current/{topic-slug}.md with today's brief as the opening entry and status: developing
7. Ask if this topic should be added to active interest topics in config.md (if it is not already configured)
8. Call `aireadylife-intel-task-update-open-loops` if any priority story or watch signal emerged from the deep dive

## Input

- Topic name and optional focus angle from user
- `~/Documents/aireadylife/vault/intel/00_current/` — for existing thread check
- `~/Documents/aireadylife/vault/intel/02_briefs/` — for prior coverage context
- `~/Documents/aireadylife/vault/intel/00_current/` — source registry for credibility reference
- `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/intel/config.md` — current active topics

## Output Format

```
# Topic Brief: {Topic Name}
Deep dive | {YYYY-MM-DD}

## Background
[2-3 sentences of context]

## Current State
[2-3 sentences on where things stand as of the most recent credible reporting]

## Key Players
[Table: name, role, position]

## Recent Developments (past 30 days)
1. {Date}: {Development} — {Source}
2. {Date}: {Development} — {Source}
[3-5 items]

## Where Sources Agree vs Disagree
- Consensus: [facts all credible sources confirm]
- Disputed: [where credible sources differ]

## Open Questions
1. [Question that would change the picture]
2. [Question]
3. [Question]

## What to Watch
- {Event/date/signal}
- {Event/date/signal}

---
Sources: {X} articles reviewed | Credibility: {Tier 1/2/3 breakdown}

Track this topic? Reply "track it" to create an ongoing thread.
```

## Configuration

Required in `~/Documents/aireadylife/vault/intel/config.md`:
- `topics_include` — to check if the researched topic is already configured
- Source registry for credibility assessment

## Error Handling

- If insufficient vault content exists on the requested topic: note "Limited vault coverage found — the brief draws primarily from training knowledge. Accuracy is best for topics with events before August 2025. For recent developments, ensure relevant sources are in your source registry."
- If the topic is very broad: offer to narrow it before proceeding; suggest 2-3 more specific angles.
- If an existing thread is found: "You already have an open thread on this topic from {date}. View or update it at vault/intel/00_current/{topic-slug}.md?"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/intel/00_current/`, `~/Documents/aireadylife/vault/intel/02_briefs/`, `~/Documents/aireadylife/vault/intel/00_current/`, `~/Documents/aireadylife/vault/intel/config.md`
- Writes to: `~/Documents/aireadylife/vault/intel/00_current/{topic-slug}.md` (if thread created), `~/Documents/aireadylife/vault/intel/02_briefs/{YYYY-MM-DD}-{topic-slug}-deep-dive.md` (if saved as brief)
