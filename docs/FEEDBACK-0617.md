# Feedback — 2026-06-17 5am · Plan & Tasks

**Source:** `~/Downloads/Prevail.sh 06.17.2026 5am Feedback.pdf` (14 pages)
Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[?]` needs founder input

The feedback splits into **two big intelligence themes** (the real thesis) and a set
of **UI/IA fixes**. Sequenced below by leverage and dependency.

---

## Theme 1 — Deep grounding (the headline issue)
The model gives generic advice ("export 3 months of checking + credit card
transactions") when it should know the user's *actual* accounts and name them
("your U.S. Bank checking and Chase Sapphire card"). Same for "why should I eat
tonight" → it should already know the favorite food. Every recommendation must be
specific to what's known about the user.

- [ ] **G1 — Specific, profile-grounded recommendations.** Make chat/council/recommendations
  reference the user's concrete facts (named accounts, banks, cards, foods, limits)
  from profile + domain state, never generic placeholders. Audit the prompt preamble:
  profile IS injected (we added it), so the gap is likely (a) the demo profile lacks
  the specific entities, and/or (b) the prompt doesn't *instruct* the model to name
  specifics and ask for the missing one instead of guessing. Add an explicit
  "be specific: name their actual accounts/items from context; if unknown, ask which"
  directive, and enrich the demo profile with named financial accounts/foods.
- [ ] **G2 — "What has it learned about me?"** Surface the learned per-user profile
  (the durable facts/preferences) so it's visible what grounds the answers. Ties into
  the Context-panel IA work (Theme 3).

## Theme 2 — Incognito mode
- [ ] **G3 — Incognito toggle.** A visible control (top-right, like other apps) that
  flips chat into a plain-model mode: NO profile, ideal-state, omega, memory, or
  domain context injected — just the raw model, like vanilla ChatGPT. Clear visual
  state while on. Persisted per session; off by default.

---

## Theme 3 — Background processes (founder: "very important")
Today a running council STOPS when you switch threads/tabs. It must keep running
independently of navigation; same for long chats, benchmarks, and loops.

- [ ] **P1 — Processes don't stop on navigation.** A convened council (and a long
  chat) keeps running when you switch threads/tabs. Benchmarks + loops already use a
  module-scope registry that survives nav; bring council/chat to the same model.
- [ ] **P2 — Sidebar process indicator.** A live "N processes" indicator in the
  sidebar listing every active long-running thing (chat / council / benchmark / loop),
  each clickable to jump back to it. (Benchmark runs already have a sidebar widget —
  generalize it to all process types.)
- [ ] **P3 — Council canvas shows the LATEST running council.** When results stream
  in, auto-surface/scroll to the most recent council (top→bottom) instead of forcing
  a scroll down to find it. (Six councils stack; the live one should be front.)

---

## Theme 4 — Context panel IA (global vs local)
The Wealth context panel lists Ideal State, Long-term memory, State, Decisions,
Activity, Skills — but it's unclear what's GLOBAL vs LOCAL to the domain, and what
long-term memory even is vs State vs Journal vs Intent.

- [x] **C1 — Model decided (founder, 2026-06-17): "group + simplify."**
  - GLOBAL: Ideal State, Global intent.
  - THIS DOMAIN: State (incl. long-term memory, merged), Decisions, Activity (the
    journal), Skills.
  - So: fold "long-term memory" into State; "Activity" is the journal; intent is
    surfaced globally (Global intent) rather than a separate per-domain item in the
    panel. C2 implements this grouping + relabel.
- [ ] **C2 — Reflect global/local split in the UI.** Group the context panel into a
  "Global" section (Ideal State) and a "This domain" section (State, Decisions,
  Activity, Skills, Domain memory), with labels that make the separation obvious.
- [ ] **C3 — Clickable decisions.** Each decision in the list opens its full content
  (name + verdict/detail), not just the first. Today you can't click through.

---

## Theme 5 — Surface fixes (concrete bugs)
- [ ] **S1 — Insights needs two clicks.** Clicking Insights should land on Insights
  in one click; today it toggles/requires a second click. (Re-investigate — a prior
  fix made it a destination, but the report persists.)
- [ ] **S2 — Usage always blank.** Usage panel shows nothing; make it populate as
  close to realtime as possible after each chat/turn.
- [ ] **S3 — Benchmark draft "failure" is opaque.** "Drafted 0/1 — failed: Wealth"
  with no reason. Surface WHY (no model, parse fail, no context, bunker-blocked) and
  what to do. (Builds on the earlier B4 count fix — this is the genuine-failure path.)
- [ ] **S4 — Remove Ideal-state editor from Loops.** Loops shouldn't host a "draft
  Wealth ideal state" editor — that's context, not loops. Loops focus on loop config
  only; ideal state lives in the Context panel / Ideals.
- [ ] **S5 — App configuration clarity.** A "not-configured" app (e.g. PayPal) gives
  no clear next step. Make the path obvious (what to click, what it'll do) — ties into
  the autonomous-connect work.

---

## Theme 6 — Settings simplification + design consistency
- [ ] **D1 — On/Off toggle everywhere (no Start/Stop text).** Replace all Start/Stop
  text (daemons, reminders, backups, etc.) with the toggle "peel" switch. Recurring
  ask; sweep every call site.
- [ ] **D2 — Remove duplicate Ideal State from Memory engine.** The Memory-engine page
  repeats Ideal State that already sits right above it. Remove the dup.
- [ ] **D3 — Access protection: two compact columns.** App lock | Vault encryption
  side by side, minimal, instead of two tall stacked blocks.
- [ ] **D4 — Simplify Workspace / Vault + Backups.** Keep the top "Vault" section
  (shows + changes location). Your-vault vs Demo-vault as a toggle: your-vault lets you
  change location, demo points to demo. Starter packs import below. Drop (or hide)
  "set up domains", "move into app", "tidy into data/" unless essential. Backups =
  one toggle (Backup on/off) + a schedule selector. Use the toggle peel icon; it's
  currently far too much UI.
- [ ] **D5 — No em dashes in any design/UI copy.** Sweep components for "—" in
  visible strings; replace with ":" / "," / "-".
- [ ] **D6 — Rename context-window button.** "Compact — summarize & continue" →
  "Compact & Summarize" (fixes the em dash + the word wrap).

---

## Theme 7 — Formatting
- [ ] **F1 — "Questions worth asking" panel.** Format the 5-question panel nicely
  (it's a plain list now). Clean cards, scannable.

---

## Suggested sequence
1. **Quick design sweeps** (D5, D6, D2, D1, S4) — fast, low-risk, visible wins.
2. **Surface bugs** (S1, S2, S3) — broken behavior.
3. **Settings layout** (D3, D4, F1) — contained redesigns.
4. **Background processes** (P1–P3) — the "very important" one; bigger engine/state work.
5. **Grounding** (G1, G2, G3) — the thesis; prompt + demo-data + incognito.
6. **Context IA** (C1 decision → C2, C3) — needs a founder call first (C1).

Two `[?]` need founder input: **C1** (the global/local + memory/journal/intent model).
