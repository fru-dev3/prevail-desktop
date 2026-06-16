# Prevail — Platform Roadmap TODO (Tiers 1–3)

**Created:** 2026-06-16
**Source:** strategic analysis vs. omnigent / Archon, reframed for life-OS.
**Separate from** `docs/todo.md` (the tactical "Monday Feedback" UX/bug plan). This file
is the architectural roadmap. Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[?]` needs founder input.

## The filter (every item must sharpen this)
Prevail is a **private, local-first life-OS** that learns you over time, grounds every answer in
your **life-domains as markdown**, **reuses the CLIs you already pay for**, and **never leaves your
machine**. Single-user. No database. No SaaS. Anything that pulls toward "generic dev-agent
platform" or "multi-tenant cloud" is rejected (see bottom).

---

## What already exists (so this is delta work, not greenfield)
Grounded in `prevail-cli/src`:
- **Agentic loops** — `daemon-loops.ts` already runs loops with per-action `task` / `needs_approval`
  flags and modes (suggest / tasks / auto / guardrails). This is the seed of the workflow engine AND
  the approval runtime.
- **Node execution** — `runners.ts` (mcp / browser / a2a), `connector-probe.ts`, `manifest.ts`,
  `council-runner.ts`. The "node types" a workflow needs mostly exist as runners already.
- **Scheduling** — `schedule.ts`, `daemon-launchd.ts`, `briefings.ts` (`briefing --cron`).
- **Vault versioning** — `git-vault.ts` (vault is git-backed → snapshot/rollback is nearly free).
  `_scratch` is already a reserved/ignored dir in `vault-ops.ts`.
- **Spend / privacy** — `budget.ts` (spend tracking), `privacy.ts` (cloud/local model rules).
- **Channels** — `gateway/` has the adapter pattern: `gateway.ts`, `adapter.ts`, `telegram-adapter.ts`, `artifact-router.ts`.
- **Setup/health** — `doctor`, `onboard.ts`, `wizard.tsx`, `oauth-flow.ts`, `mcp-config.ts`, `models.ts` provider detection.
- **Council** — mature (~60 files): `council-runner`, `auto-council`, `council-cost`, `council-json`.
- **Memory/ledger** — `memory.ts` + `_memory.md`, `decisions.ts` + `_decisions.jsonl`, `_intents.jsonl`, `surface.ts`, `serendipity.ts`, `distill.ts`.

---

## Recommended sequence (effort × leverage, given what exists)
Not strictly the Tier order — reordered by what's cheap now and what unblocks the rest.

1. **#4 Setup/doctor consolidation** — mostly wiring existing detection together. Low risk, helps every other item land. Do first / in parallel.
2. **#3 Isolation** — cheap because `git-vault` + `_scratch` already exist; it's the structural backing for "never lose user data," so land it *before* workflows act.
3. **#8 Longitudinal memory surfacing** — the data already exists; this is a query/recall surface. High differentiation, independent of the engine.
4. **#1 Workflow engine** — the keystone. Generalize `daemon-loops` into a typed DAG. Build on #3 (isolation) so runs are reversible.
5. **#2 Policy + approval gates** — approval runtime exists in loops; add the declarative per-domain policy config and enforce it in the #1 runtime.
6. **#6 Scheduled workflows** — trivial once #1 exists (point `schedule.ts`/cron at a workflow).
7. **#7 Cross-domain council** — leverages mature council; add multi-domain context load.
8. **#5 Orchestrator + channels** — adapter pattern exists; Slack/Discord are thin adapters. Reach, not foundation.

---

## TIER 1 — Build now (keystone four)

### #1 — Domain Workflow engine (`prevail workflow`)  [KEYSTONE]
User-authored sequences of typed nodes (AI/council · deterministic: connector / read-vault / script ·
loop · human-approval). Grounded in a domain; writes back to `_memory.md` so each run makes the
system smarter. Ship a starter library (tax-season, open-enrollment, quarterly-net-worth-review).
**Exists:** `daemon-loops.ts` (agentic loop + per-action approval flags), `runners.ts` (node executors),
`council-runner.ts`, `schedule.ts`, the `packs/` starter-pack pattern.
**Delta to build:**
- [ ] Define a workflow spec (markdown + frontmatter, or a `.workflow.md` in the domain — keep it human-editable, no DB).
- [ ] DAG executor: typed nodes (`ai`, `council`, `connector`, `read`, `script`, `loop`, `approval`), edges, per-node IO passed as vault files/vars.
- [ ] Generalize `daemon-loops` action/approval semantics into the executor (reuse, don't fork).
- [ ] Write-back step: each run appends a grounded note to the domain `_memory.md` / ledger.
- [ ] `prevail workflow run <name> [--domain]`, `list`, `new` (scaffold), `--dry-run`.
- [ ] Starter library as packs: `tax-season`, `open-enrollment`, `quarterly-net-worth-review`.
- [ ] Desktop surface: a Workflows panel (author / run / watch node progress / view run history).
- [?] Decide: is a workflow a *generalization of Loops* (merge the two concepts) or a sibling? (Recommend: Loops become the simplest single-node workflow.)

### #2 — Policy + approval gates
Declarative, per-domain enforcement: spend caps (health: no model spend > $0.50/turn), action gating
(confirm before any connector write), data rules (wealth: local-council only, no cloud models).
**Exists:** approval runtime in `daemon-loops` (`needs_approval`, modes), `budget.ts` (spend), `privacy.ts` (cloud/local rules).
**Delta to build:**
- [ ] Declarative policy file per domain (e.g. `<domain>/policy.md` frontmatter): `spend_cap_per_turn`, `require_confirm_on` (connector-write/spend/irreversible), `models` (local-only / allow-cloud).
- [ ] Policy loader + a single `enforcePolicy(domain, action)` checkpoint used by chat, council, loops, and the #1 workflow runtime.
- [ ] Wire spend caps to `budget.ts`; wire data rules to `privacy.ts`; wire action gating to the approval runtime.
- [ ] Desktop: policy editor per domain + a visible "blocked by policy" affordance.
- [ ] Sensible defaults shipped per starter domain (wealth/health stricter).

### #3 — Isolation / sandboxed execution
Any workflow node that runs a connector/script executes in a reversible, isolated context so a bad run
can't corrupt the vault. Cheap: vault snapshot + scratch dir per run. No Docker.
**Exists:** `git-vault.ts` (git-versioned vault → snapshot/restore), `_scratch` reserved dir, `path-safety.ts`, `file-lock.ts`.
**Delta to build:**
- [ ] `snapshotVault()` / `restoreVault(ref)` helpers over `git-vault` (commit-before-run, reset-on-failure).
- [ ] Per-run scratch dir under `_scratch/<run-id>/`; connector/script nodes write there first, then a reviewed commit promotes changes.
- [ ] Rollback-on-failure hook in the run lifecycle (ties into #1).
- [ ] Capture per-run diff so the user can see/approve/undo what a run changed.
- [ ] Tests: a deliberately failing node leaves the vault byte-identical to pre-run.

### #4 — Unified credential / onboarding wizard (`prevail setup`)
One pass that inventories every provider key (env, Keychain, CLI logins, OpenRouter) and reports
what's missing via `doctor`. Detects logins; does not force key-paste.
**Exists:** `doctor`, `onboard.ts`, `wizard.tsx`, `oauth-flow.ts`, `mcp-config.ts`, `models.ts` (provider detection), `system.ts`.
**Delta to build:**
- [ ] Single provider inventory: scan env vars, macOS Keychain, known CLI login states (claude/gemini/codex), OpenRouter, MCP configs.
- [ ] `prevail setup` flow that reports per-provider: detected / missing / how-to-fix, without storing pasted secrets where avoidable.
- [ ] Fold the inventory into `doctor` output (shared code).
- [ ] Desktop: first-run setup screen reusing `wizard.tsx`; a "Connections health" view.
- [ ] Honor the angle: prefer detecting existing CLI logins over asking for keys.

---

## TIER 2 — Build next (reach + leverage)

### #5 — Orchestrator + more channels
Abstract the channel layer so a new surface is a thin adapter; add Slack and Discord alongside
Telegram. Skip GitHub webhooks (coding-tool territory).
**Exists:** `gateway/` adapter pattern (`gateway.ts`, `adapter.ts`, `telegram-adapter.ts`, `artifact-router.ts`).
**Delta to build:**
- [ ] Confirm the `adapter.ts` interface is channel-agnostic; tighten if needed.
- [ ] `slack-adapter.ts` (Socket Mode or bot token) implementing the adapter.
- [ ] `discord-adapter.ts` implementing the adapter.
- [ ] Per-channel routing config (which domains/briefings go where) + auth doctor entries.

### #6 — Scheduled workflows
Extend cron to trigger workflows, not just briefings (e.g. 7am "what changed in my finances":
connector-pull → council → approval → memory-write).
**Exists:** `schedule.ts`, `daemon-launchd.ts`, `briefing --cron`.
**Delta to build:**
- [ ] Let `schedule.ts` register a workflow (#1) as a cron target, not only a briefing.
- [ ] Pending-approval inbox for scheduled runs that hit an approval node while you were away.
- [ ] Desktop: schedule editor + "next/last run" per workflow.
- Depends on **#1**.

---

## TIER 3 — Differentiators only Prevail can do (lean in)

### #7 — Cross-domain council
A council/workflow that reasons across domains at once (tax × wealth × career for one decision),
grounded in the ideal-state constitution. No competitor has life-domain context to do this.
**Exists:** mature council (`council-runner`, `auto-council`, …), per-domain ideal injection (`cli-bridge` findDomainIdeal), global `ideal-state.md`.
**Delta to build:**
- [ ] Multi-domain context loader: assemble state + `_memory.md` + ideal from N selected domains into one council prompt (respecting #2 data rules per domain).
- [ ] Council mode `--domains tax,wealth,career` (or auto-select relevant domains for a question).
- [ ] Write the cross-domain decision back to each touched domain's ledger.
- [ ] Desktop: a "decision across domains" entry point (the HVAC / umbrella / go-full-time-consulting questions from the demo are the canonical examples).

### #8 — Longitudinal memory surfacing
Make the intent ledger + `_memory.md` visible and queryable ("what did I decide about the mortgage 6
months ago, and did it hold?"). "Gets sharper every time" is the tagline; show it.
**Exists:** `decisions.ts` + `_decisions.jsonl`, `_intents.jsonl`, `memory.ts` + `_memory.md`, `surface.ts`, `serendipity.ts`.
**Delta to build:**
- [ ] `prevail recall "<query>"` — semantic/keyword search over decisions + intents + memory, returns dated hits with domain + outcome.
- [ ] "Did it hold?" follow-up: link a past decision to later state/ledger entries to show whether it played out.
- [ ] Desktop: a Memory/Decisions timeline view, filterable by domain and date, queryable in natural language.
- [ ] Surface proactively (a "6 months ago you decided X — still true?" nudge via `surface.ts`).

---

## Rejected / out of scope (keeps the angle sharp)
- Multi-tenant / cloud / SaaS anything (breaks local-first, single-user, never-leaves-machine).
- A database. Vault stays markdown + git.
- Generic dev-agent platform features: GitHub webhooks, code-CI orchestration, repo-centric workflows.
- Forcing key-paste where a CLI login can be detected (#4 must detect, not demand).
