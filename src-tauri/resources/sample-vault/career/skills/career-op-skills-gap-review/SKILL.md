---
name: aireadylife-career-op-skills-gap-review
type: op
cadence: quarterly
description: >
  Quarterly skills gap analysis comparing your current skills inventory to target role requirements scraped from the monthly market scan. Ranks the top 3-5 gaps by market demand frequency and estimated time to reach working proficiency. Produces a prioritized learning list with specific platform and course recommendations. Triggers: "skills gap review", "what should I be learning", "career development check", "skills analysis", "learning priorities for my career", "skills for my next job".
---

## What It Does

Runs quarterly to keep your skills development intentionally aligned with the roles you are targeting. Without this alignment, professional learning tends to follow what is interesting rather than what is strategically valuable — this op fixes that by connecting your learning plan directly to what the market is actually asking for in your target roles right now.

The op reads your current skills inventory from `vault/career/00_current/` — each skill is logged with a self-assessed proficiency level (beginner / working / proficient / expert), years of hands-on experience, and recency (when was this skill last used in a real work context). Recency matters because a proficiency level assessed 3 years ago on a skill with a 2.5-year half-life (most technical skills decay this fast) should be treated as lower than logged.

It then reads the target role requirements data compiled from the last 3 months of market scan results in `vault/career/00_current/`. This gives a realistic, current picture of what skills appear in job postings for your target roles — not a generic list from a career advice article, but actual frequency data from the specific postings you are targeting. For each skill that appears in target role postings, the op checks whether it exists in your inventory and at what proficiency. Skills that are absent or at beginner level are classified as gaps. Skills at working proficiency but present in more than 60% of postings are flagged for depth improvement, not gap closure.

Each gap is scored on two dimensions: demand (how frequently the skill appears across target role postings, expressed as a percentage) and closability (estimated weeks to reach working proficiency based on the nature of the skill — an AWS certification takes 8-12 weeks of study; a new programming language takes 6-12 months for working proficiency; a soft skill like executive communication is harder to bound). The product of demand and inverse-closability produces a priority score. The top 3-5 gaps are the quarter's learning priorities, each with a specific recommended learning resource (exact course name, platform, and estimated hours) and a realistic timeline to reach working proficiency.

The quarterly cadence prevents the list from shifting so frequently it loses focus — market demand changes slowly enough that quarterly updates are sufficient — while keeping the list current enough to reflect actual market evolution.

## Triggers

- "skills gap review"
- "what should I be learning"
- "career development check"
- "skills analysis for my target roles"
- "learning priorities for career"
- "what skills do I need for [role]"
- "certification recommendations"
- "skill half-life check"

## Steps

1. Read skills inventory from `vault/career/00_current/skills.md` — load all skills with proficiency level, years of experience, and last-used date.
2. Apply skill recency decay: skills last used more than 2 years ago are downgraded one proficiency level for the purpose of gap analysis.
3. Read market scan results from `vault/career/00_current/` for the past 3 months — aggregate required skills across all qualifying postings.
4. Calculate demand frequency for each required skill: (number of postings listing this skill) / (total qualifying postings) = demand %.
5. For each skill with demand ≥ 20%: check vault inventory for presence and proficiency.
6. Classify gaps: absent from inventory → gap; present at beginner → gap; present at working with demand ≥ 60% → depth flag.
7. Estimate time-to-working-proficiency for each gap based on skill type and category (tool vs. language vs. domain vs. soft skill).
8. Calculate priority score for each gap: demand % × (1 / estimated weeks to close).
9. Rank gaps by priority score — output top 3-5 as this quarter's learning priorities.
10. For each priority gap: identify a specific recommended resource (platform, course name, estimated hours, and estimated cost if any).
11. Write skills gap analysis to `vault/career/00_current/YYYY-QN-skills-gap.md` with ranked gaps and recommendations.
12. Compare to prior quarter's gap analysis — note which gaps were closed (skill reached working proficiency) and which persist.
13. Call `aireadylife-career-task-update-open-loops` with top 3 gaps as learning priority flags, routed to Learning plugin if installed.

## Input

- `~/Documents/aireadylife/vault/career/00_current/skills.md` — current skills inventory with proficiency levels
- `~/Documents/aireadylife/vault/career/00_current/` — last 3 months of market scan required skills data
- `~/Documents/aireadylife/vault/career/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/career/config.md` — target roles context

## Output Format

**Skills Gap Analysis** — saved as `vault/career/00_current/YYYY-QN-skills-gap.md`

```
## Skills Gap Analysis — [Quarter Year]

Target roles analyzed: X postings across Y months
Skills in inventory: X (X proficient+, X working, X beginner)

## Top Priority Gaps

### 1. [Skill Name]
Demand: X% of target postings
Current inventory: [Absent / Beginner]
Time to working proficiency: ~X weeks
Recommended resource: [Platform] — "[Course Name]" — ~X hours — [Free/$X]
Priority score: X.X

### 2. [Skill Name]
...

## Depth Improvement Flags (working proficiency, high demand)
- [Skill] — appears in X% of postings — currently at working level; consider targeting proficient

## Closed This Quarter
- [Skill] — reached working proficiency per self-assessment on [date]

## Skills Not in Any Target Postings (consider deprioritizing)
- [Skill] — last demanded X months ago in market scan data
```

## Configuration

Required in `vault/career/config.md`:
- `target_titles` — list of target role titles (determines which market scan data to pull)
- `quarterly_review_date` — preferred day of quarter for this op (defaults to 1st of Jan/Apr/Jul/Oct)

Skills inventory maintained at `vault/career/00_current/skills.md`. Format per entry:
```
skill: [name]
proficiency: beginner / working / proficient / expert
years_experience: X
last_used: YYYY-MM
notes: [optional context]
```

## Error Handling

- **Skills inventory empty:** Prompt user to create a baseline inventory before gap analysis is possible. Offer to generate a starting inventory based on their resume or current role description.
- **No market scan data available:** Run a fresh market scan before the skills gap review. The gap analysis is only meaningful if grounded in current posting data.
- **Skill not in any standard taxonomy:** Include it in the inventory as-is; if it appears in postings, it will be captured in the demand frequency calculation.
- **Time-to-close is highly uncertain:** For skills where time-to-close is hard to estimate (e.g., "leadership" or "executive communication"), flag the estimate range as wide (3-24 months) and note that time-to-close estimate is approximate.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/career/00_current/skills.md`, `~/Documents/aireadylife/vault/career/00_current/`, `~/Documents/aireadylife/vault/career/config.md`
- Writes to: `~/Documents/aireadylife/vault/career/00_current/YYYY-QN-skills-gap.md`, `~/Documents/aireadylife/vault/career/open-loops.md`
