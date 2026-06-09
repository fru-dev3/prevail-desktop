# Plan: Usage & Cost Analytics (domain-level + global)

Status: **DESIGN ONLY.** Part of the batch with `SECURITY-LOCK-PLAN.md`,
`VAULT-EMBED-PLAN.md`, and `DEMO-MODE-PLAN.md`.

## Goal

Give the user visibility into how Prevail is being used and what it costs, at
two altitudes:

- **Per domain** (a tab on the domain view): queries, tokens, cost, and which
  models were used *for that domain*.
- **Global** (whole app, all domains): overall cost + usage **over time**, usage
  **by provider**, usage **by specific model** (where the spend actually goes).

## What already exists (good news — strong foundation)

- **Capture:** `usage_append` (lib.rs ~800) writes one NDJSON record per
  completed turn to `<vault>/usage/usage.ndjson`. Each `UsageRecord` carries
  `ts`, `day`, `domain`, `thread`, `cli`, `model`, input/output tokens, cost,
  `ok`. Wired in App.tsx at turn close (~6266).
- **Aggregate:** `usage_summary` (lib.rs ~861) returns totals plus `by_cli`,
  `by_model`, `by_domain` buckets (each: turns, tokens, cost), ranked by cost.
- **Display:** `UsageDashboard` + `UsageBreakdown` (App.tsx ~5542/5584),
  currently rendered only on the General (no-domain) landing.

So we are **extending**, not starting over. The two gaps are: (1) domain
scoping, and (2) time-series ("over time").

## Gaps to close

### 1. Domain-level usage tab
- The data is already tagged by `domain`. Add a **"Usage" (or "Stats") tab on
  the domain view**, next to the domain's existing tabs.
- Backend: extend `usage_summary` to accept an optional `domain` filter, OR keep
  it whole-vault and filter client-side from `by_domain` + a domain-scoped pass.
  Recommend a small new command `usage_summary_domain(vault, domain)` that
  returns the same `UsageSummary` shape filtered to that domain (keeps the
  aggregation in Rust, cheap, and avoids shipping the whole ledger to the
  client). Reuse the existing buckets so the UI component is shared.
- Tab shows: total queries (turns), total tokens (in/out), total cost, by-model
  breakdown, and a small time sparkline (see below) scoped to the domain.

### 2. "Over time" (time-series)
- Records already have a `day` field — we're just not aggregating it.
- Add a `by_day: Vec<UsageBucket>` (key = `YYYY-MM-DD`) to `UsageSummary`,
  populated in the same single pass over the ledger. Cheap, no new file format.
- Frontend: a compact line/bar chart of cost (and a tokens toggle) over the last
  N days. We already render sparklines elsewhere (score history) — reuse that
  style rather than pulling in a chart lib, to keep the bundle lean (the build
  already warns about chunk size).

### 3. Global dashboard (promote + enrich)
- Keep the existing `UsageDashboard` but make it a **first-class destination**
  (a Stats view reachable from the top-level nav / General), not just something
  on the empty landing.
- Sections:
  - **Overview:** total cost, total queries, total tokens, active days.
  - **Over time:** cost/usage trend (by_day).
  - **By provider:** from `by_cli` (claude / codex / gemini / openrouter / …).
  - **By model:** from `by_model` — surfaces "you're mostly on
    claude-opus-4-8," etc.
  - **By domain:** from `by_domain` — which domains cost the most.
- "Provider" vs "model": `cli` is the provider/runtime, `model` is the specific
  model. We have both; label them clearly so the user sees both the provider mix
  and the exact-model mix you asked for.

## Backend changes (small, additive)
- `UsageSummary`: add `by_day`.
- New (or extended) command for domain-scoped summary.
- Both already pure functions over the NDJSON ledger — add unit tests in the
  style of the existing `usage_summary` test (lib.rs ~3406).
- Allowlist for WebUI: `usage_summary` is read-only and safe; add the new
  domain-scoped command to `WEBUI_ALLOWED` so stats work in the web view too.

## Frontend changes
- Extract the shared presentation (`UsageBreakdown`) so the **same component
  renders both the domain tab and the global view**, fed by a scoped vs whole
  summary.
- Add the domain "Usage" tab to the domain view's tab strip.
- Add a small reusable `<Sparkline>`/bar component for the time series (or reuse
  the score-history one).
- Respect house style: lucide icons, no emoji, no em dashes.

## Cost accuracy note
- Cost depends on per-model pricing. Confirm where the price table lives (engine
  vs desktop) and that it's current for the models in use (Opus 4.8, Sonnet 4.6,
  Haiku 4.5, plus any OpenAI/Gemini/OpenRouter the user runs). Stats are only as
  trustworthy as that table — worth an explicit "prices as of <date>" footnote
  and a single source of truth for pricing. (See the Claude API reference for
  current Anthropic pricing.)

## Demo-mode interaction
- The demo vault should ship with a **realistic `usage.ndjson`** so the Stats
  tabs aren't empty on first launch — part of the "fully complete demo" in
  `DEMO-MODE-PLAN.md`. Fictional but plausible numbers, no real cost data.

## Phased build
- **Phase 1:** add `by_day` + domain-scoped summary command (+ tests); extract
  shared `UsageBreakdown`.
- **Phase 2:** domain "Usage" tab.
- **Phase 3:** promote the global Stats view with over-time + provider + model +
  domain sections; seed demo usage data.

## Open questions for you
1. Default time window for "over time" — 30 days? 90? all-time with zoom?
2. Should cost show in USD only, or also a token-count-first view (some users
   care about tokens, not dollars)?
3. Where should the global Stats view live — a top-level tab, or stay on the
   General landing but expanded?
