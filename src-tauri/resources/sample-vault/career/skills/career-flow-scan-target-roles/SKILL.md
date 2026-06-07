---
name: aireadylife-career-flow-scan-target-roles
type: flow
trigger: called-by-op
description: >
  Searches LinkedIn Jobs, Glassdoor, and Levels.fyi for open roles matching your configured target criteria. Filters results by title match, comp floor, remote policy, and company tier. Extracts compensation ranges, required skills, and company details. Returns a ranked list of qualifying roles for pipeline logging and market health statistics for the brief.
---

## What It Does

Called by `aireadylife-career-op-market-scan` to execute the actual job board search. This flow handles the data collection layer — reading criteria, querying sources, filtering and ranking results, and returning structured data — while the op handles routing, brief writing, and pipeline logging.

**Reading search criteria:** Loads target role criteria from `vault/career/config.md`. This includes: target job titles (search with all configured variants), seniority level filter (e.g., "Senior", "Staff", "Principal", "Manager"), company tier preferences (FAANG / well-funded startup / Fortune 500 / remote-first), required tech stack keywords (used for secondary filter after initial results are collected), minimum compensation threshold (postings without stated comp are estimated from Levels.fyi and Glassdoor data for that company and role), and remote/hybrid requirement.

**Querying LinkedIn Jobs:** The primary search source. Searches LinkedIn Jobs with the title filter for each target role title, filtered by "Date posted: Past month" and the configured experience level. Limits to 50 results per title query to stay within responsible scraping limits. Extracts per listing: company, role title, location/remote flag, stated salary range (when provided — LinkedIn shows salary on a minority of postings), job description (for skills extraction), and date posted.

**Supplementing with Levels.fyi and Glassdoor:** Queries Levels.fyi jobs for the same role titles — this source has a higher proportion of listings with disclosed compensation, especially for tech roles. Queries Glassdoor Jobs for comp data where LinkedIn postings lack it. De-duplicates postings across sources by company+role+location key.

**Filtering and fit scoring:** For each collected posting, calculates a fit score (0-100). The score is a weighted sum of: title match (exact vs. variant, 30 points), tech stack match (what fraction of required stack appears in the job description, 30 points), comp alignment (stated or estimated comp vs. configured floor, 20 points), company tier match (20 points). Postings scoring below 70 are excluded from results.

**Skills extraction:** Aggregates all required and preferred skills mentioned across all qualifying postings. Produces a frequency count that feeds the skills gap review.

## Steps

1. Read target role criteria from `vault/career/config.md`.
2. For each configured target title: search LinkedIn Jobs with title, experience level, date posted (past 30 days), and location/remote filters. Collect up to 50 results per title.
3. For each LinkedIn result: extract company, role title, location, salary range (if stated), job description text, and posting date.
4. Query Levels.fyi jobs board with same titles — collect postings with disclosed compensation.
5. Query Glassdoor Jobs for same titles as supplemental source.
6. Merge all results, de-duplicate by (company + normalized_title + location) key.
7. For each unique posting: estimate compensation if not stated using Levels.fyi + Glassdoor benchmark for company and role.
8. Calculate fit score for each posting (title match + stack match + comp alignment + company tier match).
9. Filter to postings with fit score ≥ 70.
10. Extract all skills mentioned in qualifying job descriptions — aggregate frequency counts.
11. Sort qualifying postings by fit score descending.
12. Compute market statistics: posting count, P25/P50 of stated+estimated comp across qualifying postings.
13. Return: ranked qualifying postings, market statistics, skills frequency data — all to calling op.

## Input

- `~/Documents/aireadylife/vault/career/config.md` — target titles, level, company tier, tech stack, comp floor, remote policy
- LinkedIn Jobs (via Playwright, headless=False, with Chrome cookie session)
- Levels.fyi jobs board (public, no auth required)
- Glassdoor Jobs (via Playwright or public search pages)
- `vault/career/01_prior/` — prior period records for trend comparison

## Output Format

Structured results returned to calling op:

```
## Qualifying Postings (fit score ≥ 70)

[Company] — [Role Title] — [Location/Remote]
  Fit score: X/100
  Compensation: $X–$X (stated) / ~$X (estimated from market data)
  Tech stack match: X/Y required keywords found
  Date posted: [date]
  Source: LinkedIn / Levels.fyi / Glassdoor
  Posting URL: [url]

[repeat for each qualifying posting, sorted by fit score]

## Market Statistics
Total qualifying postings: X
Comp range P25: $X
Comp range P50: $X
Postings with disclosed comp: X (X%)

## Skills Frequency (from all qualifying postings)
[Skill 1]: X postings (X%)
[Skill 2]: X postings (X%)
[...top 15 by frequency]
```

## Configuration

Required in `vault/career/config.md`:
- `target_titles` — list of role titles to search
- `target_level` — seniority level for LinkedIn filter
- `target_company_tiers` — list of preferred company tiers
- `required_tech_stack` — list of required technologies
- `comp_floor` — minimum acceptable annual TC
- `remote_policy` — Remote / Hybrid / No preference
- `linkedin_chrome_profile` — path to Chrome profile with saved LinkedIn session

## Error Handling

- **LinkedIn session expired:** Note that LinkedIn search was skipped. Fall back to Levels.fyi and Glassdoor only. Prompt user to refresh LinkedIn session in Chrome.
- **Rate limiting triggered:** Stop collection after last successful batch, return partial results. Note count of results collected vs. expected.
- **No qualifying postings found:** Return empty list with market statistics showing search scope. Suggest broadening one or more criteria (e.g., drop company tier filter, lower comp floor by 10%).
- **All postings have no disclosed comp:** Market statistics comp range is estimated from benchmark data, not stated data — note this prominently.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/career/config.md`
- Writes to: None (returns all data to calling op for processing)
