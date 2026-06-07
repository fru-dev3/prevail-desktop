# AI Ready Life: Complete — Quickstart

Welcome to AI Ready Life Complete. This bundle includes all 20 life domains.

## What's in this vault

```
vault/
├── health/        — labs, medications, preventive care, wearables
├── wealth/        — accounts, investments, debt, cash flow
├── tax/           — documents, estimates, deductions, deadlines
├── career/        — pipeline, compensation, skills, market data
├── benefits/      — employer benefits, 401k, HSA, enrollment
├── brand/         — personal brand, social analytics, content
├── business/      — revenue, expenses, compliance, contracts
├── calendar/      — deadlines, focus time, agenda
├── chief/         — cross-domain daily brief and system health
├── content/       — content pipeline, SEO, revenue tracking
├── estate/        — rental properties, tenants, cash flow
├── explore/       — travel, trips, documents, wishlist
├── home/          — maintenance, expenses, seasonal tasks
├── insurance/     — policies, claims, renewals, coverage
├── intel/         — news sources, topics, research briefs
├── learning/      — courses, books, goals, progress
├── real-estate/   — market data, listings, buy vs. rent analysis
├── records/       — identity documents, legal, subscriptions
├── social/        — contacts, relationships, birthdays, outreach
└── vision/        — goals, OKRs, quarterly planning, scorecard
```

Each domain folder contains:
- **config.md** — your profile and settings for that domain
- **00_current/** — active documents and current state
- **01_prior/** — prior period records, organized by year
- **02_briefs/** — reports and summaries the agent generates

## Step 1 — Place your vault

Move the `vault/` folder from this zip to:

```
~/Documents/aireadylife/vault/
```

## Step 2 — Fill in config.md for each domain

Open each domain's `config.md` and fill in your details. You don't need to complete all 20 on day one. Start with the domains most relevant to you and work outward.

Recommended start order: **health → wealth → tax → career → chief**

## Step 3 — Add domains to Claude Desktop

In Claude Desktop, set your AI Ready Life project folder to:

- **Mac:** `~/Documents/aireadylife/`
- **Windows:** `%USERPROFILE%\Documents\aireadylife\`

Install domain plugins from GitHub. Domains work independently — install the ones you want to use and skip the rest.

## Step 4 — Run your first skill

Open Claude and try:

- "Give me a life brief" (chief domain)
- "What's my health status?"
- "What's my net worth?"
- "Run my tax document check"

## Tips

- **Start with chief.** The chief domain reads all other domains and gives you a single daily brief across your entire life.
- **Fill config.md first** for each domain you activate.
- **00_current/ is your working space.** Drop documents, exports, and notes here.
- **02_briefs/ fills automatically.** The agent writes summaries here after each review.
- **Domains work independently.** Activate one at a time at your own pace.
