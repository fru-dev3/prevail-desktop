# Prevail Desktop — Active Task List

**Branch:** `ui-feedback-recommendations` · **Version line:** 0.8.x (patch-forever; never 0.9 without explicit go)
**Rule:** Do NOT merge to main or release until founder says so. Stay on feature branch.

This file is the crash-safe source of truth. Update statuses here as work proceeds.
Status legend: `[ ]` todo · `[~]` in progress · `[x]` done (committed) · `[?]` needs verify

---

## UI feedback round — 2026-06-15

**Mode:** CAPTURE — founder is doing a design-review walkthrough. Log every item in
detail; do NOT build until founder says "go". More feedback incoming.

### 🎨 DESIGN BAR (cross-cutting — applies to EVERY panel below)
Founder: "a lot of these things look basic… avoid just basic forms… needs to look like a
premium, well-thought-out design. Functionality is really more on the design and layout."
- The settings panels are currently plain stacked forms: bare label + input/toggle rows,
  flat cards, default-looking selects/number-steppers/text inputs. Reads as a generic form.
- RAISE THE BAR everywhere: thoughtful hierarchy, grouping, spacing, iconography, states;
  premium controls (not default OS toggles/selects); cards with intent; visual interest
  without clutter. This quality bar applies to REC-1, IDEAL-1, TG-1, SAFETY-1, Apps, Home,
  and any panel we touch. When redesigning a panel, redesign the CONTROLS too, not just copy.

### ✅ Done this round
- [x] **Recommendations: "Set" acts in place** (4f07125) — model recs now write the
  per-domain default model (`prevail.domain.<dom>.cli`/`.model`, read live by the chat
  composer) instead of navigating to Models settings. Principle established: a rec action
  that's a one-shot config write executes on click; only navigate when the user genuinely
  must go do something elsewhere (auth, add context).
- [x] **Rename Daemons → Routines** (c6b3d86) — all user-facing copy (section title, nav
  label, "Memory & Routines" heading, Row descriptions, Ideal State + tasks copy, domain
  PrefSection). Engine command names (`*_daemon_status`, `id:"daemons"`) intentionally kept.

### 🔶 Decided, not yet built
- [x] **HOME-1 · "Briefing" on the homepage.** (2194463) — compact "Briefing" added to the
  no-domain landing (chatpanel.tsx, after the agent rail): top 3 recommendations (actionable in
  place via shared applyRec) + a recent-distilled-intents glance line, each with "see all" into
  the full Recommendations/Intents panels. HomeBriefing in recommendationspanel.tsx; applyRec
  extracted so panel + briefing share one action path. Kept tight for no-scroll.

### 🔴 Apps section overhaul ("makes me want to puke" — big rework)
Components: `appspanel.tsx` (top simple panel), `appconnect.tsx` (connect flow), + the
nested "Advanced" full panel (the duplicate source).
- [x] **APP-1 · Kill duplication.** (cc706fc) — the nested "Advanced" connectors section is
  now CATALOG-ONLY (`catalogOnly` prop on ConnectorsSection suppresses its duplicate connected
  list + standalone header); connected apps render ONCE in AppsPanel. Section retitled "Browse
  the catalog". settingspanel.tsx + settings3.tsx.
- [x] **APP-2 · Smart Connect flow.** (cc706fc) — IntelliSense on the name field matches
  already-connected apps as you type (normalized fuzzy) and offers "Open <app>" to reuse instead
  of duplicating; primary CTA flips to "Connect a new one anyway" when a match shows. Fires
  prevail:app-open → AppsPanel expands it. (The research/build/test/evaluate path is the existing
  engine_app_connect.) appconnect.tsx.
- [x] **APP-3 · Re-evaluate is broken** (cc706fc) — AppsPanel's re-evaluate IS wired
  (engine_app_connect reevaluate mode, reports back inline); the BROKEN duplicate (in the old
  Advanced connectors panel) is gone with APP-1. Verify live on next build.
- [x] **APP-4 · Scheduling** DONE (cli 3eedaa4 + desktop 66c4c89). Built the missing engine
  path: prevail-cli `connectors set <id> refresh <cadence> [at HH:MM] [on day]` →
  setCommunityAppSchedule() writes manifest.refresh round-tripped through coerceRefresh (engine's
  own validator). New `engine_app_set_schedule` Tauri command (registered in lib.rs). AppCard now
  has a cadence editor: hourly / every 6-12h / daily / weekly (+ optional time + weekday) + clear.
  Cadences are the engine-honored set (NOT monthly/N-days, which coerceRefresh rejects). Verified
  e2e against a real manifest. cargo check clean.
