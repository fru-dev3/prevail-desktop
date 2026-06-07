# AI Ready Life: Learning — Quickstart

Welcome to your Learning vault. This is where your track your courses, reading, and certifications.

## What's in this vault

- **config.md** — your learning profile and settings
- **open-loops.md** — active flags and open items the agent is tracking
- **00_current/** — active documents and your current learning state
- **01_prior/** — prior period records, organized by date
- **02_briefs/** — briefs and reports the agent generates

The `state.md` file in this demo vault shows what a fully populated learning state looks like (Alex Rivera demo data).

## Step 1 — Place your vault

Move this `learning/` folder to the correct location for your OS:

| OS | Vault path |
|----|------------|
| **Mac** | `~/Documents/aireadylife/vault/learning/` |
| **Windows** | `%USERPROFILE%\Documents\aireadylife\vault\learning\` |

## Step 2 — Fill in config.md

Open `config.md` and fill in your details. You don't need everything on day one — fill what you know and leave the rest blank. The agent will tell you what's missing when you run your first skill.

## Step 3 — Add the domain to Claude Desktop

In Claude Desktop, open your AI Ready Life project folder:

```
~/Documents/aireadylife/
```

If you've installed the Learning domain from GitHub, it will be available under `domains/learning/`. The agent reads your vault automatically from the path in Step 1.

## Step 4 — Run your first skill

Open Claude and try:

- "Give me a learning brief"
- "What's my learning status?"
- "Run my learning review"

Claude will read your config and vault, then give you a personalized learning summary.

## Tips

- **Start with config.md.** The more complete it is, the smarter your agent.
- **00_current/ is your working space.** Drop documents, notes, and exports here.
- **02_briefs/ fills up automatically.** The agent writes reports here after each review.
- **open-loops.md tracks what needs action.** The agent flags items here and clears them when resolved.

Your Learning AI is only as smart as the data you give it. Start simple, add more over time.
