# AI Ready Life: Core — Quickstart

Welcome to AI Ready Life Core. This bundle includes the four essential life domains: Health, Wealth, Tax, and Career.

## What's in this vault

```
vault/
├── health/      — labs, medications, preventive care, wearables
├── wealth/      — accounts, investments, debt, cash flow
├── tax/         — documents, estimates, deductions, deadlines
└── career/      — pipeline, compensation, skills, market data
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

Your vault paths will be:
- `~/Documents/aireadylife/vault/health/`
- `~/Documents/aireadylife/vault/wealth/`
- `~/Documents/aireadylife/vault/tax/`
- `~/Documents/aireadylife/vault/career/`

## Step 2 — Fill in config.md for each domain

Open each domain's `config.md` and fill in your details. Start with the fields you know — the agent will tell you what's missing when you run your first skill.

Priority order: **health → wealth → tax → career**

## Step 3 — Add domains to Claude Desktop

In Claude Desktop, set your AI Ready Life project folder to:

- **Mac:** `~/Documents/aireadylife/`
- **Windows:** `%USERPROFILE%\Documents\aireadylife\`

Install each domain plugin from GitHub. Once installed, the agent reads your vault automatically.

## Step 4 — Run your first skill

Open Claude and try any of these to get started:

- "Give me a health brief"
- "What's my net worth?"
- "Am I on track with my taxes?"
- "Review my career pipeline"

## Tips

- **Fill config.md first.** Each domain's agent uses it for every skill.
- **00_current/ is your working space.** Drop documents, exports, and notes here.
- **02_briefs/ fills automatically.** The agent writes summaries here after each review.
- **Domains work independently.** You can use Health without having Wealth data, and vice versa.

Start with one domain, get familiar, then expand.
