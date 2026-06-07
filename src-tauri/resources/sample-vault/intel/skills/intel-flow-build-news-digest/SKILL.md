---
name: aireadylife-intel-flow-build-news-digest
type: flow
trigger: called-by-op
description: >
  Pulls news from configured RSS feeds and sources, filters to priority topics, deduplicates, and
  formats as a scannable daily digest.
---

## What It Does

Ingests recent content from every source registered in `~/Documents/aireadylife/vault/intel/00_current/source-list.md`, applies topic and keyword filters to remove irrelevant items, deduplicates stories being covered by multiple outlets, and formats a ranked daily digest. The output is not a list of links — it is a curated, one-sentence-per-story briefing that is fully informative on its own.

Source registry: each source entry in source-list.md has a name, URL or RSS feed address, source type (RSS, newsletter, X/Twitter account, podcast, website), topic tags, and a credibility tier (1, 2, or 3). Tier 1 sources (Reuters, AP, FT, WSJ, Bloomberg, MIT Tech Review, The Economist) are treated as authoritative for facts and breaking news. Tier 2 sources (niche trade publications, established newsletters, think tank reports) provide depth. Tier 3 sources (blogs, aggregator accounts, YouTube commentary) are useful for trend signal only.

Filter logic: reads the topic list and include/exclude keyword lists from `vault/intel/config.md`. Include topics are applied as OR conditions — a story matching any configured interest topic passes. Exclude keywords are applied as AND-NOT conditions — any story containing an excluded keyword is removed regardless of topic. Hard exclusions (topics the user has explicitly configured as noise) take priority over any other signal.

Deduplication: for each cluster of stories that are clearly covering the same event (same event name, same company, same policy decision — regardless of different angles or publication timing), retains only the single highest-credibility source. This is what prevents the digest from being 60% Reuters/AP syndications with slightly different headlines.

Ranking: stories are ranked by a combined score: recency score (published within 2 hours = 10pts, 2-6 hours = 8pts, 6-12 hours = 6pts, 12-24 hours = 3pts, older = 0pts) plus source tier score (Tier 1 = 5pts, Tier 2 = 3pts, Tier 3 = 1pt) plus topic relevance score (configured top-priority topic match = 5pts, secondary topic = 3pts, general interest = 1pt). Total possible score: 20 points.

Formats the final digest: top 5-8 stories by score, each with headline (10-15 words), source name, and a single-sentence summary (25-35 words) that is informative without requiring a click. Items that score below a minimum threshold (configurable; default: 8/20) are excluded even if they fit the topic — quality over quantity.

## Triggers

Called internally by `aireadylife-intel-op-daily-briefing` and `aireadylife-intel-op-review-brief`. Not invoked directly by the user.

## Steps

1. Read source registry from `~/Documents/aireadylife/vault/intel/00_current/source-list.md`; load all active sources with their credibility tier and topic tags
2. Read topic include list and keyword exclude list from `~/Documents/aireadylife/vault/intel/config.md`
3. For each source: fetch or read the most recent articles/entries (within the past 24 hours); collect headline, summary, URL, publication time, source name
4. Apply topic filter: keep articles that match at least one configured include topic; remove articles containing exclude keywords
5. Cluster duplicate coverage: group articles reporting on the same event; retain the highest-tier source from each cluster
6. Score each remaining article: recency score + source tier score + topic relevance score
7. Filter out articles scoring below minimum threshold (default: 8/20)
8. Select top 5-8 articles by final score
9. For each selected article: compose a 25-35 word one-sentence summary that is informative without requiring click-through; include headline, source, and a 1-4 word "why it matters" tag
10. Return formatted digest to calling op

## Input

- `~/Documents/aireadylife/vault/intel/00_current/source-list.md` — source registry with credibility tiers and topic tags
- `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/intel/config.md` — include topics, exclude keywords, topic priorities, minimum score threshold
- Article data from configured sources (passed by the calling op or read from vault if pre-fetched)

## Output Format

```
## Daily Digest — {YYYY-MM-DD}

**Top Stories**

1. **[Headline]** | {Source} | {Time ago}
   {One-sentence summary, 25-35 words, fully informative on its own.} [Tag: AI Breakthrough]

2. **[Headline]** | {Source} | {Time ago}
   {One-sentence summary.} [Tag: Market-Moving]

3. **[Headline]** | {Source} | {Time ago}
   {One-sentence summary.} [Tag: Regulatory Risk]

[4-8 more stories in same format]

**Deduplication note:** {X} duplicate stories consolidated; {Y} stories excluded by filter
```

## Configuration

Required in `~/Documents/aireadylife/vault/intel/config.md`:
- `topics_include` — list of interest topics (e.g., ["AI", "personal finance", "career", "tech policy"])
- `topics_priority` — subset of include topics that receive higher relevance score (top-priority topics)
- `keywords_exclude` — list of keywords that exclude any article containing them
- `digest_min_score` — minimum score threshold (default: 8)
- `digest_story_count` — target number of stories (default: 5-8)

## Error Handling

- If source-list.md is empty or missing: "No sources configured. Add sources to vault/intel/00_current/source-list.md to enable digest generation."
- If fewer than 5 stories pass all filters: include all that pass and note "Only {X} stories met filter criteria today — consider broadening topic filters or adding more sources."
- If all fetched articles are older than 24 hours: include them with a note "No articles from the past 24 hours on configured topics — showing most recent available."
- If a source is unreachable: skip it and note in the digest footer "Source {name} unavailable today — check vault/intel/00_current/ for URL accuracy."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/intel/00_current/source-list.md`, `~/Documents/aireadylife/vault/intel/config.md`
- Writes to: called by ops that write to `~/Documents/aireadylife/vault/intel/02_briefs/`
