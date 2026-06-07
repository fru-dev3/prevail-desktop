---
name: aireadylife-career-op-market-scan
type: op
cadence: monthly
description: >
  Monthly job market scan searching for open roles matching your target criteria: role titles, company tier, tech stack, compensation minimums, and remote policy. Summarizes market health, identifies standout opportunities, logs qualifying roles to the watch pipeline, and tracks market signal trends over time. Triggers: "market scan", "what jobs are out there", "check the job market", "job search", "what's hiring", "open roles for my level".
---

## What It Does

Runs monthly to ensure you always have a current read on the external market for your target roles — whether or not you are actively searching. An always-current market picture gives you leverage at performance review time, grounds compensation negotiations in real data, and means you can move quickly when a strong opportunity appears rather than starting cold.

The scan reads your target criteria from `vault/career/config.md` — role titles you are targeting (typically 2-4 variants, e.g., "Senior Software Engineer", "Staff Engineer", "Engineering Manager"), company tier preferences, required tech stack keywords, minimum compensation threshold, and remote/hybrid requirements. It searches LinkedIn Jobs as the primary source (most complete coverage of posted roles, especially for tech), with Glassdoor Jobs and Levels.fyi job board as supplemental sources for salary data and compensation benchmarking.

The output summarizes four key market health signals: volume (how many relevant postings exist this month vs. prior month), compensation range (what P25/P50 of stated or estimated compensation looks like for your target roles right now), skills demand (which technical and domain skills appear most frequently in target role postings — this feeds directly into the skills gap review), and company activity (which companies are hiring aggressively vs. slowing down based on headcount data and posting volume trends). These signals together paint a picture of whether it is a buyer's market or seller's market for your profile right now.

Roles that match at least 70% of your target criteria and meet the compensation minimum are logged to `vault/career/00_current/` as "watch" stage items with a fit score. The pipeline review op will pick these up monthly and prompt decisions on whether to advance any to application. Roles that match 100% of criteria and come from a target company tier are flagged specifically as high-priority watches.

The scan also monitors company-specific signals: if a company on your target list posts a surge of roles, or if a company previously on your list announces a hiring freeze or layoffs, these signals are noted in the brief with recommended action adjustments.

## Triggers

- "market scan"
- "what jobs are out there for me"
- "check the job market for my role"
- "job search update"
- "what's hiring in my field"
- "open roles this month"
- "how's the market for [role]"
- "are companies hiring"

## Steps

1. Read target role criteria from `vault/career/config.md` — extract target titles, levels, company tiers, tech stack requirements, comp minimum, remote policy, and excluded companies.
2. Search LinkedIn Jobs for each configured target role title filtered by experience level, location/remote, and date posted (last 30 days).
3. For each result set, filter to roles meeting at least 70% of configured criteria.
4. Extract from each qualifying posting: company name, role title, exact level (if stated), location/remote policy, compensation range (stated or estimated from Glassdoor/Levels.fyi data), required skills list, and date posted.
5. Calculate a fit score for each qualifying posting (0-100) based on percentage of criteria matched.
6. Search Levels.fyi job board for the same role titles to capture compensation-reported postings.
7. Aggregate compensation data across all qualifying postings to compute market P25 and P50 for this month's scan.
8. Aggregate required skills across all qualifying postings to compute skills frequency ranking (top 10 skills by mention count).
9. Compare posting volume and comp data to prior month's scan in `vault/career/00_current/` — flag significant changes (>20% volume shift, >10% comp shift).
10. Log all roles with fit score ≥ 70 to `vault/career/00_current/` as "watch" stage items with extracted data and fit score.
11. Flag roles with fit score ≥ 90 or from named target companies as high-priority watch items.
12. Write market scan brief to `vault/career/02_briefs/YYYY-MM-market-scan.md` with summary statistics, notable openings, and market health signals.
13. Call `aireadylife-career-task-update-open-loops` with any high-priority watch items and market alerts.

## Input

- `~/Documents/aireadylife/vault/career/config.md` — target criteria, company preferences, comp floor
- `~/Documents/aireadylife/vault/career/00_current/` — prior month scan data for trend comparison
- `~/Documents/aireadylife/vault/career/01_prior/` — prior period records for trend comparison
- Live data from LinkedIn Jobs, Glassdoor Jobs, Levels.fyi (via configured app integrations)

## Output Format

**Market Scan Brief** — saved as `vault/career/02_briefs/YYYY-MM-market-scan.md`

```
## Market Health — [Month Year]
Qualifying postings found: X (vs. X prior month, +/-X%)
Compensation range (P25-P50): $X–$X
Top skills in demand: [skill 1], [skill 2], [skill 3], [skill 4], [skill 5]

## High-Priority Watches (fit score ≥ 90)
- [Company] — [Role Title] — $X–$X — Remote/Hybrid/Onsite — Posted [date]

## Watch List Added (fit score 70-89)
- [Company] — [Role Title] — [fit score] — Posted [date]

## Market Signals
- [Notable trend or company hiring/freeze signal]

## Skills Demand Ranking (frequency across all qualifying postings)
1. [Skill] — mentioned in X% of postings
2. ...
```

## Configuration

Required fields in `vault/career/config.md`:
- `target_titles` — list of 2-4 target role titles
- `target_level` — experience level equivalent
- `target_company_tiers` — list: FAANG, Series B+, Fortune 500, mid-market
- `target_tech_stack` — list of required technologies
- `comp_floor` — minimum acceptable total comp
- `remote_policy` — Remote / Hybrid / No preference
- `excluded_companies` — companies to skip (prior employers, cultural mismatches)

## Error Handling

- **LinkedIn rate limiting:** If LinkedIn rate-limits the search, log whatever was captured and note in the brief that results may be incomplete. Schedule a retry manually.
- **No qualifying postings found:** Report zero matches and flag this as a potential market signal (demand may be low for configured criteria). Suggest broadening criteria by one tier.
- **Comp data unavailable for postings:** Mark compensation as "Not Disclosed" and use Glassdoor/Levels.fyi market benchmark as proxy in the brief.
- **Config missing target criteria:** Prompt user to complete `config.md` before proceeding; a scan without criteria will return unfiltered noise.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/career/config.md`, `~/Documents/aireadylife/vault/career/00_current/`
- Writes to: `~/Documents/aireadylife/vault/career/02_briefs/`, `~/Documents/aireadylife/vault/career/00_current/`, `~/Documents/aireadylife/vault/career/00_current/YYYY-MM-scan.md`, `~/Documents/aireadylife/vault/career/open-loops.md`
