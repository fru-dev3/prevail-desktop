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
- [ ] **B2-8 — Model label "Claude claude-opus-4-8" in WILL RUN.** Raw id leaks
  instead of "Opus 4.8" — fix the model-label formatting on that line.

- [ ] **B2-9 — Alignment card "Top actions to close the gap".** Format nicely
  (not plain bullets) and make each action clickable to take the action (open the
  domain / start a chat or loop on it).

- [ ] **B2-10 — Memory & Context shows the title twice.** The CollapsibleSection
  header AND the inner SettingsHeader both render "Memory & Context". Drop the
  inner duplicate (render it headerless when wrapped); headers must be visually
  bigger than subheaders.

(More to come — the founder is sending rapid feedback; appended as received.)
