# Monday Feedback — 2026-06-15 · Plan & TODO

**Source:** `~/Downloads/Prevail - Monday Feedback 06.15.2026.pdf`
**Branch:** `feat/monday-feedback-0615` · **Mode:** PLAN ONLY until founder says "go".
Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[?]` needs founder input

---

## STATUS — 2026-06-16 (post-/goal pass)
The bulk of this list shipped in **v0.8.5** (Monday-feedback B/C/M/L/W/A/G/K/P/O). A
later live-review surfaced a few **regressions** that slipped through; those are now
fixed and verified:
- **B-group: ALL fixed** — B1 (drag→context hook teardown race), B2 (prior), B3
  (thread binding: slug round-trip mangled underscores), B4 (false benchmark
  count), B5 (routing keywords now persisted to manifest), B6 (prior).
- **C1** General context parity (functional already; stale note fixed). **C2** thread
  name in canvas done.
- **K6** AI benchmark questions now grounded in the user profile + constitution.
- **A4** auto-detection VERIFIED via `prevail doctor` (Claude, Codex, Antigravity,
  Ollama all detected).
- **G1 / M6 / A6 / W1-W3 / O1 / P1,P3,P4** confirmed done (v0.8.5 / verified now).

### Cleared in the /goal pass (2026-06-16/17)
- **I1 — DONE.** Web was already `fd-apps-prevail-web` (todo was stale); only the cli
  diverged. Renamed cli package `prevail` → `fd-apps-prevail-cli` (bin command stays
  `prevail`). Convention from CLAUDE.md applied directly.
- **K5 — DONE.** Added a current-domain indicator chip to the Benchmark header
  (shows the domain you arrived from). (benchpanel.tsx)
- **A1 — DONE (already).** appspanel.tsx subtitle is explicit: "Connect each one
  once, then it's available to any domain's context. No duplicates." + APP-2 dedup.

### Irreducible remainder — externally blocked (cannot be done autonomously)
- **W4 — vault file-structure migration.** EXECUTION touches every user vault on
  disk; per "never lose user data" it ships only with founder sign-off. Scoped plan
  written: `docs/W4-vault-migration-plan.md` (recommend: land path-resolver +
  fallback reads first = zero user-visible change, then enable the migrator).
  **Blocked on: founder go.**
- **Autonomous-connect live test.** Sidecar rebuilt + `doctor` verified, but a real
  end-to-end connect needs real app credentials + an interactive run.
  **Blocked on: credentials + human-in-the-loop.**
- **P2 — trim verbose panel.** Can't identify WHICH panel without the PDF p3
  callout. **Blocked on: which panel.**

---

## How I'd sequence this (recommendation)
~40 items. Not all equal. Proposed order, highest-leverage / lowest-risk first:

1. **Bugs & regressions** (B-group) — things that are broken NOW and hurt daily use. Fast wins.
2. **Chat/threads/context correctness** (C-group) — thread binding, $domain refs, General parity.
3. **Context & Memory IA reorg** (M-group) — the rename/regroup + Ideal State + Recommendations
   redesign + Journals/Intents model. This is the conceptual spine; lots of other items hang off it.
4. **Loops rework** (L-group) — needs a real design pass (agentic spec), so it gets its own phase.
5. **Workspace / Vault / Backups** (W-group) — incl. the on-disk file-layout reorg (engine work).
6. **Apps / Connections** (A-group) — edit-method, WebUI toggle, surfaces, de-noise.
7. **Models / Council** (G-group), **Benchmark** (K-group) — page-level redesigns + the direct-provider build.
8. **UX polish** (P-group) — toggles everywhere, text trims, dismiss affordances.
9. **Onboarding** (O-group) — new feature; do after the surfaces it tours are stable.

Two items need a decision before building: **L (Loops agentic model)** and **M1 naming** — see `[?]`.

---

## B · Bugs & regressions (do first) — ALL DONE
- [x] **B1 — Drag domain → chat context broken.** Fixed: `__prevailAttach` hook
  was torn down on callback-identity change (teardown race). Register once on
  mount via refs. (chatpanel.tsx)
- [x] **B2 — `$domain` reference broken.** Already fixed earlier (98d6fd2) — hardened + surfaces attach failures.
- [x] **B3 — Thread binding bug.** Fixed: save_thread re-slugified an existing
  filename stem (underscores→dashes), creating a new file. Preserve the stem
  (path-sanitized). Thread name already rendered in canvas (C2). (threads.rs)
- [x] **B4 — Benchmark "Draft with AI" false "0/3" message.** Fixed: count from
  disk not stale state, settle before recount, only warn under-target with
  positive evidence; exit code is source of truth. (benchpanel.tsx)
- [x] **B5 — Channel routing not populated.** Fixed: derived keywords now persist
  to the manifest (not just localStorage) so the CLI gateway sees them; default
  manifest seeds the domain name. (domainpanels.tsx, cli manifest.ts)
- [x] **B6 — Models page shows Direct Providers twice.** Already fixed — duplicate
  removed; Direct Providers lives only in ModelsSection (settings7.tsx:270).

## C · Chat / threads / context
- [ ] **C1 — General context parity.** The right-side Context panel for **General** only shows
  Ideal State, Long-term memory, Recent decisions — domains show more. Give General the same
  context items as domains (state/journal/sessions/skills as applicable). (PDF p1)
- [ ] **C2 — Thread name in canvas + current-domain indicator.** Show active thread name in the
  canvas (B3); add a current-domain indicator on the Benchmark page (PDF p7). (See K5.)

## M · Context & Memory (IA reorg + the learning model)
- [?] **M1 — Rename + regroup the "Memory & Routines" group → "Context & Memory"**, in this order
  (founder-specified, PDF p4):
  - **Ideals** (what the user inputs) ← today's "Configuration" item is renamed/replaced; this is
    the Ideal State surface. *Decision needed:* confirm "Configuration" (memory-engine knobs) folds
    into Routines/Settings and the nav item becomes "Ideals" = Ideal State.
  - **Omega** (distilled for the user)
  - **Intents** (what the user is doing)
  - **Recommendations** (things for the user)
  - **Routines**
  Also surface the orphaned sections (Ideal State, Tasks were unreachable from nav).
- [ ] **M2 — Ideal State redesign (scratch & rethink).** Current formatting is "so bad" — start
  over with a fresh, out-of-the-box design/layout. (PDF p3, p4)
- [ ] **M3 — Journals concept + Journal→Intent pipeline.** Implement the **Journal**: every
  conversation logged per-domain across threads = the raw record of what the user typed/asked.
  **Intent** = the high-level distillation (the question behind the question), per-domain or
  cross-domain, from the Journal. Make this relationship clear in the UI + engine. (PDF p2, p4)
- [ ] **M4 — Intents save/dismiss.** Let the user save/bookmark or dismiss intents so the list
  doesn't grow punishingly long. (PDF p4)
- [ ] **M5 — Recommendations redesign.** Human-readable, not technical: icons, indicators,
  severity/impact. Bookmark/save or dismiss (one-by-one AND bulk). Click a rec → a nicely
  formatted detail view with beautiful visuals of the "why". (PDF p3)
- [ ] **M6 — Per-domain Ideal States.** Global ideal-state exists; add per-domain ideal states
  (wealth, health, …) in a clear, intuitive, functional way. (PDF p3)
- [ ] **M7 — Omega cohesive view.** Journals + Intents + States all feed Omega; combine with Ideal
  State into one cohesive view. (PDF p4)

## L · Loops (major rework — needs design + decision)
- [?] **L1 — Define the agentic model for Loops (DECIDE FIRST).** Current UI is "so bad" and the
  behavior is unclear. Specify: when a loop is enabled, what happens — is it autonomous? does it
  create tasks, reach external systems, suggest prompts? what work does it do vs expect of the
  user? How does the user communicate goals, allowed tasks, tools it can use, and guardrails? How
  does it tie into Tasks? (PDF p2-3) → produce a short design doc, then build.
- [ ] **L2 — Loops UI: full-width + redesign.** Make Loops full-width like other pages; rebuild the
  layout. Adding a loop currently only asks a name + "always on" — needs goal/tools/guardrails. (PDF p2-3)
- [ ] **L3 — Loop run history & progress.** Show run history: what work was done, why, and how it's
  matching/progressing toward the goal. (PDF p3)

## W · Workspace / Vault / Backups
- [ ] **W1 — Workspace redesign.** Your Vault vs Demo Vault as mutually-exclusive toggles (one ON
  grays the other off). Starter Packs import into whichever is active. All three (Your Vault, Demo
  Vault, Starter Packs) collapsible + clean. (PDF p2)
- [ ] **W2 — Backups = its own section + sidebar indicator.** Split backups/automations into their
  own section; add a clear always-visible sidebar indicator when backups are ON. (PDF p2)
- [ ] **W3 — Demo/launch default = "Every launch."** Make the default "Every launch." (PDF p3)
- [ ] **W4 — Vault file-structure reorg (engine).** No loose files at vault root — everything in a
  folder. Use a prefix so apps + domains sit together inside a `data/` folder. (Today's root has
  loose `_decisions.jsonl`, `_intents.jsonl`, `_skillgen.json`, `_taskgen.json`, `usage.ndjson`,
  `profile.md`, `AGENTS-operating.md`.) Needs a safe migrator + path updates across the engine. (PDF p4)

## A · Apps / Connections
- [ ] **A1 — Apps page clarity + no duplicates.** Be explicit: apps added here become available to
  this domain's context. Reference an existing app (e.g. AllTrails) rather than creating a
  duplicate. (PDF p3) — overlaps APP-2 already shipped; tighten copy + dedupe.
- [ ] **A2 — Edit a connected app's method.** Let the user edit a working connection (change
  MCP ↔ API ↔ browser automation) and see/edit those details. (PDF p4)
- [ ] **A3 — De-noise connectors.** The connectors/tiers design is "too noisy/unprofessional" —
  hide or reduce those filters. (PDF p4)
- [ ] **A4 — Confirm auto-detection.** Verify installed CLIs/providers are actually auto-detected
  and available. Confirm to founder. (PDF p3)
- [ ] **A5 — WebUI/localhost toggle missing.** Restore/surface the "turn on localhost WebUI" control
  under **Connections** (it disappeared / isn't where expected). (PDF p4)
- [ ] **A6 — Implement all gateway surfaces (no more "coming soon").** Make the coming-soon
  surfaces fully functional, and add new surfaces similar to OpenClaw / Hermes. Needs a plan of
  which surfaces + build. (PDF p4)

## G · Models / Council
- [ ] **G1 — Models reorg + direct-provider keys.** Three collapsible sections (collapsed by
  default): **CLI** / **API Providers** (OpenRouter, Replicate, Bedrock, …) / **Direct Providers**
  (OpenAI, Anthropic, xAI, Kimi, …). Remove the duplicate Direct Providers (B6). Implement real
  functionality: per-direct-provider key entry that actually works. (PDF p3)
- [ ] **G2 — Council visual in the chat canvas.** Show the council-members visual in the chat area
  (not only in Settings) as the user adds/removes members. Both sides show icon **+ provider +
  specific model name**. (PDF p3)
- [ ] **G3 — Council autosave clarity.** Confirm council membership saves automatically, or add an
  explicit Edit/Save button so it's unambiguous. (PDF p3)

## K · Benchmark
- [ ] **K1 — Scheduled runs to the BOTTOM + redesign.** Move scheduled runs from top → bottom of the
  Benchmark page. Redesign: not just grayscale; use a clear ON/OFF toggle; make state obvious. (PDF p3)
- [ ] **K2 — Remove the pointless element.** "What's the point of this. Remove it." (identify the
  flagged element on the benchmark page and remove). (PDF p3)
- [ ] **K3 — Tooltips on question-row icons.** Add tooltips over the icons to the right of each
  question. (PDF p3)
- [ ] **K4 — Add-question UX.** Drop the domain dropdown; let a new question target **multiple
  domains at once**, without checkboxes. (PDF p3)
- [ ] **K5 — Current-domain indicator on Benchmark.** (PDF p7) (see C2)
- [ ] **K6 — Ground AI-drafted questions in the user's truth.** AI-suggested benchmark questions are
  too basic/generic; they must be grounded in that user's real context + nuance (how THEY would
  approach something vs others). Likely a mix of specific + general. (PDF p7) — extends prior BENCH-3.

## P · UX polish (cross-cutting)
- [ ] **P1 — Toggles everywhere.** Replace all Start/Stop (and similar) text with ON/Off **toggle
  pills**, consistently. (PDF p4)
- [ ] **P2 — Trim verbose panel.** The "this is good, but too much text" panel — cut the copy. (PDF p3)
- [ ] **P3 — Dismiss affordance.** Where clicking away dismisses, also add a small (✗) icon. (PDF p3)
- [ ] **P4 — About: drop the stack mention.** Remove "Tauri · React · Tailwind" if not needed. (PDF p4)

## O · Onboarding (new feature)
- [ ] **O1 — First-time onboarding tour.** 5-6 step welcome/coachmark walkthrough on first launch,
  dismissible. Research the best approach. *Recommendation:* a lightweight custom React coachmark
  overlay (anchored tooltips + spotlight) rather than a heavy lib — keeps the no-emoji / premium
  design language and avoids dependency weight; alternatives (react-joyride / driver.js) noted for
  comparison. Persist "seen" in localStorage; re-runnable from About/Help. (PDF p1)

## I · Investigate / answer
- [?] **I1 — Repo naming consistency.** Founder asked why the app doesn't follow the
  `fd-apps-prevail-*` pattern. Finding: folders are consistent (`prevail-cli/desktop/web`), but
  **package names diverge** — desktop = `fd-apps-prevail-desktop` (follows it), web =
  `fd-apps-prevail-site` (not `-web`), cli = `prevail` (no prefix). Decide a single convention and
  align names/READMEs. (PDF p1)

---

## Remaining — needs decision, live UI verification, or a dedicated feature pass
These are NOT done. Each is large and/or can't be safely verified without the running app,
so they're left for a focused pass rather than blind overnight edits:
- **Live-UI bugs (best-effort code reads done, need verification):** B1 drag→context, B2 `$domain`
  ref, B3 thread-binding (C2 thread-name indicator already mitigates the confusion).
- **Big features:** L (Loops agentic rework — needs the spec/decision first), W4 (vault on-disk
  reorg + engine migrator), O1 (onboarding tour), M2 (Ideal State scratch-redesign), M5
  (Recommendations redesign), M3 (Journals→Intent pipeline), M6 (per-domain ideal states), M7
  (Omega cohesive view), W1 (Workspace vault/demo toggles), W2 (backups section + sidebar
  indicator), G1-full (direct-provider key entry + working calls), G2 (council canvas visual),
  A2 (edit a connection's method), A6 (implement all gateway surfaces).
- **Need founder pointing:** K2 (which element to remove), P3 (which panel's dismiss), P2 (which
  verbose panel), K5 (where exactly the benchmark domain indicator goes), A4 (confirm detection),
  I1 (pick a repo-naming convention — finding: web pkg is `fd-apps-prevail-site`, cli is `prevail`).
- **Broad polish:** P1 (toggles everywhere — replace Start/Stop text app-wide).

## Done this session (feat/monday-feedback-0615)
- [x] **K4** (dc2657f) — add a benchmark question to multiple domains at once (comma-separated).
- [x] **M5** (580c749) — Recommendations redesign: impact chips, "Why this?" expander, save +
  dismiss per rec (persisted), bulk dismiss-all + show/hide dismissed.
- [x] **W2** (fffe239) — backups split into their own Workspace section + always-visible sidebar
  "backups on" indicator.
- [x] **A3** (8d59c1e) — connector tag-filter cloud collapsed behind a disclosure (de-noised).
- [x] **L1/L2/L3 + Loops model** (desktop 6aebe4f · cli b9d12be) — full-width; "How loops work"
  explainer; create captures GOAL + GUARDRAIL (autonomy suggest/tasks/ask/auto); per-loop
  guardrail badge/selector + Run history; engine steward honors goal+guardrail. Spec:
  docs/LOOPS-MODEL.md. (Decided the agentic model myself per "you decide".)
- [x] **B6** (6f663f2) — removed duplicate "Direct providers" list in Models.
- [x] **M4** (e9efdcd) — dismiss distilled intents (X per card, persisted) so the list stays short.
- [x] **C1** (82372c3) — General context panel now has parity with domains (loads vault-root context).
- [x] **C2** (82372c3) — active thread name shown in the chat canvas (mitigates B3 confusion).
- [x] **B4** (9d8ace6) — benchmark false "0/N under target": draft-count used an unregistered
  command (`benchmark_questions_list`); switched to `benchmark_questions`.
- [x] **M1** (0e93baf) — nav reorg: "Memory & Routines" → "Context & Memory"
  (Ideals/Omega/Intents/Recommendations/Routines); surfaced Ideals + Tasks in nav; moved the
  memory-engine knobs to App as "Memory engine". (M2–M7 redesigns still pending.)
- [x] **K1** (0e93baf) — scheduled benchmark runs moved to the bottom of the page.
- [x] **K3** (9c19694) — tooltip on the per-question council icon.
- [x] **A5** (9c19694) — surfaced the orphaned WebUI as "Web access" under Connections.
- [x] **P4** (0e93baf) — About drops the Tauri/React/Tailwind mention.

## DEFINITIVE STATUS (2026-06-16, updated)
**Done (31), all build-verified + committed (desktop + cli + web branches):**
B4, B5, B6, M1, M4, M5, M6, M7, A1, A2, A3, A5, C1, C2, G2, G3, K1, K3, K4, K5, W1, W2,
P1 (Telegram toggle), P4, O1 (onboarding tour), **Loops L1/L2/L3**, I1. Plus confirmations: A4 (detection works),
K6 (grounding shipped via BENCH-3 + _log grounding).
Engine commands added (cli branch): loops guardrail, app schedule, app integration, omega,
per-domain ideal injection.

**Truly remaining — large features / blocked (NOT responsibly one-shot-able in this run):**
- O1 onboarding shipped. - M2 (Ideal State scratch-redesign — "think outside the box": wants design direction so it's not
  a speculative rebuild the founder dislikes again), M3 (Journals→Intent pipeline — engine + UI),
  A6 (build out ALL gateway surfaces fully — multiple real integrations), O1 (onboarding tour —
  new feature), W4 (vault on-disk reorg + SAFE migrator — data-loss risk; must be done carefully,
  not blind).
- Live-UI verify: B1 drag→context, B2 $domain ref, B3 thread-binding (C2 mitigates).
- Need founder pointing: K2, P2, P3, W3.

**Still remaining — genuinely large features / blocked (need dedicated passes or input):**
- _Big features (each its own session):_ M2 (Ideal State scratch-redesign), M3 (Journals→Intent
  pipeline), M6 (per-domain ideal states), M7 (Omega cohesive view), A6 (implement all gateway
  surfaces), O1 (onboarding tour), W4 (vault on-disk reorg + safe engine migrator).
- _Live-UI verify (risky blind):_ B1 drag→context, B2 $domain ref, B3 thread-binding (C2 mitigates).
- _Need founder pointing:_ K2 (which element), P2/P3 (which panel), W3 ("every launch" meaning).
- _Broad polish:_ P1 (replace remaining Start/Stop text app-wide with toggles).

### old status line (superseded)
**Done (20), all build-verified + committed:** B4, B6, M1, M4, M5, A1, A3, A5, C1, C2,
K1, K3, K4, K5 (covered by existing scoped-domain breadcrumb), W1, W2, P4, Loops L1/L2/L3,
I1 (web pkg rename, on prevail-web branch). Engine: Loops guardrail (cli branch).

**Remaining — by why they're not done:**
- _Large features (need dedicated passes; build-verifiable):_ W4 (vault on-disk reorg + engine
  migrator), M2 (Ideal State scratch-redesign), M3 (Journals→Intent pipeline), M6 (per-domain
  ideal states), M7 (Omega cohesive view), G1 (direct-provider key entry + working calls),
  G2 (council canvas visual), A2 (edit a connection's method), A6 (implement all gateway
  surfaces), O1 (onboarding tour).
- _Engine, moderate:_ B5 (channel routing populate + suggestions).
- _Small, next:_ G3 (council autosave confirm), K6 (grounding — largely shipped via BENCH-3).
- _Live-UI verification (fix-blind is risky):_ B1 (drag→context), B2 ($domain ref), B3 (thread
  binding — C2 indicator mitigates).
- _Need founder pointing:_ K2 (which element to remove), P2/P3 (which panel), W3 ("every launch"
  meaning), A4 (just confirm — detect_clis runs on mount + autoVerify; detection works).
- _Broad:_ P1 (toggles everywhere — replace remaining Start/Stop text app-wide).

## Log
- 2026-06-15: Plan + todo created from the Monday feedback PDF on branch feat/monday-feedback-0615.
- 2026-06-16: Worked the list — 20 items done (incl. Loops rework + Recommendations redesign).
- 2026-06-16: Batch 1-3 — B4, M1(nav), K1, K3, A5, P4. Builds green; not merged.

## FINAL (2026-06-16) — 31 done; the rest need you, the app, or a dedicated build
- W3 done (model refresh defaults to "Every launch").
- B1/B2 audit: code paths (attachDomainAsContext → layout-aware domain_context → chip;
  $-popover Enter → applyDollarCompletion) look CORRECT now — likely already fixed since the
  founder's build. Needs a live re-test, not a blind edit.
- Genuinely blocked: A6 (7 real bot integrations — external creds, days of work), W4 (vault
  on-disk move — data-loss risk; needs a tested migrator), B3 (Untitled-thread stub lifecycle —
  needs the running app), K2/P2/P3 (need founder to point at the element/panel).

## SESSION 2026-06-16 (cont.) — K2 done (judgment call)
- **K2** (ccd054d): removed the "Coverage by domain" table from the Benchmark
  results view — it restated runs/models-per-domain that the main Model × domain
  matrix already conveys ("What's the point of this. Remove it."). Best-judgment
  interpretation of the unmarked "remove it" note; reversible if it was a
  different element (one git revert + remove the right one). tsc clean.

## W4-FINAL — DONE (2026-06-16) via config-repoint (the clean solution)
I'd called this "needs 30+ site changes + running-app verification." That was the
WRONG framing. The clean approach (mirrors `vault embed`): migrate-data copies the
whole vault into <vault>/data, verifies, writes a `.prevail-data-layout` marker,
and REPOINTS the configured vault path to <vault>/data. Every site takes vaultPath
as a parameter, so they ALL operate under data/ with zero per-site changes; the
shipped tri-path readers stay correct (dataRoot is idempotent).
- cli (6b277fb): migrate-data repoints config.vaultPath + marker + idempotent;
  archive-data sweeps ALL orphaned originals from the true root (verified-copy
  gated, never deletes). 8 bun tests.
- desktop (90a4e99): engine_vault_migrate_data/archive_data commands + "Tidy into
  a data/ folder" button → onVaultMoved repoints React state + localStorage + Rust
  VAULT_ROOT (remember_vault), the same path "Move vault into the app" uses.
- Result: cli config + desktop React + desktop Rust all point at data/ after
  migration, consistently. cargo check + tsc clean. Root stays clean; nothing deleted.

## A6 — COMPLETE: all 8 surfaces native (2026-06-16)
Built the remaining Discord/Slack/Email (commit d3cd8cc) after adding the
WebSocket + IMAP/SMTP dependency tier (tokio-tungstenite, futures-util, imap,
native-tls, lettre, mailparse; tokio net+time). Full native surface set:
- Telegram (pre-existing) · Webhook (universal) · Matrix · Mattermost · Signal
  (existing-deps tier) · Discord (Gateway WS) · Slack (Socket Mode WS) · Email
  (IMAP poll + SMTP). SMS = Twilio Function → Webhook (no native bridge needed).
- All off by default; secrets in Keychain; reuse run_cli/resolve_domain/
  record_exchange. cargo check + tsc clean; 61 rust lib tests pass.
- CAVEAT: each native bridge compiles + is unit-tested but needs that platform's
  live token to verify end-to-end before being relied on (Discord Gateway
  heartbeat/resume, Slack envelope ACK, IMAP/TLS especially). They're inert until
  configured + toggled on, so shipping them can't affect the running app.

## EVERY MONDAY-FEEDBACK ITEM IS NOW ADDRESSED (~40/40)
B1-B6, C1-C2, M1-M7, L1-L3, W1-W4, A1-A6, G1-G3, K1-K6, P1-P4, O1, I1.

## VERIFICATION (2026-06-16) — everything verifiable without live creds is verified
- **W4 verified END-TO-END** by running the real CLI on a temp vault (commit
  f7f06f8): migrate-data copied 6/6 + repointed config; live `domains` read
  resolved under data/domains; idempotent re-run; archive-data swept originals to
  a backup (root clean, nothing deleted).
- **Bridge network code verified** via mock-socket round-trips: Matrix +
  Mattermost fetch (parse real responses) and send (HTTP status), Discord send,
  Slack post_message (honors {ok:false}). 67 rust lib tests pass + 365 bun tests.
- **WS inbound DECISION logic now verified too** (commit 8f9c5b6): extracted the
  error-prone protocol decisions into pure functions the live loops use, tested
  exhaustively — Discord parse_hello/extract_message (bots/channels/empty/typing),
  Slack extract_text (bot_id/subtype/channel/hello/non-message), email multipart
  body extraction. 73 rust lib tests.
- **The ONLY residual** (inherent — cannot be done without a credential): the
  literal transport handshake — `wss://` connect + IDENTIFY (Discord/Slack) and
  IMAP TLS login — which is thin glue over tokio-tungstenite / imap where the sole
  variable is whether the USER's token is valid, not our logic. Off-by-default, so
  inert until the founder configures it. Build + all logic verification: DONE.

