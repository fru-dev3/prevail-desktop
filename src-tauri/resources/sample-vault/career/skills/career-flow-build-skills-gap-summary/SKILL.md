---
name: aireadylife-career-flow-build-skills-gap-summary
type: flow
trigger: called-by-op
description: >
  Compares the current skills inventory (with proficiency levels and recency) to target role requirements aggregated from recent market scan data. Identifies gaps, scores each by market demand frequency and time to close, and returns a ranked list of the top 3-5 priority gaps with specific learning resource recommendations.
---

## What It Does

Called by `aireadylife-career-op-skills-gap-review` to produce the core skills gap analysis. The flow operates at the intersection of what you know and what target roles require — it is the bridge between your skills inventory and your learning plan.

**Reading the inventory:** Loads all skills from `vault/career/00_current/skills.md` with their proficiency level (beginner / working / proficient / expert), years of experience, and last-used date. Before gap analysis, applies recency decay: technical skills not used in the last 24 months are downgraded one proficiency level (e.g., proficient → working, working → beginner). This reflects the real dynamic that technical skills decay — a Python skill from 3 years ago without recent use is not the same as one used daily.

**Aggregating demand from market data:** Reads all market scan result files from `vault/career/00_current/` for the past 3 months. For each posting in the scan data, extracts the listed required and preferred skills. Aggregates across all postings to produce demand frequency for each skill: what percentage of qualifying postings list this skill as required or preferred. Skills appearing in 20%+ of postings are in scope for gap analysis.

**Scoring gaps:** For each in-scope skill, checks the inventory. If absent or at beginner proficiency: classified as a gap. If at working proficiency but demand ≥ 60%: classified as a depth flag (not a gap but worth investing in). For each gap, estimates time to working proficiency based on skill category: cloud certifications (AWS/GCP/Azure) = 8-12 weeks of focused study; new programming language = 12-24 weeks; data platform tool = 4-8 weeks; ML/AI framework = 8-16 weeks; soft skills (executive communication, cross-functional leadership) = 6-24 months (harder to bound). Priority score = demand_pct × (1 / weeks_to_close). Higher score = higher priority.

**Recommending resources:** For each top gap, maps to a specific learning resource: Coursera for structured certificate programs (Google, IBM, Deeplearning.ai certs), O'Reilly for technical depth (books + interactive labs), Pluralsight for cloud skills, Udemy for tool-specific courses, official certification prep from AWS/GCP/Azure/Google. Includes exact course name, platform, estimated hours, and cost.

## Steps

1. Load skills inventory from `vault/career/00_current/skills.md`.
2. Apply recency decay: downgrade skills with last_used date older than 24 months by one proficiency level.
3. Load market scan data from `vault/career/00_current/` — collect all required_skills fields from past 3 months.
4. Aggregate demand frequency: count postings listing each skill ÷ total postings = demand %.
5. Filter to skills with demand ≥ 20% for gap analysis scope.
6. For each in-scope skill: look up in inventory. Classify as gap, depth flag, or covered.
7. For each gap: estimate weeks_to_working_proficiency based on skill category.
8. Calculate priority score for each gap: demand_pct × (1 / weeks_to_close).
9. Sort gaps by priority score descending. Select top 3-5 for this quarter's priorities.
10. For each top gap: identify recommended learning resource (specific platform + course name + estimated hours + cost).
11. Return ranked gap list with demand, closability, priority score, and resource recommendation.

## Input

- `~/Documents/aireadylife/vault/career/00_current/skills.md` — skills inventory
- `~/Documents/aireadylife/vault/career/00_current/` — last 3 months of market scan data
- `~/Documents/aireadylife/vault/career/01_prior/` — prior period records for trend comparison

## Output Format

Structured gap list returned to calling op:

```
Gap 1: [Skill Name]
  Demand: X% of target postings
  Inventory: Absent / Beginner (decayed from Y)
  Weeks to working proficiency: ~X
  Priority score: X.X
  Resource: [Platform] — "[Course/Cert Name]" — ~X hours — [Free / $X]

Gap 2: [Skill Name]
  ...

Depth flags (working proficiency, demand ≥ 60%):
  - [Skill] — X% demand — at working, consider targeting proficient

Covered (proficient+ and in scope):
  - [Skill] — X% demand — proficient — no action needed
```

## Configuration

Skills inventory format in `vault/career/00_current/skills.md`:
```yaml
- skill: "[name]"
  proficiency: working
  years_experience: 3
  last_used: "2024-06"
  notes: "[optional]"
```

## Error Handling

- **Inventory empty:** Return empty gap list with note that inventory must be populated first. Offer to generate a starter inventory from a resume or job description the user pastes.
- **Market scan data older than 3 months:** Note that demand frequency may not reflect current market. Recommend running a fresh market scan before the skills gap review.
- **Skill has no standard learning path:** Note the gap, flag that recommended resource is harder to identify for this skill type, and suggest the user specify a preferred learning format.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/career/00_current/skills.md`, `~/Documents/aireadylife/vault/career/00_current/`
- Writes to: None (returns data to calling op; op writes the output file)