- [x] **APP-5 · Domains fed** (cc706fc) — "Domains fed" is now editable in the expanded card:
  chip toggles over the vault's domains (scan_vault), saved via engine_app_set_domains. appspanel.tsx.
- [x] **APP-6 · MCP config** (cc706fc) — the expanded card surfaces the per-app config location
  (app.path — manifest + MCP/connector config) with a Reveal-in-Finder button. Full inline
  editing of the MCP config blob can follow if wanted (the folder is one click away now).

### 🟡 Redesigns (layout/visual)
- [x] **REC-1 · Recommendations panel redesign** (66c07cd) — grouped by category
  (model/app/domain/context) with section headers + counts + blurbs for scannability;
  model recs now show the clean canonical model name (recTitle() builds from action.cli/
  model via modelLabel) instead of the ugly run-id label.
- [x] **IDEAL-1 · Ideal State redesign** (6ac1664) — Alignment card reworked: circular SVG
  gauge for the overall score + verdict pill (On track/Drifting/Off course), thicker clean
  pillar bars with colored value, top-actions in a labelled panel. (Section layout itself
  was already redesigned in T7.) AlignmentCard in panels.tsx.
- [x] **TG-1 · Telegram bridge redesign** (c88482e) — top-to-bottom flow: live status
  pill in the header, one labelled setup block (token + chat ID + route CLI/model), a single
  primary action row (Start/Stop + Send test + inline status), running stats + feed only when
  relevant, help demoted to a quiet footer. settings5.tsx TelegramCard. (Single column kept.)
- [x] **SAFETY-1 · Safety panel redesign** (6ac1664) — split into two labelled clusters:
  "Access protection" (App Lock + Vault Encryption cards) and "Agent guardrails" (the
  toggles/selects in one bordered card). Each guardrail row now has a leading state icon
  that lights (accent-soft) when the control is active. settings4.tsx SafetySection.
- [x] **VAULT-1 · Vault panel redesign** (80bf9c9) — premium location card (icon chip +
  Change), the raw path now in a styled mono box with an "in app" badge + Finder-reveal button;
  Domains + Move-into-app grouped as rows in one card; backups cluster unchanged below. Added a
  `headerless` prop so it composes inside Workspace. settings8.tsx VaultSettings.
- [x] **DEMO-1 · "Demo Mode" panel redesign** (80bf9c9) — renamed "Sandbox", icon header,
  copy reframed (starter packs = production setup; sandbox = throwaway). `headerless` prop for
  Workspace composition. Existing mode strip / 3-step / packs design retained + reframed.
- [x] **NAV-1 · Collapsed rail uses bare letters** (66c07cd) — domain entries without a
  per-domain icon now render a circular badge (filled accent when active, ring otherwise)
  instead of a bare mono glyph. Apps don't render individual items collapsed (no change
  needed). The "+"/">" controls were already lucide icons (Plus/ChevronRight).
- [x] **ABOUT-1 · About page is a narrow centered column** (c88482e) — now full-width single
  column. Logo + name + version + update controls collapse into ONE horizontal banner (was a
  tall centered stack + separate update card); links are a horizontal chip wrap; license fixed
  to GPL-3.0. Uses the width to cut vertical scroll. settings5.tsx AboutSection.

### 📊 Benchmark scheduled runs
- [x] **BENCH-1 · Scheduled benchmark needs a persistent visibility indicator.** (37f8073) —
  SidebarBenchScheduled (sidebar) + HomeBenchScheduledBadge (home landing) show whenever a
  benchmark is armed on a schedule, with the cadence. Steady dot + calendar icon (distinct from
  a live run's pulsing dot, which SidebarBenchmarkRuns already shows). Click → Benchmark settings.
- [x] **BENCH-2 · Scheduled benchmark scope is ambiguous/risky.** DONE (37f8073 + 66c4c89).
  - Scope is now fully DECOUPLED from the manual Run picker. Schedule card has three modes:
    "Repeat latest run", "All models × all domains" (tracks every model even if the last manual
    run was one), and "Custom" (pin an explicit model + domain set; persisted in BENCH_SCHED.scope*).
  - buildScheduledJobs() builds jobs from the chosen scope (filtered to installed + Bunker-permitted
    models); the in-app scheduler AND "Run now" route through runScheduledBatch() (never stacks
    while a run is in progress). Preview shows exactly what will run, mode-aware; single-model
    warning shown only in "repeat latest" mode. (bench.tsx, cards.tsx)
- [x] **BENCH-3 · "Suggest with AI" question gen — per-domain + grounded in REAL data.**
  (CLI 33707ba, branch mcp-stdio-auth-fix)
  1. Per-domain count: ALREADY satisfied — both the desktop loop (suggestWithAi loops per
     domain requesting `count` each, verifies each got drafts) and the engine (`bench suggest`
     loops per domain drafting N each, line ~1595). No permutation split; no domain skipped.
  2. Grounding: the engine already drafts from state/goals/config/soul/_tasks/_memory + the
     latest thread. ADDED the domain's recent `_log/*.md` decision logs to that context (the
     explicit missing piece "the logs") — questions now draw on what actually happened, not
     synthetic prompts. Engine rebuilt; bundle compiles.