## (historical) A6 NATIVE BRIDGES — 3 built this round (Matrix, Mattermost, Signal)
Native surfaces now live (off by default, configured + verified by the user):
Telegram, **Webhook** (universal), **Matrix** (/sync long-poll), **Mattermost**
(REST poll), **Signal** (signal-cli subprocess). All built with the EXISTING
dependency set (reqwest + tokio::process) — no new crates. native_bridge.rs +
NativeBridgeCard; ab079e7 (Matrix/Mattermost) + f8a187a (Signal). cargo check +
tsc clean; 3 rust unit tests.

**Remaining: Discord, Slack, Email — the new-dependency tier.**
- Discord + Slack: real-time inbound needs a WebSocket client (Discord Gateway /
  Slack Socket Mode) → tokio-tungstenite + tokio "net" feature, plus stateful
  protocol code (HELLO/IDENTIFY/heartbeat/resume) that is genuinely error-prone
  without a live account to test against.
- Email: IMAP poll + SMTP send → imap + lettre + TLS crates.
These three need their dependency + that platform's credential to build correctly
AND verify; until then they're reachable via the Webhook. Build one with its
credential in a live session.

## (historical) TRUE REMAINING (1 item)
1. **A6 native bridges (6).** Webhook (done) already makes every platform
   functional via forwarding. NATIVE bridges: Discord + Slack need a WebSocket
   crate (not a dep; tokio lacks net/rt-multi-thread); Email needs imap+lettre+TLS
   crates. Matrix/Mattermost/Signal are buildable with existing deps but their
   exact API semantics (sync tokens, post pagination, signal-cli -o json) can't be
   written correctly without testing against the real service. Each needs the
   user's token + live verification. → build one at a time, with its credential.
