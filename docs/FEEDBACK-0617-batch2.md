# Feedback — 2026-06-17 (rapid batch 2) · Plan & Tasks

Running list of the live-review feedback. Status: `[ ]` todo · `[~]` wip · `[x]` done

- [x] **B2-1 — Incognito = icon + tooltip.** Not a text button. Minimal Ghost icon;
  green when on, grey when off; tooltip carries the state. Chat + Council composers.
- [x] **B2-2 — Rename "Activity" → "Journal".** Name it consistently in the context
  panel (founder prefers Journal). Section title + sublabels + empty state.
- [x] **B2-3 — BUG: "unknown option '--- Profile ...'".** A prompt that starts with
  "-" (an injected context block leads with "--- Label ---") was parsed by the
  claude/codex/antigravity CLI as a flag → exit 1. Fixed in cli-bridge buildCliArgs
  (prepend a leading space when the prompt starts with "-"). Needs sidecar rebuild
  (ships with the next release).
- [x] **B2-4 — Council circle: show model name + number.** Each node should label
  its model, e.g. "Opus 4.7", not just the provider glyph.
- [x] **B2-5 — Skills: let the user UPLOAD skills.** The Skills page only explains
  the drop-a-folder convention. Add an actual upload/import affordance (pick a
  folder / SKILL.md and install it into a domain's skills/).
- [x] **B2-6 — Scheduled runs: pill toggle, not "OFF" text.** The scheduled-runs
  card still uses a text "OFF"/"ON" button. Use the toggle peel switch (recurring
  preference: pills everywhere, never On/Off text).

- [x] **B2-7 — Scheduled runs: show next run date + time.** Done — concrete
  "Next run: today, 2:30 PM" / "Mon Jun 23, 2:30 PM" label.
- [x] **B2-11 — MCP "failed to connect".** Root cause: `prevail mcp --vault <path>`
  ignored --vault (parsed only --unsafe-detach/--network, then broke out of arg
  parsing) → fell back to ~/.prevail/vault-demo (missing) → failed. FIXED in cli
  (parse --vault inside the mcp loop; both arg orders now work). Confirmed by an
  external Codex MCP session hitting the same fallback. Ships with sidecar rebuild.
- [ ] **B2-12 — Vault structure: data/ + build/.** Founder wants apps + domains
  cleanly under `data/`, and the supporting runtime files (benchmark, complete,
  core, usage, plus loose `_decisions.jsonl`/`_intents.jsonl`/`_journal.md`/`_meta`/
  `_surface.json`/`_threads`/`AGENTS-operating.md`) under a `build/` folder, so the
  root is just `data/ build/ profile.md`. Engine layout change (extends W4) — needs
  a resolver + safe migrator + path updates across cli + desktop. NOT a quick edit;
  plan + careful migration required.
- [x] **B2-8 — Model label "Claude claude-opus-4-8" in WILL RUN.** Raw id leaks
  instead of "Opus 4.8" — fix the model-label formatting on that line.

- [x] **B2-9 — Alignment card "Top actions to close the gap".** Format nicely
  (not plain bullets) and make each action clickable to take the action (open the
  domain / start a chat or loop on it).

- [ ] **B2-10 — Memory & Context shows the title twice.** The CollapsibleSection
  header AND the inner SettingsHeader both render "Memory & Context". Drop the
  inner duplicate (render it headerless when wrapped); headers must be visually
  bigger than subheaders.

- [x] **B2-13 — Rename "Web access" nav → "WebUI".** Done. (Read as rename to
  "WebUI"; the "Remove /" part was ambiguous — flag if a different label intended.)
- [x] **B2-14 — Format "What we collect" telemetry list.** Done — clean two-column
  table (event chip + what it carries) instead of a dash-list.

- [ ] **B2-15 — Consolidate the Vault section.** Don't have a standalone "Vault
  folder" card AND a separate "Starter packs & Sandbox" with Your/Demo vault
  toggles. Make ONE "Vault" section = the Your vault + Demo vault cards, each with
  small inline icons to change the path + open the vault (Finder). Drop the
  redundant standalone Vault-folder card. "Starter packs" becomes its own separate
  section. (Pairs with B2-12 vault restructure.)

- [ ] **B2-16 — Backups inside each vault card.** Not a separate big "Backups"
  section — a tiny backup control within the Your vault / Demo vault cards, since
  backup is per-vault (back up your vault, or the demo vault). Folds into B2-15.
- [ ] **B2-17 — New "Work" settings nav group.** Add a nav group called "Work"
  containing Tasks, Workspace, and Recommendations (move Tasks there).

- [ ] **B2-18 — Tasks duplicated.** Tasks shows inside the Memory engine
  (Configuration) page AND has its own nav item. Remove the embedded copy; Tasks
  lives once (in the new "Work" group, B2-17).
- [ ] **B2-19 — Distiller time bug.** "DISTILLER running · last pass 20601 days
  ago ago" — double "ago" and a bogus epoch-based age when last_run_ts is 0.
  Guard the formatting.

- [ ] **B2-20 — Delete the "Memory engine" (Configuration) page.** Memory already
  lives under Routines/Daemons; the Memory & Context view duplicates it, and once
  memory + Tasks are moved out, the page has nothing unique. Remove the nav item;
  fold the Memory & Context produced-view into Routines (or Ideals).

- [ ] **B2-21 — "Keep working with the app closed": pill toggle, not "OFF" text.**
  HeadlessLearnCard uses a text On/Off; use the toggle pill.
- [x] **B2-22 — Saved items need a home.** "0 active · 2 saved" (recommendations)
  but no way to view saved ones. Anything the app lets you SAVE must be findable +
  usable. Add a saved view/filter (recommendations, and audit other "save" spots).
- [x] **B2-23 — Routines: show last run + next run.** For all routine-driven things
  (distiller, intents, taskgen, skillgen, reminders), minimally show when they last
  ran and when they next run. (Ties to B2-19 time-format fix.)

- [ ] **B2-24 — Combine Ideals + Omega into one "Ideals" section.** Two collapsible
  subs: "Ideal State" (user input, with alignment shown) and "Omega" (what the
  system learned). The value is comparing ideals vs omega over time. (Part of the
  Settings IA refactor.)

- [ ] **B2-25 — Top domain nav grouping.** Chat + Council prominent on the LEFT;
  everything else (Benchmark, Insights, Usage, Preferences, Loops, Apps, Archive)
  on the RIGHT.
- [ ] **B2-26 — De-emphasize the right-side nav.** Make the right group smaller +
  less prominent than Chat/Council so the bar isn't busy. (Recommend: Chat/Council
  as the primary tabs at full size; the rest as smaller secondary icon+label
  controls, lighter weight.)