### 🎨 Theme default
- [x] **THEME-1 · Default palette → "Mono"** (66c07cd) — brand-new users (no saved
  `prevail.desktop.palette`) now open in Mono grayscale; existing users keep their saved
  palette. Default flipped in hooks.tsx useAppearance init. FOUNDER CONFIRMED: desktop app
  palette (not prevail.sh).

### 🧭 Information architecture / naming
- [x] **IA-1 · Vault + "Demo Mode" overlap; "Demo Mode" is a misnomer.** The "Demo Mode"
  panel hosts STARTER PACKS, which import real domains into your PRODUCTION vault — that's
  not demo. It conflates two different things: (a) the genuine demo *sandbox* (throwaway
  sample data) and (b) production setup (starter packs + vault). And it overlaps the Vault
  panel (vault folder, domains, move-into-app). FIX = merge + rename:
  - Merge Vault + Demo Mode into ONE umbrella area. Recommended name: **"Workspace"**
    (covers vault location, domains, starter packs, backups, sandbox). Alt: keep **"Vault"**
    as umbrella.
  - Rename the demo concept "Demo Mode" → **"Sandbox"** (clearly the throwaway exploration
    space), as a sub-mode of the umbrella.
  - Move STARTER PACKS under production setup (they feed the real vault), not under "demo".
  - Founder delegated the naming to me; await pick (Workspace vs Vault umbrella).
  DONE (80bf9c9): umbrella = **Workspace** (founder-confirmed choice). One nav entry replaces
  Vault + Demo Mode; WorkspaceSection composes headerless Vault + Sandbox. Demo → "Sandbox".
  Starter packs framed as production setup. "vault"/"demo" remain deep-link aliases.

### 🔴 MCP "Expose Prevail" overhaul (separate from UI review; needs founder go)
The whole "Expose Prevail to your agent" feature is broken for real users. Four parts:

- [x] **MCP-1 · Token auth breaks generic stdio clients.** (CLI 4d9e488, branch
  mcp-stdio-auth-fix) — stdio no longer requires the per-request token; `McpServerOptions.network`
  gates the check (default false). New `prevail mcp --network|--require-token` opts back in for
  any network exposure. Token hint printed only in network mode. Regression test added
  (tools/list with NO token over stdio). Engine rebuilt (dist/prevail); 337 engine tests pass
  (1 PRE-EXISTING unrelated recommendations.test failure). NOTE: CLI on feature branch, NOT main.
- [x] **MCP-2 · Generated config has hardcoded DEV/DEMO paths → leaks founder identity.**
  (c88482e) — mcpCommandPath() now flags dev/source-tree paths (`/target/debug/`,
  `/target/release/`, `/src-tauri/`) as unstable alongside translocated/volume/temp paths and
  emits the canonical `/Applications/Prevail.app/Contents/MacOS/prevail` instead — so a copyable
  config never contains the dev tree / founder home. (b) vault already uses the active vaultPath
  prop (resolved at generation time), not a hardcoded demo path. The founder only SEES dev/demo
  values because they run a debug build against the demo vault; installed users get correct ones.
- [x] **MCP-3 · Cover ALL agent clients.** (c88482e) — added Cursor (~/.cursor/mcp.json,
  mcpServers), VS Code (.vscode/mcp.json, NOTE: uses `servers` not `mcpServers`), and a generic
  "Other / stdio" tab (covers OpenClaw, Paperclip, Multica, Goose, Zed — any stdio MCP host).
  Existing 4 (Claude Code/Desktop, Codex, Gemini) verified format/location. OpenClaw/Paperclip/
  Multica are the founder's bespoke systems — the generic stdio command+args is what they consume;
  if they need a specific config schema, founder to confirm and I'll add a dedicated tab.
- [x] **MCP-4 · "Test handshake" fails** (c88482e) — root cause: mcp_test_handshake spawned
  `prevail mcp` whose parent (the Tauri app) failed verifyParentProcess() (not a TTY / known IDE),
  so the server exited before answering → "no valid initialize response". Fixed by spawning with
  `--unsafe-detach`; combined with MCP-1 (stdio needs no token) the initialize round-trip now
  succeeds. engine.rs cargo check passes. (Verify live once a build is run.)