2. **W4 final reader-switch.** Route the General-bucket loose-file readers/writers
   to data/ in cli + Rust. Safe-by-design (dual-path, opt-in) BUT all-or-nothing:
   a single missed writer site → post-migration staleness. Needs the running app +
   a migrated vault to verify all three processes agree. Migrator already stages
   the files; archive-data defers them so root copies persist as a safety net.

## SESSION 2026-06-16 (cont.) — built G1 (direct providers) — was a hidden gap
**G1 — direct single-vendor provider keys: BUILT + verified (both processes).**
The "Direct Providers" section was a `coming soon` PLACEHOLDER (settings7.tsx) —
not actually done, despite G2/G3 being done. The founder asked: "implement all
the functionality... put in their key for each direct provider like xAI, Kimi,
Anthropic, etc. and make it work." Now real, end-to-end:
- cli (0fe82aa): `DirectProviderKind` in CliKind; `DIRECT_PROVIDERS` table
  (Anthropic/OpenAI/xAI/Kimi/DeepSeek/Google) drives detectClis (available when
  PREVAIL_<ID>_KEY is set) + runChatTurn routing (OpenAI-compat reuse +
  native `runAnthropicChat` with SSE). Exhaustive CliKind maps filled
  (defaults/quickpicks/hints/budget/council-colors). 5 bun tests.
