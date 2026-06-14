# Apps — Redesign (founder vision, 2026-06-14)

Supersedes the UX half of APPS-CONNECTORS-PLAN.md. The data model + ingestion
tiers there still stand; this changes HOW the user connects an app and HOW status
is shown.

## The end goal (what apps are FOR)
Apps are the **data inflow layer**. Real-world services (AllTrails, Gmail, PayPal,
Capital One, a watch) sync their data into the vault's domains so every domain
conversation, loop, recommendation, and brief is grounded in current reality.
An app is "working" iff it is reliably **refreshing the vault on a schedule**.
Everything else in Prevail is downstream of that freshness.

## The paradigm shift: describe the goal, the agent connects
TODAY: pick from a catalog → pick a tier → fill auth forms. Too many forms,
too hard-coded.

NEW: the user **names an app + describes what they want from it**, e.g.
> "AllTrails — pull my completed hikes and saved trails into Health, weekly."

A **Connection Agent** then owns the rest:
1. **Researches** the best available way to connect THIS app right now — official
   API, an MCP server, a CLI already installed (gcloud/gh), Composio, or browser
   automation — via web search + a known-methods registry. Headless-first
   preference: MCP > API/CLI > Composio > browser.
2. **Picks** the best method and writes a sync recipe (a connector SKILL.md).
3. **Asks for the ONE thing it needs** from the user and nothing more — "sign in
   to Google", or "paste an API key", or "I'll open a browser; log in once".
4. **Establishes the schedule** and starts syncing headlessly.
5. **Re-evaluates over time** — if a better method appears later (an MCP launches
   for an app that only had browser automation), it can upgrade. Not hard-coded.

The user's whole surface is: a goal sentence + (sometimes) a single auth action.
The agent owns method selection and plumbing. This reuses the connector-skills
runner + the new act-mode agent execution (loops can already execute via tools).

## Status — never ambiguous
Each app shows exactly ONE status, color-coded, with the method named:
- ○ **Not connected** (gray) — described but not working yet; the card says
  exactly what's blocking ("needs Google sign-in") with a single CTA.
- ◐ **Connecting** (amber, animated) — agent is researching / setting up.
- ● **Connected & syncing** (green) — working. Shows: method ("Google CLI,
  authenticated"), last sync, next sync, domains fed.
- ▲ **Needs attention** (red) — was working, now failing (auth expired / error);
  says what to do.
A user can always tell, at a glance, which apps are live and which are not.

## Schedule — visible + controlled
Every connected app states its schedule plainly ("every day 6am" / "every 3
days"), with the flexible cadence picker (reuse benchFreq/backupFreq pattern),
a "Sync now" button, last/next sync timestamps, and pause. The user is in control.

## UI (beautiful, low-friction)
- **Apps gallery** — cards grouped by status (Attention → Connected → Not
  connected), then "+ Connect an app". Card = logo · name · status pill · method
  badge · last/next sync · domain chips. Calm, single-column rows (per layout
  rules), collapsed detail.
- **Connect = one input, not forms** — "What do you want to connect?" → app name
  + a goal line. The agent proposes the method and the single auth step. A short
  "here's how I'll connect it / here's the one thing I need" confirmation, then go.
- **App detail (expand)** — goal (editable) · method (+ "why this" + "re-evaluate
  method") · auth state (+ re-auth) · schedule · domain mapping · recent sync log
  (what it pulled, counts) · Sync now.

## Architecture
- **Connection Agent (engine)**: `app connect --name --goal` → agent turn with web
  search + connector registry → connection plan {method, ref, auth step, sync
  recipe}. Writes the app record + SKILL.md. (New engine command; reuses
  cli-bridge + connector-skills + act-mode.)
- **Auth handoff**: agent returns the minimal auth step; desktop renders it as a
  single action (run CLI login, paste key, or guided browser login).
- **syncd daemon**: per-app schedule; runs the sync skill headlessly; writes to
  `<vault>/<domain>/imports/<app>/`; updates status + last/next sync; elevates
  errors. Mirrors the existing daemon pattern (distill/taskgen/skillgen).
- **Status** = connector-probe result + last-sync success, folded into the one
  status enum above.

## Build phases (proposed)
- **P1 — Status + schedule clarity (UI on existing data).** Rebuild the Apps page
  around the 4-state status model + method badge + last/next sync + domain chips +
  flexible schedule + Sync now. Uses today's engine_apps_list/probe/sync. Ships
  visible value immediately, no new backend.
- **P2 — Describe-the-goal connect flow.** The single-input "connect an app" +
  the Connection Agent (engine command) that researches method + returns the
  plan + the one auth step. Replace catalog/tier forms.
- **P3 — syncd daemon + schedule control + sync log.** Headless per-app refresh
  on schedule; recent-pull log; error elevation.
- **P4 — Method re-evaluation + upgrade.** Periodic "is there a better way now?"

## Open decisions (for founder)
1. v1 priority: start with **P1 (make status/schedule beautiful + clear on
   current data)** then P2 connect-flow? Or go straight at the agentic connect?
2. Auth friction tolerance: OK for the agent to **open a browser for a one-time
   login** when no API/MCP exists (e.g., PayPal)? (Needed for browser-tier apps.)
3. Autonomy: should syncs run **fully unattended** once connected, or surface a
   first run for approval before going on schedule?