- [x] **B2-27 — "domain not found" path bug.** Context panel shows
  "domain not found: …/demo-vault/wealth". Likely the v4 `data/domains/<d>` layout
  not resolved by `domain_context` (looks at flat `<vault>/<d>`). Fix path
  resolution (ties to B2-12 vault layout).
- [x] **B2-28 — Graceful context panel when ctx fails.** When domain_context
  errors, the ctx-gated sections (State, Decisions, Journal, Skills) silently
  vanish and only a raw error shows. Design: keep all section rows visible with a
  quiet "couldn't load this domain's local context" + retry, instead of a scary
  raw path error and missing items.

- [ ] **B2-29 — Usage page: richer Activity.** The Activity contribution-heatmap
  is the good view; the daily bar chart alone isn't enough. Keep/feature the
  Activity heatmap on the Usage page; don't change the other usage cards.
  (Clarify exact intent — Activity already renders there.)

(More to come — the founder is sending rapid feedback; appended as received.)

---

## Grouped: Settings IA + Workspace refactor (do as ONE coherent unit)
These touch the same nav structure / Workspace area, so they're done together to
avoid breakage + rework:
- **Nav reorg:** B2-17 (new "Work" group = Tasks + Workspace + Recommendations),
  B2-18 (remove duplicate embedded Tasks), B2-20 (delete "Memory engine" page;
  relocate Memory & Context into Routines/Daemons).
- **Vault/Workspace:** B2-12 (data/ + build/ on-disk layout), B2-15 (one Vault
  section: Your/Demo vault cards with inline change+open icons), B2-16 (per-vault
  backup control inside those cards).
Proposed target Settings nav order: Intelligence (Models, Council, Frameworks,
Skills, Benchmark) · Context & Memory (Ideals, Omega, Intents, Routines) · Work
(Tasks, Workspace, Recommendations) · Connections (Apps, Gateway, MCP, WebUI) ·
Privacy & Safety · Appearance/About.