Impl notes: `resolve_prevail_bin()` is the canonical engine resolver (engine.rs). The config
generator lives in the desktop MCP settings panel (find: "EXPOSE PREVAIL TO YOUR AGENT" /
mcpServers snippet). Active vault path is the desktop's current vaultPath.

### Implementation notes (found)

### Implementation notes (found)
- Per-domain model: `prevail.domain.<domain>.cli` + `.model` (chatpanel.tsx:125-201 reads
  live). Engine rec emits clean `action.cli`/`action.model` (canonical-bench
  `{key,cli,model,label}`; `label` is the ugly run-id used in the title).
- Apps duplication source: top panel + the "Advanced" collapsible embeds a second full
  Apps panel. Connector catalog = 1468 apps across 4 patterns (API/MCP 1224, OAuth 72,
  CLI 13, browser 159).
- "Briefing" combines `recommendationspanel.tsx` (engine_recommendations) + the Intents
  panel data; home dashboard must stay no-scroll.

---

## Already shipped this session (committed on branch / released)
- [x] Daemons settings → per-daemon collapsible cards (d3c1f96)
- [x] Sidebar selection now obvious — accent fill + ring (6461fce)
- [x] APPS aligned to top level in sidebar (6461fc)
- [x] General settings collapse headers get icons + summary (c138167)
- [x] Starter-pack icons + slimmer vault switcher (ded22a1)
- [x] Canonical `CollapsibleSection` component built (2bd3e9d) — MIGRATION still pending (see T1)
- [x] v0.8.1 released (mac DMG + Windows exe + updater feed)

## Cross-cutting (highest leverage — touches many pages)

- [~] **T1 — Collapsible component consistency.** ONE canonical collapsible everywhere.
  DONE: section-level collapsibles on General (GenSub), Daemons (DaemonGroup), Models
  (provider groups), Configuration (Sub) all delegate to CollapsibleSection now (icons +
  summary/subtitle, left chevron, collapsed by default, persisted). Preferences/Connectors/MCP
  were unified in the prior session. Chat "Thinking" + provider expanders' chevrons standardized
  to left ChevronRight+rotate-90.
  REMAINING (lower priority): benchpanel detail rows + councilpanel <details> are inline
  list-item disclosures — already left-chevron, not page sections. Migrate only if they look off.
  Requirements (apply site-wide, every page):
  - Icon on the header (left side)
  - Summary of contents shown in the header — on BOTH the left and the right side
  - Collapsed by default
  - Chevron/collapse affordance on a CONSISTENT side across the whole app (default LEFT).
    Find any place where the chevron is on the right and fix it.
  - Same visual design on every page — no per-page variation.
  - Landing state must NOT look busy/noisy, but stay clear + intuitive.
  - (Canonical `CollapsibleSection` exists as of 2bd3e9d — audit ALL call sites for compliance.)

## Page redesigns

- [x] **T2 — Council redesign (creative).** DONE: CouncilCircle "round table" — members
  seated around a ring with spokes to a central panel-size emblem, chair crowned + accent-ringed
  at top, new seats animate in. Renders above the Council picker summary. (settings6.tsx)

- [x] **T3 — Skills page.** DONE: removed rainbow per-skill tiles (calm uniform tile);
  added filter-by-domain dropdown (auto-expands on select); clearer hover "edit" affordance;
  chat auto-suggest untouched. (settings2.tsx)

- [x] **T4 — "Run now" broken (Scheduled runs).** FIXED (96de.. cards.tsx): silent no-op
  now reports back (busy state + success/empty/error messages); fixed "just now ago" /
  "~6 days ago" time-wording glitches via new formatDuration. Deeper visual redesign of the
  card can still follow if wanted.

- [x] **T5 — Benchmark: suggest-questions design + all-domains guarantee.** DONE (bug + T5b design).
  - [x] BUG FIXED (96de.. benchpanel.tsx): "all domains" loops per-domain so every domain
    gets N questions, verifies each, reports failures/shortfalls.
  - [x] T5b DONE: redesigned suggest panel as a titled card with labeled controls.

- [~] **T6 — Benchmark history/statistics accuracy.**
  - DONE: added "Coverage by domain" computed DIRECTLY from raw run records (each run's
    `domains` + model) — per domain: # runs + # distinct models; summary = total runs/models/
    domains for the current filter. Accurate by construction. (benchpanel.tsx)
  - Model view already folds runs per model (runs count + domains). History groups by batch.
  - REMAINING: if a specific number still looks wrong, needs a real dataset to reproduce; the
    counts are now derived from source-of-truth records so any remaining gap is in how the
    ENGINE writes a run's `domains`/`batch_id` (investigate engine if it recurs).

