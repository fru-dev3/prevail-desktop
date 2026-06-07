# AI Ready Life: Insurance — Quickstart

Welcome to your Insurance vault. This is where your track all your policies, renewals, and coverage gaps.

## What's in this vault

- **config.md** — your insurance profile and settings
- **open-loops.md** — active flags and open items the agent is tracking
- **00_current/** — active documents and your current insurance state
- **01_prior/** — prior period records, organized by date
- **02_briefs/** — briefs and reports the agent generates

The `state.md` file in this demo vault shows what a fully populated insurance state looks like (Alex Rivera demo data).

## Step 1 — Place your vault

Move this `insurance/` folder to the correct location for your OS:

| OS | Vault path |
|----|------------|
| **Mac** | `~/Documents/aireadylife/vault/insurance/` |
| **Windows** | `%USERPROFILE%\Documents\aireadylife\vault\insurance\` |

## Step 2 — Fill in config.md

Open `config.md` and fill in your details. You don't need everything on day one — fill what you know and leave the rest blank. The agent will tell you what's missing when you run your first skill.

## Step 3 — Add the domain to Claude Desktop

In Claude Desktop, open your AI Ready Life project folder:

```
~/Documents/aireadylife/
```

If you've installed the Insurance domain from GitHub, it will be available under `domains/insurance/`. The agent reads your vault automatically from the path in Step 1.

## Step 4 — Run your first skill

Open Claude and try:

- "Give me a insurance brief"
- "What's my insurance status?"
- "Run my insurance review"

Claude will read your config and vault, then give you a personalized insurance summary.

## Tips

- **Start with config.md.** The more complete it is, the smarter your agent.
- **00_current/ is your working space.** Drop documents, notes, and exports here.
- **02_briefs/ fills up automatically.** The agent writes reports here after each review.
- **open-loops.md tracks what needs action.** The agent flags items here and clears them when resolved.

Your Insurance AI is only as smart as the data you give it. Start simple, add more over time.
