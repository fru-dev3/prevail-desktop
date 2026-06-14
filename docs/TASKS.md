# Prevail Desktop — Active Task List

**Branch:** `ui-polish-post-081` · **Version line:** 0.8.x (patch-forever; never 0.9 without explicit go)
**Source:** Founder feedback batch, 2026-06-14 (09:10–10:44 am)
**Rule:** Do NOT merge to main or release until founder says so. Stay on feature branch.

This file is the crash-safe source of truth. Update statuses here as work proceeds.
Status legend: `[ ]` todo · `[~]` in progress · `[x]` done (committed) · `[?]` needs verify

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