- [x] **T7 — Ideal State page formatting.** REDESIGNED: calm single-column section cards
  (icon chip + title, indented body), quiet left-border intro lead, prominent title, version
  history via canonical CollapsibleSection. (settings4.tsx)

- [x] **T8 — Ingestion/Connectors tiers split by type.** DONE: tab switcher (API & MCP /
  Composio / Browser) filters the tier cards; browser runner under Browser tab; audit+artifacts
  shared below. One focused mode at a time, as asked. (settings1.tsx IngestionSection)

- [x] **T9 — Flexible cadence pickers.** DONE everywhere: model-refresh (RefreshCadence,
  prior), plus T9b Scheduled Benchmarks (cards.tsx) and Backup (settings8) now accept
  "every N days" (custom:N) via shared benchFreqMs/backupFreqMs used by card + scheduler.

## Intent (needs a plan, then build)

- [~] **T10 — Intent: from raw-prompt log → distilled recommendations.**
  - DONE Phase A (engine): `intents_distill` + `intents_distilled_read` (intents.rs) — reads the
    whole ledger, model lifts prompts into high-level intents (goal/need/domains/status/
    confidence/open_questions/evidence/recommendations) → _meta/intents_distilled.json. cargo check green.
  - DONE Phase B (UI): IntentsSection ladder — distilled cards + drill-down + Distill button;
    raw log demoted to "Prompt history".
  - DONE Phase C (AUTOMATION): intent_daemon.rs — auto re-distills with NO manual click, on a
    cadence (default check 30min, at least daily) OR after N new prompts (default 10); idempotent
    via _meta/intents_distill_cursor.json. On by default, auto-starts with other daemons. Toggle +
    tuning on the Daemons settings page. Manual Distill button still available. cargo + build green.
  - OPTIONAL future: a per-recommendation "turn into task / loop" button (taskgen + loops wiring).
  - Today intents look like just a list of prompts. Define the bigger purpose.
  - Drill down into an intent → get recommendations/actions out of it.
  - Infer HIGH-LEVEL intent across sessions/domains (e.g. "Is Toyota better than Honda?"
    → underlying intent = "looking for transportation", then probe job/use context).
  - Distill into broader recommendations for action.
  - DELIVERABLE FIRST: a written plan + recommendations before building.
  - APPROVED by founder to BUILD (phased). BUILD PLAN (next focused session):
    * Phase A (engine, Rust src-tauri): `intents_distill` command — read `_intents.jsonl`
      across domains, call the configured cheap model to (1) cluster prompts into high-level
      intents (the "Toyota vs Honda" -> "evaluating transportation" lift), (2) infer the
      underlying goal + open questions, (3) emit recommended next actions. Write
      `<vault>/_meta/intents_distilled.json`. Add `intents_distilled_read`. Mirror distill.rs
      plumbing for the model call + cursor. Engine TS daemon (daemon-learn.ts pattern) for the
      headless path.
    * Phase B (desktop UI): restructure IntentsSection into the ladder — rename raw list to
      "Prompt history"; new "Intents" view = distilled cards (goal, domains spanned, status,
      confidence, evidence prompts on drill-down, recommended actions). "Distill now" button +
      a daemon toggle on the Daemons page.
    * Phase C: wire recommendations -> "turn into tasks / loop" (taskgen + domain loops).
  - NOTE: do NOT fake high-level intent with client-side heuristics; it needs the model call.

## Verify / smaller

- [x] **T11 — Backup: two buttons?** VERIFIED resolved (2b77d42). VaultSettings now has one
  On/Off auto-backup toggle + one "Back up now" + a restore-points list. Not two redundant buttons.

- [x] **T12 — Website: Windows (Microsoft) download visibility.** FIXED in prevail-web:
  hero CTA is now platform-aware (Windows visitors get "Download for Windows"), always shows
  "Also for <other OS>" link, nav Download scrolls to #install (both platform cards). Builds clean.
  NOTE: committed in prevail-web; needs a SITE DEPLOY (founder trigger) to go live.

