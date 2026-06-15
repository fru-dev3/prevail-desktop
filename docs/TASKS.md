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
- [ ] **HOME-1 · "Briefing" on the homepage.** Bring Recommendations + Intents onto the
  home dashboard as ONE first-class section named **"Briefing"** (proactive digest: what
  Prevail learned + what it suggests next). Must respect no-scroll-on-landing → compact:
  top ~3 actionable recommendations + a recent-intents glance, each with "see all" into the
  full panel. This is the highest-leverage change (makes the self-learning visible on landing).

### 🔴 Apps section overhaul ("makes me want to puke" — big rework)
Components: `appspanel.tsx` (top simple panel), `appconnect.tsx` (connect flow), + the
nested "Advanced" full panel (the duplicate source).
- [ ] **APP-1 · Kill duplication.** AllTrails renders 2-3x: top "CONNECTED · 1", then again
  inside "Advanced › Apps › CONNECTED 1" (a SECOND full Apps panel with its own header,
  connected list, connector catalog, search), then again on scroll. Consolidate to ONE panel.
- [ ] **APP-2 · Smart Connect flow.** "Connect an app" asks for a name and can create a
  DUPLICATE of an existing app (catalog = 1468). Instead: IntelliSense as you type → if the
  app exists, reuse it (NO dropdown, smarter than that); then user describes what they want
  → Prevail builds the MCP/connector, tests it, evaluates it.
- [ ] **APP-3 · Re-evaluate is broken** — clicking it does nothing. Fix.
- [ ] **APP-4 · Scheduling** — apps show "no schedule"; need an intelligent/flexible
  scheduler, not just daily/weekly/monthly. (Flexible cadences exist elsewhere — wire here.)
- [ ] **APP-5 · Domains fed** — let the user add/modify which domains an app feeds
  intelligently (currently a static list, e.g. "feeds Fitness, Health, Explore, Travel").
- [ ] **APP-6 · MCP config** — surface where/how the per-app MCP config is pulled & editable.

### 🟡 Redesigns (layout/visual)
- [ ] **REC-1 · Recommendations panel redesign** — flat list of ~near-identical rows is
  monotonous ("could be designed way better"). Group/scan better; also the model name
  shows the ugly run-id label ("2026-06-04_claude-claude-opus-4-6") — show the clean model
  name (rec `action.model` is already clean; the `title` uses the run `label`).
- [ ] **IDEAL-1 · Ideal State redesign** — format the whole section nicely; the Alignment
  bar chart "looks terrible". Rework the alignment chart + overall layout.
- [ ] **TG-1 · Telegram bridge redesign** — clunky layout/flow; clean it up.
- [ ] **SAFETY-1 · Safety panel redesign** — "looks so basic". Plain stacked rows of
  label + default toggle/select/number/text input (App Lock, Vault Encryption, Approval
  mode/timeout, Confirm MCP reloads, Command allowlist, Redact secrets, Allow private URLs,
  File checkpoints). Make it premium per the DESIGN BAR: group the two encryption/lock cards
  distinctly from the guardrail toggles, upgrade the controls, add visual hierarchy + states.
- [ ] **VAULT-1 · Vault panel redesign** — functionality fine, design/layout/icons/flow
  "could be way better" (premium-designer bar). Plain rows (Vault folder/Change, Domains/
  Set up domains, raw path box, Move into app, Automatic backups card with inline select +
  number-stepper + ON pill + Back up now + Restore points). Rework hierarchy, iconography,
  the backups control cluster, and the raw-path display into something premium.
- [ ] **DEMO-1 · "Demo Mode" panel redesign** — same premium bar (groupings/flow/icons).
- [ ] **NAV-1 · Collapsed rail uses bare letters** — when a panel/sidebar is collapsed it
  shows plain single letters (">", "+", "I", "s") in a thin rail. Replace with circular
  icon badges (sophisticated, signal "content is behind here"), not bare glyphs. Expanded
  state is fine; only the collapsed rail needs the upgrade.
