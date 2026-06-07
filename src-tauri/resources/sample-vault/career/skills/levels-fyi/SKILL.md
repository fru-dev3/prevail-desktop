---
name: levels-fyi
type: app
description: >
  Scrapes compensation data by company, role, and level from Levels.fyi — the most accurate source for tech compensation benchmarking. Provides P25/P50/P75/P90 breakdowns for total comp, base, bonus, and equity separately. Also provides level ladder comparisons and job postings with reported compensation. No authentication required. Configure target role, companies, and location in vault/career/config.md.
---

# Levels.fyi

**Auth:** None (public web scrape)
**URL:** https://www.levels.fyi
**Configuration:** Set target role and companies in `vault/career/config.md`

## What It Provides

Levels.fyi is the gold-standard compensation data source for tech roles. Unlike Glassdoor (which relies on anonymous self-reported salary without level verification) or LinkedIn Salary (which aggregates broadly), Levels.fyi captures compensation with role-level granularity — the difference between an L5 and L6 Software Engineer at a company can be $100K+ in TC, and Levels.fyi captures this correctly. Data is self-reported by verified employees, making it far more accurate than job posting estimates.

## Data Available

- Total compensation by company, role, and specific level — with P25, P50, P75, P90 breakdowns
- TC component breakdown: base salary, annual bonus, and RSU equity separately at each percentile
- Job postings on the Levels.fyi board with reported compensation ranges (many postings include base + equity breakdowns)
- Company-specific level ladders (e.g., IC3/IC4/IC5/IC6/IC7 at Meta; L3/L4/L5/L6/L7 at Google; SDE1/SDE2/SDE3 at Amazon; SDI/SDII/Senior/Staff/Principal at Snowflake)
- Year-over-year comp trend by role and company (shows whether comp has been growing or contracting)
- Location-adjusted comp comparisons (SF, NYC, Seattle, Remote, etc.)
- Competing offers data (what offers people received before accepting their current role)

## Configuration

Add to `vault/career/config.md`:
```yaml
levels_target_role: "Senior Software Engineer"
levels_target_level: "IC4"  # or L5, SDE2, etc. as appropriate for the company
levels_target_companies:
  - "Snowflake"
  - "Databricks"
  - "Google"
  - "Meta"
  - "Amazon"
levels_location: "Remote"  # or city name
```

## Key URLs for Direct Access

```
https://www.levels.fyi/t/software-engineer?company=Snowflake
https://www.levels.fyi/t/software-engineer?company=Google&level=L5
https://www.levels.fyi/comp.html  # main comp table
https://www.levels.fyi/jobs  # job board with reported comp
```

## How to Interpret the Data

- **P50:** The market median — what half the people at this role/level/company are earning. This is your primary benchmark.
- **P75:** The 75th percentile — what strong performers or people with competing offers earn. Your negotiation target.
- **Equity component:** Levels.fyi reports equity as annualized RSU value at current stock price. This fluctuates with stock price — compare at the same point in time as your own equity calculation.
- **Level matching:** Your internal level may not map directly to Levels.fyi's company-specific level names. Use years of experience and scope of work to find the closest equivalent.

## Technical Notes

- No login required — public data is accessible via scraping
- Rate limiting: add delays between requests (2-3 seconds per page) to avoid being blocked
- Data is crowd-sourced and updated continuously — check the data recency displayed on each role's page
- Non-tech roles may have limited data; in this case, Glassdoor becomes the primary benchmark source

## Used By

- `aireadylife-career-op-comp-review` — benchmark current TC against market P50/P75 for role and level
- `aireadylife-career-flow-build-comp-summary` — generate component-level compensation comparison table
- `aireadylife-career-flow-scan-target-roles` — pull compensation data for qualifying job postings

## Vault Output

`~/Documents/aireadylife/vault/career/00_current/` — benchmark data cache
`~/Documents/aireadylife/vault/career/00_current/` — market comp range data from job postings
