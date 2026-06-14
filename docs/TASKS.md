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

- [ ] **T2 — Council redesign (creative).** Make it visually compelling, not a list.
  - Visual circle/diagram of who is in the council
  - Clearly show who the CHAIR is
  - Animate / visually update when members are added
  - Be genuinely creative with the design; explain why the council matters.

- [ ] **T3 — Skills page.** 
  - Too colorful — tone it down.
  - Add filter to view skills BY DOMAIN (don't force showing skills for only one domain).
  - Make "edit a skill" make sense / better workflow.
  - Keep skill auto-suggest in chat (he likes it) but improve the design.

- [x] **T4 — "Run now" broken (Scheduled runs).** FIXED (96de.. cards.tsx): silent no-op
  now reports back (busy state + success/empty/error messages); fixed "just now ago" /
  "~6 days ago" time-wording glitches via new formatDuration. Deeper visual redesign of the
  card can still follow if wanted.

- [ ] **T5 — Benchmark: suggest-questions design + all-domains guarantee.**
  - [x] BUG FIXED (96de.. benchpanel.tsx): "all domains" loops per-domain so every domain
    gets N questions, verifies each, reports failures/shortfalls.
  - [ ] Improve the design/layout of the suggest-questions UI.

- [ ] **T6 — Benchmark history/statistics accuracy.**
  - Stats look inaccurate (ran ~50 questions across all domains; numbers seem wrong).
  - Track EVERY benchmark run per domain accurately.
  - Show all batches that have been run.
  - Domain view: how many times benchmarked, against how many models.
  - Model view: how many benchmarks run against it, across how many domains.
  - Audit all angles; fix the counting.

- [x] **T7 — Ideal State page formatting.** REDESIGNED: calm single-column section cards
  (icon chip + title, indented body), quiet left-border intro lead, prominent title, version
  history via canonical CollapsibleSection. (settings4.tsx)

- [ ] **T8 — Apps/Connectors page redesign.**
  - Separate into clear sections/tabs by connectivity tier:
    - API / MCP connectors
    - Tool-based (Composio, etc.)
    - Manual browser automation
  - Sections collapsible so user can focus on their chosen mode.
  - Rethink design + positioning fundamentally.

- [~] **T9 — Refresh-cadence picker flexibility.**
  - DONE for model-refresh: `RefreshCadence` (settings7) is already a custom on-brand
    popover with presets + an "every N days" field (1-365). Not a native dropdown. Meets the ask.
  - REMAINING: the native daily/weekly/monthly `<select>`s on Scheduled Benchmarks (cards.tsx)
    and Backup (settings8) are the other likely "amateurish dropdown". Applying a flexible
    "every N days" there needs scheduler-logic changes (BENCH_FREQ_MS / backup freq keyed by
    preset). Do deliberately; confirm which screen the founder meant if unsure.

## Intent (needs a plan, then build)

- [ ] **T10 — Intent: from raw-prompt log → distilled recommendations.**
  - Today intents look like just a list of prompts. Define the bigger purpose.
  - Drill down into an intent → get recommendations/actions out of it.
  - Infer HIGH-LEVEL intent across sessions/domains (e.g. "Is Toyota better than Honda?"
    → underlying intent = "looking for transportation", then probe job/use context).
  - Distill into broader recommendations for action.
  - DELIVERABLE FIRST: a written plan + recommendations before building.

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

- [ ] **T14 — Frameworks / Ingestion page.** "Too big, too noisy." Convert into collapsible
  sections following the canonical collapsible rules; clear + intuitive on landing, not busy.
  (settings1.tsx FrameworksSection/IngestionSection.)

- [ ] **T15 — Telegram / Gateway page redesign.** Improve design (image #6 prior session).

- [ ] **T16 — Vault folder layout.** In the vault folder, `apps/` and `domains/` should be
  siblings at the same level inside the vault folder.

- [ ] **T17 — Mystery screenshot (image #17).** "Improve this design." Page unknown — ASK which
  screen this was before acting.

---

## Decisions (founder, 2026-06-14)
- T10 Intents: BUILD NOW, phased (daemon + storage → drill-down UI → wire into taskgen/loops).
- Sequence: VISUAL CONSISTENCY FIRST (T1 canonical-collapsible migration) → per-page redesigns
  → benchmark accuracy (T6) → Intents build (T10).

## Log
- 2026-06-14: Task list created from founder feedback batch.
- 2026-06-14: Fixed T5 (all-domains suggest), T4 (Run now + time wording). Verified T11, T12.
- 2026-06-14: Founder chose: build Intents (phased), visual consistency first. Starting T1 migration.
