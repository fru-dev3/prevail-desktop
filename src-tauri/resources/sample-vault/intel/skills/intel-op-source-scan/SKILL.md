---
name: aireadylife-intel-op-source-scan
type: op
cadence: weekly
description: >
  Weekly source health audit. Checks all configured sources for availability, quality,
  and relevance. Flags stale or low-quality sources and suggests replacements.
  Triggers: "source scan", "audit sources", "source health", "check my news sources".
---

## What It Does

Runs weekly (Sundays) to audit the full source list in `~/Documents/aireadylife/vault/intel/00_current/source-list.md`. The quality of the daily digest is entirely determined by the quality of its inputs — a source that has gone quiet, become paywalled, or drifted off-topic will silently degrade the intel output without any obvious signal. This weekly audit catches those issues before they become chronic.

Checks each source across four dimensions: availability (can the source URL still be reached and does it return valid content?), recency (when was the last new article published — sources with no new content in more than 14 days are flagged as dormant), signal-to-noise ratio (of the last 10 articles from this source, what percentage matched configured interest topics — a source where fewer than 30% of recent articles are relevant is considered low signal), and credibility tier consistency (does the source's actual content quality match its configured tier?).

Also performs a coverage gap analysis: for each configured interest topic, checks whether at least 2 active Tier 1 or Tier 2 sources are covering it. A topic with only Tier 3 coverage or no active coverage is a gap. Suggests specific replacement or addition sources by category: for AI/tech — Import AI newsletter, The Batch, Ars Technica, MIT Tech Review; for finance — Morning Brew, Axios Markets, The Economist, Bankrate; for geopolitics — Reuters World, FT, AP International.

Produces a source health report with a status per source and a coverage gap assessment. Writes the report to vault/intel/00_current/ and updates open-loops if any critical gaps are found (zero Tier 1 coverage on a configured priority topic).

## Triggers

- "source scan"
- "audit sources"
- "source health check"
- "check my news sources"
- "are my sources good"
- "weekly source review"

## Steps

1. Read `~/Documents/aireadylife/vault/intel/00_current/source-list.md`; load all source entries
2. For each source: read the last-activity date from the source record (updated when the daily briefing reads new articles from that source)
3. Flag sources with last-activity date >14 days as dormant; >7 days as slow; <7 days as active
4. For each active source: check the topic tag match rate against configured interest topics using recent article records; flag sources where fewer than 30% of recent articles matched any interest topic as "low signal"
5. For any source marked dormant or low-signal: compose a suggested replacement from the known-good source list for that topic category
6. Perform coverage gap analysis: for each configured interest topic, count how many Tier 1 and Tier 2 sources are actively covering it; flag topics with fewer than 2 Tier 1+2 sources as coverage gaps
7. Check for duplicate coverage: identify topic areas where more than 5 Tier 2-3 sources cover the same angle with no Tier 1 — this is over-sourced on opinion and under-sourced on facts
8. Compile source health report: per-source status table, coverage gap table, and replacement suggestions
9. Write report to vault/intel/00_current/{YYYY-MM-DD}-source-health.md
10. Call `aireadylife-intel-task-update-open-loops` if any priority topic has zero Tier 1 coverage

## Input

- `~/Documents/aireadylife/vault/intel/00_current/source-list.md` — source registry with last-activity dates
- `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/intel/config.md` — interest topics, priority topics

## Output Format

```
# Source Health Report — {YYYY-MM-DD}

## Source Status
| Source               | Tier | Last Activity | Signal Rate | Status   |
|----------------------|------|---------------|-------------|----------|
| Reuters              | 1    | Today         | 78%         | ✓ Active |
| Import AI            | 2    | 2 days ago    | 95%         | ✓ Active |
| [Blog name]          | 3    | 18 days ago   | 22%         | ⚠ Dormant/Low |

## Coverage Gap Analysis
| Topic          | Tier 1 Sources | Tier 2 Sources | Status           |
|----------------|----------------|----------------|------------------|
| AI             | 2              | 4              | ✓ Well covered   |
| Crypto         | 0              | 1              | ⚠ Gap — no Tier 1 |
| Personal finance| 1             | 3              | ✓ Covered         |

## Suggested Actions
🟡 Remove or replace: [Blog name] — dormant 18 days, 22% signal rate
  Suggested replacement: Ars Technica (Tech, Tier 2) at https://arstechnica.com/feed/
🟡 Add source for Crypto coverage: CoinDesk (Crypto, Tier 2) at https://coindesk.com/arc/outboundfeeds/rss/

## Summary
Active sources: {X} | Dormant: {Y} | Low signal: {Z} | Coverage gaps: {N}
```

## Configuration

Required in `~/Documents/aireadylife/vault/intel/config.md`:
- `topics_include` and `topics_priority` — for coverage gap analysis
- `source_scan_dormant_threshold_days` — days without activity before "dormant" flag (default: 14)
- `source_scan_signal_threshold_pct` — minimum relevance rate before "low signal" flag (default: 30%)

## Error Handling

- If source-list.md is empty: "No sources configured. Add sources using intel-task-log-source before running a source scan."
- If last-activity dates are missing from source records (e.g., new installation): treat all sources as "unknown activity" and prompt user to run a daily briefing first to populate activity dates.
- If a configured priority topic has zero active sources at any tier: flag as 🔴 "critical coverage gap" and suggest 3 specific sources.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/intel/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/intel/00_current/source-list.md`, `~/Documents/aireadylife/vault/intel/config.md`
- Writes to: `~/Documents/aireadylife/vault/intel/00_current/{YYYY-MM-DD}-source-health.md`, `~/Documents/aireadylife/vault/intel/open-loops.md`
