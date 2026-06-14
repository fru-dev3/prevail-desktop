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

- [~] **T1 — Collapsible component consistency.** ONE canonical collapsible used everywhere.
  Component BUILT (`src/collapsible.tsx`). REMAINING: migrate all hand-rolled call sites
  (benchpanel, settings7, settings4, settings6, settings8, panels, ui, councilpanel, sidebar)
  to it so every page looks identical.
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

- [ ] **T4 — "Run now" broken + redesign (Daemons/Scheduled).**
  - BUG: clicking "Run now" does nothing even when the daemon is toggled on. Fix it.
  - Make it clear what SHOULD happen when clicked (feedback/progress).
  - Redesign — current design is weak.

- [ ] **T5 — Benchmark: suggest-questions design + all-domains guarantee.**
  - [~] BUG (in progress, uncommitted in benchpanel.tsx): "all domains" must generate N
    questions for EVERY domain. If user says 8, every domain gets 8. Per-domain loop +
    verify each domain received its count. (Finish + commit.)
  - [ ] Improve the design/layout of the suggest-questions UI.

- [ ] **T6 — Benchmark history/statistics accuracy.**
  - Stats look inaccurate (ran ~50 questions across all domains; numbers seem wrong).
  - Track EVERY benchmark run per domain accurately.
  - Show all batches that have been run.
  - Domain view: how many times benchmarked, against how many models.
  - Model view: how many benchmarks run against it, across how many domains.
  - Audit all angles; fix the counting.

- [ ] **T7 — Ideal State page formatting.** Current formatting looks bad. Redesign cleanly.

- [ ] **T8 — Apps/Connectors page redesign.**
  - Separate into clear sections/tabs by connectivity tier:
    - API / MCP connectors
    - Tool-based (Composio, etc.)
    - Manual browser automation
  - Sections collapsible so user can focus on their chosen mode.
  - Rethink design + positioning fundamentally.

- [ ] **T9 — Refresh-cadence picker flexibility.**
  - Current dropdown looks basic/amateurish — replace with a more robust selector.
  - Must support arbitrary cadences like "every 3 days" (not a fixed preset list).
  - (Commit eecf0b3 added a "flexible refresh-cadence picker" — verify it meets this.)

## Intent (needs a plan, then build)

- [ ] **T10 — Intent: from raw-prompt log → distilled recommendations.**
  - Today intents look like just a list of prompts. Define the bigger purpose.
  - Drill down into an intent → get recommendations/actions out of it.
  - Infer HIGH-LEVEL intent across sessions/domains (e.g. "Is Toyota better than Honda?"
    → underlying intent = "looking for transportation", then probe job/use context).
  - Distill into broader recommendations for action.
  - DELIVERABLE FIRST: a written plan + recommendations before building.

## Verify / smaller

- [ ] **T11 — Backup: two buttons?** Why two backup buttons — same backup? Consolidate / improve.
  - (Commit 2b77d42 "one backup control, not two" — VERIFY this is actually resolved.)

- [ ] **T12 — Website: Windows version.** Confirm the Windows build is listed on prevail.sh.
  Add it if missing.

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

## Log
- 2026-06-14: Task list created from founder feedback batch.