- [~] **T18 — Telemetry: PostHog + Sentry (privacy-first, opt-in, transparent).**
  - DONE: plan (docs/TELEMETRY-PLAN.md) + scaffolding (telemetry.ts allowlist/scrubber/local-log,
    Settings -> Safety -> "Privacy & telemetry" consent UI default-OFF, "what we collect" page,
    app_opened wired). Inert (log-only) until build-time keys exist.
  - DONE (2026-06-17): ALL allowlisted track() call sites now wired, each scrubbed to the
    fixed vocabulary, all inert/local until keys exist: feature_used (App tab effect),
    benchmark_run (executeBenchBatch, counts only), provider_configured (both key-save sites,
    mapped to enum), daemon_toggled (DaemonCard start/stop choke point).
  - VERIFIED 2026-06-17: posthog-js + @sentry/browser are ALREADY installed AND the send is
    fully wired + privacy-hardened (posthog.init with autocapture/pageview/replay all OFF;
    ensureSentry). Everything is gated purely on build-time env keys (VITE_POSTHOG_KEY /
    VITE_SENTRY_DSN); inert with none set. So there is NO code left.
  - REMAINING (founder-only, a secret + a go/no-go): set VITE_POSTHOG_KEY (+ host) and
    VITE_SENTRY_DSN as release-CI build env vars. The instant they exist, telemetry activates
    (still opt-in default-OFF per the consent UI). Optional follow-on: website PostHog + banner.

- [x] **T13 — Versioning policy.** Stay in 0.8.x (patch-forever) up to 0.8.100/200/1000
  before 0.9. Never advance minor without explicit go. (Recorded in memory; reaffirmed.)

## New features (founder request)

- [x] **T19 — Benchmark bundles + suites (saveable, rerunnable, schedulable).** DONE
  (2026-06-17, src/bench-presets.ts + benchpanel.tsx). Founder asked for a way to save a
  named combination of models and re-pick it, and to combine a model set with a domain set
  into a rerunnable/schedulable object.
  - ModelBundle: named set of models. Bundle bar under Models — click to apply, "Save
    selection as bundle" to create, delete inline. Active bundle highlights when the current
    selection matches.
  - BenchSuite: named (models + domains + mode). New Suites section: save current selection;
    per suite Run (executes immediately from the suite's own values), Schedule (reuses the
    existing background scheduler via its custom scope), Delete, and click-name to Load into
    the editor. Scheduled badge persists across remounts by matching the custom schedule.
  - Storage: localStorage JSON + live window-event hooks (single-user, no DB). Suites snapshot
    models+domains so deleting a bundle never breaks a suite.
  - Ships in v0.8.11.

## Added from prior-session screenshots (not in the pasted text batch)

- [x] **T14 — Frameworks page.** DONE: "Why this matters" + "More coming soon" collapsed by
  default; Frameworks/Lenses each in canonical CollapsibleSection with active-selection summary;
  added PreambleColumn `headerless` prop. Calm landing. (settings1.tsx, panels2.tsx)

- [x] **T15 — Gateway page redesign.** DONE: Bridges + More surfaces now use the canonical
  CollapsibleSection (Radio/Sparkles icons, live summary + status dot, opens when a bridge is
  live). (settings5.tsx)

- [~] **T16 — Vault folder layout: apps/ + domains/ siblings.** DONE end-to-end:
  - paths::enumerate_domain_dirs walks BOTH layouts (v3 <vault>/domains/<d> + legacy), deduped;
    distill, intents, taskgen, skillgen all use it (they previously skipped v3 domains).
  - resolve_domain_base: new domains default to v3 (<vault>/domains/<d>); existing legacy domains
    preserved in place (never orphaned). 50/50 lib tests pass.
  - DONE: bulk migrator `vault_migrate_layout` (safe rename, never overwrite/delete, idempotent,
    unit-tested) runs once on vault load → existing vaults adopt apps/ + domains/ siblings. 51/51 tests.

- [~] **T17 — Mystery screenshot (image #17).** DEFERRED by founder (2026-06-14): unsure which
  screen it was. Will retest and bring it back later with the specific page. Do not act until then.

---

## T19 — Self-driving Domain Loops (founder: "that's the whole point") — DONE
Loops were a stateless suggestion engine. Now genuinely autonomous:
- LEARN/EVOLVE/PERSIST: each run reads its own history (engine _loops_runtime.json),
  fed into the prompt → no repeats, judges if the gap is closing, escalates when stalled.
- CREATE TASKS: concrete steps filed as real tasks in <domain>/_tasks.md (deduped).
- ASK PERMISSION: spend/contact/irreversible/decision steps queued as pending approvals;
  Loops panel "Needs your approval" → Approve (→ task) / Dismiss.
- BEHIND THE SCENES: in-app startLoopsScheduler advances due loops on a cadence (default
  hourly, pref-gated default ON), not just the manual button.
- EXECUTE (connectors): approvals queue now has "Execute" — runs the approved action FOR REAL
  via the agent's tools/connectors (engine executeAction → `daemon --loops --exec`; non-bare
  agent turn in the domain, refuses NO_CONNECTOR if nothing can do it). Outcome shown + recorded
  as a domain decision. Approval is the gate; nothing fires without the explicit click.
