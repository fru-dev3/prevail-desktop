---
name: aireadylife-intel-task-log-source
type: task
cadence: as-added
description: >
  Adds a new news source to vault/intel/00_current/ with name, URL/feed, type, topic tags,
  and credibility rating. Used to expand the intel source list.
---

## What It Does

Registers a new source in the intel source registry so it is included in future digest builds, topic deep dives, and weekly source scans. The quality of the intel domain's output is a direct function of the quality and relevance of its sources — adding a new Tier 1 source on a priority topic immediately improves daily brief quality, while adding a low-quality source degrades it. This task structures source addition carefully to prevent registry quality degradation.

Each source record in `vault/intel/00_current/source-list.md` captures: name (display name for attribution in briefs), URL (primary website URL), RSS feed URL (if available — RSS is preferred because it enables automated content fetching without Playwright), source type (RSS feed / newsletter / X/Twitter account / podcast / website / API), topic tags (list of covered topics that map to the user's configured interest topics — used for relevance scoring), credibility tier (1-3 based on the tier definitions: Tier 1 = major institutional news organizations, Tier 2 = strong niche credibility, Tier 3 = blogs and commentary), and status (active / paused / removed).

The credibility tier should be assigned honestly. Assigning Tier 1 to a source that is actually Tier 2 or 3 over-weights its stories in the digest ranking, which can surface lower-quality coverage above more credible but lower-rated sources. When in doubt about the tier, use the following heuristics: Tier 1 = organizations with editorial independence, named journalists with track records, primary sourcing (they break stories); Tier 2 = known for depth and accuracy on their specific topic, cited by Tier 1 sources, named authors; Tier 3 = aggregators, anonymous or pseudonymous, primarily opinionated commentary without original reporting.

Also validates that the RSS feed or URL is reachable before writing the record, to avoid adding dead sources to the registry. The source-list.md file is a simple structured text file, not a database — each source is a block with consistent field names.

## Triggers

- "add source"
- "add a news source"
- "I want to follow [publication/account]"
- "add [source] to my intel sources"
- Called when the weekly source scan recommends a replacement source

## Steps

1. Collect source details from the user or calling op: name, URL, source type, topic coverage, proposed credibility tier
2. Validate the proposed credibility tier: ask "On what basis is this Tier {X}?" if the classification seems inconsistent with the tier definition; help the user assign accurately
3. Check if the source has an RSS feed (for RSS-type sources: check for {URL}/feed/, {URL}/rss/, or a link rel="alternate" RSS tag); if found, record the RSS feed URL separately
4. Check vault/intel/00_current/source-list.md for a duplicate entry (same name or same primary URL); if found, offer to update the existing entry instead
5. Write the new source entry to source-list.md in the standard block format
6. Set last-activity to "new — not yet scanned" and status to "active"
7. Return confirmation with the source name and tier assignment; note it will appear in the next daily briefing cycle

## Input

User-provided:
- Source name (required) — e.g., "Reuters", "Import AI", "Morning Brew"
- Source URL (required) — primary website URL
- Source type (required) — RSS, newsletter, X account, podcast, website
- Topic tags (required) — which of the user's configured interest topics this source covers
- Credibility tier (required) — 1, 2, or 3 (with honest assessment)
- RSS feed URL (optional but preferred) — if known or found during validation

## Output Format

Entry added to `~/Documents/aireadylife/vault/intel/00_current/source-list.md`:
```
---
name: {Source Name}
url: {https://example.com}
rss_feed: {https://example.com/feed/ or "none"}
source_type: {RSS / newsletter / twitter / podcast / website}
topic_tags: [{tag1}, {tag2}, {tag3}]
credibility_tier: {1 / 2 / 3}
status: active
last_activity: new — not yet scanned
date_added: {YYYY-MM-DD}
notes: {optional notes on why this source was added}
---
```

## Configuration

Required in `~/Documents/aireadylife/vault/intel/config.md`:
- `topics_include` — for validating that new source tags map to configured interest topics
- `source_list_path` — path to source-list.md (default: vault/intel/00_current/source-list.md)

## Error Handling

- If the URL is not reachable: "The URL {URL} returned an error. Verify the URL is correct before adding. Add with status: 'unverified' if you want to include it anyway."
- If topic tags don't match any configured interest topic: "The topic tag '{tag}' is not in your configured interest topics. Add it to config.md topics_include first, or choose a matching existing topic."
- If a source at this URL already exists in the registry: "Source already registered as '{existing name}' (Tier {X}). Update the existing entry?"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/intel/00_current/source-list.md`, `~/Documents/aireadylife/vault/intel/config.md`
- Writes to: `~/Documents/aireadylife/vault/intel/00_current/source-list.md`