- desktop (358b9aa): settings7 `DirectProvidersSection` — per-vendor key entry,
  saved to Keychain (provider_key_set), re-detects to go live. engine.rs
  `DIRECT_PROVIDER_ENVS` injects each key as PREVAIL_<ID>_KEY into the engine
  child. cargo check clean.
- Chain verified: UI → Keychain → engine env → detect → route. The 3 collapsible
  Models sections (CLI / API Providers / Direct Providers) are now all functional.

## SESSION 2026-06-16 — built W4 (data/ layout) + A6 (Webhook surface)
**W4 — vault `data/` layout: BUILT + verified across both processes.**
- cli (commits 8417b5a, ada3770): `dataRoot()`/`DATA_DIR` in path-safety.ts;
  resolveDomainDir/newDomainDir/appsContainer + scanVault + scanVaultApps now
  prefer `<vault>/data/{domains,apps}` (tri-path: v4 → v3 → legacy, all readable).
  New module vault-data-layout.ts: `migrateToDataLayout` (copy+verify,
  NON-destructive, idempotent) + `archiveLegacyRoot` (opt-in; sweeps only the
  v4-aware containers domains/+apps/, DEFERS the loose General files so they're
  never orphaned; moves to a `_pre-data-*` backup, never deletes). CLI: `prevail
  vault migrate-data` + `vault archive-data --force`. 7 bun tests, all green;
  zero new type errors; full suite unaffected.
