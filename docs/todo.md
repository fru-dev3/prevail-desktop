# Monday Feedback — 2026-06-15 · Plan & TODO

**Source:** `~/Downloads/Prevail - Monday Feedback 06.15.2026.pdf`
**Branch:** `feat/monday-feedback-0615` · **Mode:** PLAN ONLY until founder says "go".
Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[?]` needs founder input

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

## B · Bugs & regressions (do first)
- [ ] **B1 — Drag domain → chat context broken.** Used to be able to drag a domain from the left
  sidebar into the chat context; no longer works. (PDF p5)
- [ ] **B2 — `$domain` reference broken.** Typing `$Wealth` (etc.) to add/reference a domain in the
  composer + Enter does nothing. (PDF p5)
- [ ] **B3 — Thread binding bug.** Selecting an empty "Untitled" thread and typing spawns a NEW
  thread named after the prompt, leaving the Untitled one. Conversations must stay strictly tied to
  the selected thread (even untitled). Also: show the thread name in the chat canvas so there's
  never confusion about which thread you're in. (PDF p6)
- [ ] **B4 — Benchmark "Draft with AI" false "0/3" message.** Drafting questions for a domain shows
  "Drafted 0/3 · under target" while the questions ARE actually generated. Fix the
  count/messaging (likely the added-count diff vs the generated questions). (PDF p8)
- [ ] **B5 — Channel routing not populated.** The per-domain channel/routing keywords aren't being
  filled. Fix, and add relevant contextual suggestions. (PDF p2)
- [ ] **B6 — Models page shows Direct Providers twice.** Duplicate section. (PDF p3 — folded into G1)

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

## DEFINITIVE STATUS (2026-06-16)
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