- [ ] **ABOUT-1 · About page is a narrow centered column** — should go FULL-WIDTH like every
  other panel (violates the single-column-full-width rule), and lay out so everything fits
  without scrolling. Currently: centered max-w column (logo, update card, links list, Alpha
  Software, Configuration, Health check stacked tall). Use the width to reduce vertical scroll.

### 🎨 Theme default
- [ ] **THEME-1 · Default palette → "Mono"** (clean grayscale, minimal and focused) for
  BRAND-NEW users, replacing the current greenish/teal "vault" default. The whole app should
  open in Mono by default. SUPERSEDES the earlier "greenish default" decision. (Founder said
  "site"; interpreting as the desktop app palette picker — confirm if they meant prevail.sh.)
  Impl: the palette default is set in storage/theme init (LS `prevail.desktop.palette`).

### 🧭 Information architecture / naming
- [ ] **IA-1 · Vault + "Demo Mode" overlap; "Demo Mode" is a misnomer.** The "Demo Mode"
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

### 🔴 MCP "Expose Prevail" overhaul (separate from UI review; needs founder go)
The whole "Expose Prevail to your agent" feature is broken for real users. Four parts:

- [ ] **MCP-1 · Token auth breaks generic stdio clients.** Server (`prevail-cli/src/
  mcp-server.ts`) requires `_meta.authorization: prevail-<token>` on every non-initialize
  request → generic stdio clients (Claude Code) send none → `initialize` ok but `tools/list`
  fails `-32001 unauthorized`. Likely also why "Test handshake" returns "no valid initialize
  response". No `--no-auth`/env escape hatch exists. Root cause: per-request token is a
  NETWORK control; over stdio `verifyParentProcess()` already secures it. Fix: don't require
  the per-request token over stdio (keep it only for any network exposure). Rebuild the engine.
- [ ] **MCP-2 · Generated config has hardcoded DEV/DEMO paths → leaks founder identity.**
  The "Expose Prevail" snippet emits `command: /Users/frunde/Documents/fru/fd-apps/
  prevail-desktop/src-tauri/target/debug/prevail` (founder's dev tree) and `--vault
  /Users/frunde/Downloads/2026 June/vault-1-demo` (demo vault). For an INSTALLED user this is
  wrong AND exposes a personal name/path. Fix: (a) command = the real resolved engine binary
  via `resolve_prevail_bin()` (the bundled sidecar inside Prevail.app for installed users,
  not the debug build); (b) vault = the user's ACTIVE configured vault path, resolved at
  generation time — never a hardcoded demo path, never the founder's path.
- [ ] **MCP-3 · Cover ALL agent clients.** Config tabs today: Claude Code, Claude Desktop,
  Codex, Gemini CLI. Verify each emits a CORRECT, working config (paths + format + file
  location). Also investigate/add: OpenClaw, Paperclip, Multica (+ any other MCP-capable
  agent) — research which support MCP and their config schema/location.
- [ ] **MCP-4 · "Test handshake" fails** — returns "✗ no valid initialize response from the
  server" on Claude Desktop tab (and likely others). Fix once MCP-1/MCP-2 land; the test must
  actually spawn the resolved binary + do a real initialize round-trip.

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
  - REMAINING (needs founder): PostHog project key + host, Sentry DSN(s). Then install posthog-js
    + @sentry/react, wire the send in telemetry.ts flush + Rust panic hook, add more track() call
    sites (feature_used, benchmark_run, etc.), and the website PostHog (downloads/pageviews) +
    consent banner. Confirm opt-in-default-OFF (recommended).

- [x] **T13 — Versioning policy.** Stay in 0.8.x (patch-forever) up to 0.8.100/200/1000
  before 0.9. Never advance minor without explicit go. (Recorded in memory; reaffirmed.)

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

## Log
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