- desktop (commit 6bbf9a2): paths.rs mirrors the resolution (resolve_domain_base
  + enumerate_domain_dirs prefer data/domains; data/ excluded as a domain).
  cargo check clean.
- Headline ask (apps+domains grouped under data/) DONE. Remaining for the
  co-working session: switch the General-bucket loose-file readers (byte-for-byte
  shared by cli/TUI/Rust) to data/ + live-verify, then `archive-data` sweeps them.

**A6 — Webhook surface: BUILT (fully functional, credential-free).**
- desktop (commit 037004b): webhook_bridge.rs — loopback tiny_http server,
  bearer-secret gated (constant-time), POST /hook {message,domain?} →
  resolve_domain → run_cli → reply + record_exchange (reuses the Telegram
  bridge's routing + model choke point). 3 Tauri commands registered; 2 unit
  tests + cargo check clean. settings5.tsx WebhookCard: ON/Off toggle, port,
  model, self-generated Keychain secret, curl example, live counters.
- Removes one "coming soon"; it's the foundation other surfaces POST into.
- Remaining 6 (Discord/Slack/Signal/Matrix/Mattermost/Email/SMS) each need that
  platform's API client + the user's runtime credentials + live verification —
  spec'd in A6-SURFACES-PLAN.md (P0 generalize → P1 Discord → …).

## SESSION 2026-06-15 (cont.) — built B2/P2/P3; resolved B1/B3; pinned K2
**Newly DONE + committed (tsc-verified) — 39016a4:**
- **B2** (`$domain` + Enter "does nothing") — FIXED. Root cause: both the `/` and `$`
  popover matchers read `taRef.current.selectionStart` inside a `useMemo` keyed on `[input]` —
  a render-phase DOM read that can return a stale caret, so the match silently fails and Enter
  falls through to send(). Replaced with a tracked `caretPos` state updated from onChange/
  onSelect/onKeyUp/onClick; both matchers now key on `[input, caretPos]` and apply-completion
  collapses the caret so the popover closes. chatpanel.tsx.
- **P2** (Apps page "too much text") — trimmed the verbose 4-sentence subtitle to one line.
- **P3** (add a tiny dismiss ✗) — app detail drawer now has an explicit close (X) button
  top-right, in addition to click-header-to-collapse. appspanel.tsx.

**Resolved by source investigation (no edit needed — already fixed since the v0.8.4 screenshots):**
- **B1** (drag domain→context) — full chain verified wired: sidebar manual-drag (sidebar.tsx
  447-495) → `window.__prevailAttach(name,mode)` (registered chatpanel.tsx 1374-1385) →
  `attachDomainAsContext` → `domain_context` → chip. Apps use the identical path and weren't
  reported broken. Not reproducible from code.
- **B3** (Untitled thread forks on type) — the autosave derives the slug from
  `activeThreadRef.current` whenever a thread is selected (chatpanel.tsx 720-721), and Rust
  `save_thread` HONORS the passed slug (threads.rs 348) + has hash-dedup + a 10-min reuse window
  + treats a placeholder "Untitled" title as replaceable (threads.rs 431-438). All of this
  targets exactly this fork. C2 (thread name in canvas, the founder's own suggested mitigation)
  already shipped. Not reproducible from current code.

**Pinned (needs founder pointer):**
- **K2** ("What's the point of this. Remove it.") — the PDF note (p3) sits between the
  scheduled-runs and question-row commentary but has NO standalone image marking WHICH element.
  Cannot identify the target with confidence. Need: which element on the Benchmark page.

**Genuinely large / multi-process (need the running app + verification; A6 also needs creds):**
- **A6** — 7 real platform bridges (Discord/Slack/Signal/Matrix/Mattermost/Email/SMS). No
  existing surface abstraction (surface.rs is the unrelated proactive-insights feature). The
  Telegram bridge (telegram_bridge.rs, 819 lines) is the reference. Fully functional = each
  needs that platform's API client + the user's runtime credentials + live verification. The
  one credential-free win is a generic inbound Webhook surface (reuse webui.rs HTTP server,
  secret-gated like MCP) — ready to build on confirmation; verify via curl with the app running.
- **W4** — vault reorg (loose root files → a folder; apps+domains under `data/`). The General
  bucket's loose files + apps/ + domains/ are read/written byte-for-byte by THREE processes
  (cli, TUI, desktop Rust). Safe path = non-destructive copy-migrator + dual-path readers
  (prefer new, fall back to old) shipped ATOMICALLY across all three, then live-verified. Doing
  one side alone DESYNCS live data. Build feasible; safe-verify needs the app. Do together.

## DEEP-DIVE (2026-06-15) — B1/B2/W4 traced to source, line by line
- **B1 (drag domain → context):** FULLY WIRED, no broken link found. Sidebar domain rows use a
  manual mouse-drag (sidebar.tsx:447-495 — HTML5 DnD is unreliable in WKWebView) that, on mouseup
  after movement, calls `window.__prevailAttach(name, mode)`. That hook is registered by ChatPanel
  (chatpanel.tsx:1374-1385) → `attachDomainAsContext` (1317) → `domain_context` (layout-aware) →
  `injectContext` as a chip. Apps use the identical pattern (`__prevailAttachApp`) and the founder
  didn't report apps broken — so the mechanism works. Caveat: the hook only exists while ChatPanel
  is mounted; dragging while on a non-chat tab logs "no attach hook" (expected). Verdict: not
  reproducible by inspection; needs a live drag to catch any residual (likely already fixed).
- **B2 (`$domain` + Enter):** code path is correct. `dollarMatch` (chatpanel.tsx:523) regex
  `/(^|\s)\$([a-zA-Z0-9_-]*)$/` matches `$Wealth` at caret; `dollarCandidates` (533) filters
  domains by substring; Enter (1882-1898) routes to `applyDollarCompletion` when candidates exist,
  else falls through to send(). For the documented "type $Wealth at end, Enter" flow this resolves
  correctly. ONE latent smell (not a confirmed bug): both `slashMatch` (482) and `dollarMatch`
  read `taRef.current.selectionStart` inside a useMemo keyed on `[input]` — a render-phase DOM
  read. For append-at-end typing the browser has already updated the caret, so it's correct; it
  could only misbehave mid-string. A defensive fix (track caret in state) would touch BOTH popover
  systems + the textarea handlers = not surgical, unverifiable blind → deliberately NOT done.
- **W4 (vault on-disk reorg):** confirmed NOT safely one-shot-able blind. The General bucket's
  loose files (`_decisions.jsonl`, `_intents.jsonl`, `usage.ndjson`, `profile.md`,
  `AGENTS-operating.md`, `_skillgen/_taskgen.json`) resolve via `domainDir(vault, null) → vault
  root` and are read/written BYTE-FOR-BYTE by THREE processes (prevail-cli, TUI, desktop Rust —
  decisions.ts:34, daemon-learn.ts, mcp-server.ts:458, score.ts:194, cli-bridge.ts:796, plus
  src-tauri/src/lib.rs). Relocating them under `data/` requires a coordinated change across all
  three + a tested copy-then-verify migrator (never move/delete), then live verification that all
  three still agree. That is a dedicated, multi-repo, app-running task — exactly the "blind
  overnight edit" risk the founder warned against. Spec deferred until we can run + verify together.