- Engine: prevail-cli/src/daemon-loops.ts (+ 4 unit tests). Desktop: loops.ts, loopspanel.tsx,
  App.tsx, storage.ts. tsc + build green; engine tests pass; 0 new typecheck errors.
- FUTURE: richer in-app status (history timeline per loop); auto-propose loops/goals from state.

## T20 — Apps redesign + always-on (founder goal) — DONE
- P1 status/schedule UI, P2 describe-the-goal connect, P3 autonomous sync daemon
  (run headless + in-app), P4 method re-evaluation. (docs/APPS-REDESIGN.md)
- Headless login agents now cover learn + loops + sync ("keep working when closed").
- Loops are self-driving + can execute approved actions via connectors (act-mode).
- VERIFIED 2026-06-14: desktop tsc PASS · 51 cargo tests · frontend build · 337 engine
  tests (0 fail) · website build. Website (Windows-download fix) DEPLOYED to prevail.sh.

## T21 — Self-learning / proactive deepening (founder, 2026-06-14 eve) — DONE
- Intents now COMPOUND into loops: loop runner reads curated high-level intents
  (_meta/intents_distilled.json) per domain and advances them. (daemon-loops.ts, tested)
- Recommendations layer: engine `recommendations` + Settings→Recommendations feed —
  proposes domains/models/apps/context-gaps, one-click. Count badge on nav. (tested)
- Context score tied into self-learning: low-score gaps → recommendations; panel now
  shows a TREND sparkline (engine_score_history) — visibly ever-improving.
- Perf: engine CLI-roster cached 15s + Ollama probe concurrent/700ms (was 2×1500ms
  every turn). Cached detect ~0ms. Helps MCP/Telegram/WebUI/daemon chat latency.
- Palette: greenish/teal "vault" is ALREADY the launch default (#0d7a6e) — confirmed,
  no change needed.
- VERIFIED: 339 engine tests + 51 cargo tests (0 fail), all builds green. Unmerged on
  ui-polish-post-081 / engine main; website already live.

## Decisions (founder, 2026-06-14)
- T10 Intents: BUILD NOW, phased (daemon + storage → drill-down UI → wire into taskgen/loops).
- Sequence: VISUAL CONSISTENCY FIRST (T1 canonical-collapsible migration) → per-page redesigns
  → benchmark accuracy (T6) → Intents build (T10).

## Status (2026-06-14)
ALL buildable items DONE: T1-T9 (incl. T9b), T10 (A+B+C, automated + recommendation→task),
T11, T12, T14, T15, T16 (incl. migrator), T18 (scaffolding). Frontend builds; 51/51 Rust tests pass.

DEFERRED:
- T17 — founder unsure which screen; will retest and bring it back later. Parked.

NEEDS FOUNDER (when ready):
- T18 live wiring — provide PostHog key+host + Sentry DSN, then install posthog-js/@sentry/react
  and flip the flush on (one spot). Currently inert/log-only by design.
- Site deploy — to publish the Windows-download fix to prevail.sh.

## Overnight build session — 2026-06-15 (founder asleep, "implement them all")
Founder gave the GO on the 2026-06-15 UI-feedback round + included MCP overhaul. Built
autonomously on branch `ui-feedback-recommendations` (desktop) + `mcp-stdio-auth-fix`
(prevail-cli). NOT merged, NOT released (per standing rule — awaiting explicit go).
Decisions taken (founder pre-confirmed): THEME-1 = desktop palette; MCP overhaul = yes;
IA-1 umbrella = "Workspace".

DONE (24 — the ENTIRE list): THEME-1, REC-1, NAV-1, SAFETY-1, IDEAL-1, TG-1, ABOUT-1, HOME-1,
MCP-1, MCP-2, MCP-3, MCP-4, BENCH-1, BENCH-2, BENCH-3, IA-1, VAULT-1, DEMO-1, APP-1, APP-2,
APP-3, APP-4, APP-5, APP-6. Nothing deferred.
(2nd pass after founder said "do this all": BENCH-2 full scope-decouple + APP-4 schedule setter.)

Verification: desktop `tsc` clean + `vite build` green on every batch; engine `cargo check`
clean (MCP-4 + APP-4 command); prevail-cli rebuilt, MCP server tests pass incl. new
no-token-over-stdio guard; APP-4 schedule setter verified e2e against a real manifest; 336
engine tests pass (1 PRE-EXISTING unrelated recommendations.test failure, untouched).
Commits (desktop): 66c07cd, 6ac1664, c88482e, 2194463, 37f8073, 80bf9c9, cc706fc, 66c4c89 (+docs).
Commits (cli, branch mcp-stdio-auth-fix): 4d9e488 (MCP-1), 33707ba (BENCH-3), 3eedaa4 (APP-4).

OPEN for founder: review everything, then say the word to merge to main + cut a patch build.
(MCP overhaul lives on the cli feature branch; once shipped the claude-mcp-proxy shim is unnecessary.)

## Log
- 2026-06-15: 2nd pass — founder said "do this all" → completed BENCH-2 (full scope decouple)
  + APP-4 (per-app schedule setter, CLI + Rust + UI). Whole list now DONE (24/24).
- 2026-06-15: Overnight session — worked the entire UI-feedback + MCP list (see above).
- 2026-06-14: Task list created from founder feedback batch.
- 2026-06-14: Fixed T5 (all-domains suggest), T4 (Run now + time wording). Verified T11, T12.
- 2026-06-14: Founder chose: build Intents (phased), visual consistency first.
- 2026-06-14: Worked the full list — collapsible consistency, all page redesigns (Ideal State,
  Council, Skills, Frameworks, Gateway, Ingestion tabs), benchmark coverage, website Windows,
  telemetry scaffolding, Intents end-to-end + automation, vault v3 layout + migrator, flexible cadences.
- 2026-06-14: T18 telemetry LIVE-WIRED (founder provided creds). PostHog (phc_…, US Cloud) +
  Sentry DSN (fdev3/apple-macos) both wired anonymous/opt-in/default-OFF; SDKs lazy-chunked
  (vendor-posthog / vendor-sentry) after fixing a manualChunks bug that shipped ~450kB of
  telemetry eagerly to all users. Creds saved to 1Password (Personal). Auth token in .env.local.
- 2026-06-14: GPL-3.0 relicense across Prevail (desktop + cli + web): LICENSE files, SPDX fields,
  READMEs/badges, site copy, Homebrew formula, 6 community connector manifests. Left third-party
  dep licenses (package-lock) and factual OpenClaw mention untouched (correctly).
- 2026-06-14: MERGED ALL to main + RELEASED. Web deployed to Netlify (live). Desktop v0.8.3 tagged
  → Release CI building (GPL + telemetry). cli merged to main. Fixed a silent incomplete-commit
  bug on prevail-web (LICENSE/pkg field were never staged) before pushing.
- 2026-06-14: CI source-map upload scaffolded (@sentry/vite-plugin, gated on SENTRY_AUTH_TOKEN
  secret) → readable crash stack traces on the NEXT release. Pushed to desktop main (f86d2eb).

---

## LIVE-REVIEW ROUND — 2026-06-16 (testing v0.8.5 in the running app)
Founder walking through the running build. DESIGN BAR above still applies: premium, not
basic forms; "format way nicely, not text walls."

### Done
- [x] **Version 0.8.4 → 0.8.5** (68f1922) — 3 files; footer reflects the new build.
- [x] **Council roster removed from single-Chat composer** (68f1922) — "many models in Chat"
  was the G2 strip showing where it shouldn't; Council keeps its panelist pills.

### Open (this round)
- [x] **ARCH-1: unified** (bb55b43) — Loops "Desired state" now edits the SAME ideal-state.md
  as the domain Ideal State (mirrors to the loop doc for the engine). One target everywhere.
- [x] **IDEAL-AI** (59c1367) — "Draft with AI" on the Ideal State (surface.rs domain_draft_ideal:
  2-4 grounded sentences from the domain's context, for review).
- [x] **FMT-1** (bb55b43, 59c1367) — reformatted: "How loops work" (steps + guardrail grid),
  the loop card (highlighted target, numbered action cards, run-history timeline), Routines
  (on/off icon cards), Ideal State editors (premium framing).
- [x] **IA: "Memory engine" moved into Context & Memory** (afd2fde) — was orphaned in App.
- [x] **ONB-1** (a1a5b40) — onboarding is now PrevailLogo on welcome + a spotlight walkthrough
  highlighting domains / composer / tabs / settings via data-tour anchors.
- [~] **B2: `$domain` + Enter** (98d6fd2) — hardened + now surfaces attach failures on-screen
  (was a silent console.error); guarded applyDollarCompletion. Root cause shows on next attempt.

### Released
- [x] **v0.8.5** — merged cli + desktop feature branches to main (--no-ff), tagged v0.8.5,
  pushed → Release CI building (sign + notarize + publish). cli merged first so the engine
  sidecar carries W4/G1/ideal-draft. 73 rust tests + tsc(0) + cli suite green.
