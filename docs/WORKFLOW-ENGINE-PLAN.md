# Workflow Engine, Policy, and Isolation — Analysis and Build Plan

> ## Build status (2026-06-17, distilled from founder vision plus competitive analysis)
> Prevail already has the engine seam, the four ingestion tiers, the Apps/connectors construct, the self-learning daemons (distill, taskgen, skillgen, reminders), council, and the ideal-state constitution. What does not yet exist is a way to **compose** those point capabilities into durable, repeatable, gated sequences, and the trust layer (policy + approval + isolation) that makes it safe to let such sequences act on money, health, and filings.
>
> This plan defines a **Domain Workflow engine** and the policy/isolation layer it runs inside, then the channels, scheduling, and memory surfaces that build on top. It is the keystone layer above council + daemons + connectors.
>
> Source of the design: cross-analysis of omnigent (policies, sandbox, unified setup) and Archon (YAML/DAG harness, mixed AI plus deterministic plus approval nodes, worktree isolation, multi-channel orchestrator), filtered through Prevail's angle: private, local-first, single-user, domain-grounded, reuses the CLIs you already pay for, never leaves your machine. Borrow the engines, never the use cases (no coding workflows, no database, no multi-tenant server).

### Item map (founder list 1 to 24)

| # | Item | Phase | Exists today | Effort |
| --- | --- | --- | --- | --- |
| 1 | `prevail workflow` command (run/list/create) | P1 | No | M |
| 2 | YAML workflow format + DAG executor | P1 | No | L |
| 3 | Node types: council, connector, script, loop, approve | P1 | Partial (council, connectors exist as primitives) | L |
| 4 | Run state persisted to vault, resumable after pause | P1 | No | M |
| 5 | `_memory.md` write-back node | P1 | Partial (daemons write memory) | S |
| 6 | Starter workflow library | P1 | No | M |
| 7 | Policy file loaded per-domain | P2 | No | M |
| 8 | Spend caps per domain/turn/day | P2 | Partial (cost is shown, not enforced) | M |
| 9 | Action gating: require_confirm before write/script | P2 | No | M |
| 10 | Data rules: local-council-only per domain | P2 | No | S |
| 11 | Approval surface on CLI, desktop, Telegram | P2 | No | M |
| 12 | Vault snapshot before each run + rollback | P3 | Partial (versioned ideal-state only) | M |
| 13 | Per-run scratch dir, no live writes until approved node | P3 | Partial (imports sandbox exists) | M |
| 14 | `prevail workflow rollback <run-id>` | P3 | No | S |
| 15 | `prevail setup` unified credential inventory | P4 | Partial (`doctor` checks CLIs) | M |
| 16 | `doctor` verifies keys + connector auth in one view | P4 | Partial | S |
| 17 | Channel adapter abstraction | P5 | Partial (Telegram, WebUI bespoke) | M |
| 18 | Slack adapter | P5 | No | M |
| 19 | Discord adapter | P5 | No | M |
| 20 | Extend cron to trigger workflows | P6 | Partial (briefing cron exists) | S |
| 21 | `prevail workflow schedule add --cron` | P6 | No | S |
| 22 | Cross-domain council node | P7 | Partial (single-domain council) | M |
| 23 | `prevail memory` query of intent ledger / `_memory.md` | P7 | Partial (memory written, not queryable) | M |
| 24 | Decision-tracking: tag intents with outcome, resurface | P7 | Partial (`_decisions.jsonl` exists) | L |

Effort key: S = under a day, M = 1 to 3 days, L = multi-day. Estimates assume engine seam, daemons, ingestion tiers, and council are reused, not rebuilt.

---

## 1. Current state (grounding)

Load-bearing pieces under `fd-apps/prevail-desktop/src-tauri/src/` (and the bundled `prevail` CLI sidecar):

- **Engine seam**: all model work routes through `engine::run_engine_json()`. Council fans to claude/codex/agy/ollama, a chair synthesizes a verdict, disagreement is surfaced.
- **Daemon pattern**: `distill.rs`, `taskgen.rs`, `skillgen.rs`, `reminders.rs`. State machine `{Config, Status, State}` + tokio task + watch channel; per-domain enable via `<domain>/_daemons.json`; constitution injected via `ideal_state_preamble()`.
- **Ingestion tiers** (`ingestion/mod.rs`): Tier A MCP, Tier B Composio, Tier C browser, Tier D CLI. Secrets in `ingestion/keychain.rs`. Artifact sandbox in `ingestion/storage.rs` (sha256 + metadata, path-traversal safe, writes to `<vault>/<domain>/imports/<source>/<file>`).
- **Apps/connectors**: catalog with per-app auth (`api`/`oauth`/`browser`/`mcp`/`manual`), `prevail connectors list|test|oauth`, OAuth runner with PKCE + loopback + refresh.
- **Vault layout per domain**: `_memory.md`, `_tasks.md`, `_state.md`, `_decisions.jsonl`, `_daemons.json`, cursors, `imports/`.
- **Ideal-state**: `read/write_ideal_state` (versioned snapshots), prepended to every model turn at highest precedence.
- **Scheduling**: `prevail briefing add --cron` ticks domain briefings via `prevail daemon`.
- **Channels**: Telegram bridge + Remote WebUI (loopback + allowlist + Tailscale). Both currently bespoke.

Implication: this is an orchestration and trust layer on top of existing primitives, not a from-scratch build. A workflow is a DAG whose nodes call council, connectors, and scripts that already exist.

---

## Phase 1 — Domain Workflow engine (items 1 to 6)

The keystone. Everything else gates, schedules, or feeds this.

### 1.1 Format (`<vault>/_workflows/<id>.yaml`)

```yaml
id: quarterly-net-worth
name: Quarterly net worth review
domain: wealth            # grounds context; loads _state.md, _memory.md, ideal-state
schedule: "0 9 1 */3 *"   # optional; consumed by Phase 6
nodes:
  - id: pull
    type: connector       # reuses Apps/connectors; runs in scratch (Phase 3)
    use: [plaid, fidelity]
    write: scratch
  - id: analyze
    type: council         # reuses engine::run_engine_json council mode
    after: [pull]
    prompt: "Given the pulled statements and prior _memory, what changed this quarter?"
  - id: review
    type: approve         # human gate (Phase 2 surface)
    after: [analyze]
    show: verdict
  - id: record
    type: memory          # write-back to _memory.md + _decisions.jsonl
    after: [review]
    when: approved
```

### 1.2 Node types (item 3)

- `council` — calls the engine in council or single mode; framework/lens honored; ideal-state injected. Output available to downstream nodes.
- `connector` — runs one or more Apps connectors; writes to the run scratch dir, never the live vault.
- `script` — deterministic bash; stdout/exit captured; gated by policy (Phase 2).
- `loop` — repeats a subgraph until an exit expression is true or a max-iteration cap; fresh context per iteration to avoid token bloat (Archon pattern).
- `approve` — pauses the run, emits an approval request to the active channel, resumes on decision.
- `memory` — appends distilled outcome to `<domain>/_memory.md` and a structured row to `_decisions.jsonl` (feeds Phase 7).

### 1.3 Executor (item 2)

- New module `workflow.rs` (mirror the daemon `{Config, Status, State}` shape so the UI and CLI already know how to render it).
- Topological execution of the DAG; nodes with satisfied `after` run; `approve` nodes suspend the task on a watch channel.
- One executor invocation per run; concurrency across runs is bounded the same way daemons are.

### 1.4 Run state + resume (item 4)

- Persist to `<vault>/_runs/<run-id>/` : `run.json` (node statuses, timestamps, token/cost totals), per-node output files, `status` (pending/running/awaiting-approval/done/failed/rolled-back).
- Resumable: on restart or after an approval, the executor reloads `run.json` and continues from the first unfinished node. This is also the hook Phase 3 rollback reads.

### 1.5 Memory write-back (item 5)

- The `memory` node is the self-learning closure: every completed run makes the domain sharper, consistent with the existing distill loop. Reuse `distill.rs` summarization so write-back matches daemon output format.

### 1.6 CLI + starter library (items 1, 6)

- `prevail workflow list|run <id>|create|status <run-id>|logs <run-id>`.
- Desktop: a Workflows surface that renders the same `run.json` (single source, no duplicate UI), with the per-node DAG and live status.
- Ship starter workflows under demo vault and as importable packs (mirror starter packs): `tax-season`, `open-enrollment`, `quarterly-net-worth`, `weekly-finance-review`.

---

## Phase 2 — Policy and approval gates (items 7 to 11)

The trust layer. A workflow that pulls statements and files forms is only safe with enforced limits and human gates.

### 2.1 Policy file (item 7)

`<vault>/_policy.yaml` (global) overridable per domain via `<domain>/_policy.yaml`:

```yaml
defaults:
  require_confirm: [connector.write, script]   # action gating (item 9)
  spend:
    per_turn_usd: 0.50                          # item 8
    per_day_usd: 5.00
domains:
  health:
    models: local-only        # item 10: force ollama, block cloud engines
    spend: { per_turn_usd: 0 }
  wealth:
    require_confirm: [connector.write, script, council]
```

### 2.2 Enforcement (items 8, 9, 10)

- Loaded by the engine seam, applied before any node runs.
- Spend caps: track per-turn and per-day token cost; block + log when exceeded (you already compute per-turn cost, so this is enforcement on an existing number).
- Action gating: any node matching `require_confirm` becomes an implicit `approve` gate.
- Data rules: `models: local-only` rewrites the council roster to Ollama and refuses cloud engines for that domain; hard-fails rather than silently degrading.

### 2.3 Approval surface on every channel (item 11)

- One approval primitive `await_approval(run_id, node_id, summary)` rendered by each channel: CLI inline prompt, desktop modal, Telegram message with allowlisted reply. Channels added in Phase 5 implement the same primitive.
- Decisions logged to the run and to `_decisions.jsonl`.

---

## Phase 3 — Isolation and rollback (items 12 to 14)

Structural enforcement of the hard rule: never lose user data.

- **Snapshot before run (item 12)**: copy-on-write or tar snapshot of the affected domain folders into `<vault>/_runs/<run-id>/snapshot/` before the first write node. Cheap, local, no Docker.
- **Scratch-first execution (item 13)**: `connector` and `script` nodes write only to `<vault>/_runs/<run-id>/scratch/`. Nothing reaches the live vault until an approved `memory`/write node commits it. Reuses the path-traversal-safe `ingestion/storage.rs` conventions.
- **Rollback (item 14)**: `prevail workflow rollback <run-id>` restores the snapshot and marks the run `rolled-back`. Desktop exposes the same action.

---

## Phase 4 — Unified onboarding and credentials (items 15 to 16)

Lower the on-ramp without betraying "reuse what you already pay for."

- **`prevail setup` (item 15)**: one pass that inventories provider keys across env vars, macOS Keychain, installed CLI logins (claude/codex/agy/ollama), and OpenRouter; reports present vs missing; offers to store missing keys in Keychain. It detects logins, it does not force key paste.
- **`doctor` expansion (item 16)**: single view combining CLI presence, provider keys, and per-connector auth state (`connected`/`expired`/`error`) so the whole readiness picture is one command. Reuses the connector auth-state model.

---

## Phase 5 — Channel orchestrator and new channels (items 17 to 19)

Make the cockpit reachable wherever the user already is.

- **Adapter abstraction (item 17)**: extract a `Channel` trait from the existing Telegram and WebUI code: `receive() -> Command`, `send(Reply)`, `await_approval(...)`. Telegram and WebUI become two implementations; the orchestrator routes commands and approvals uniformly.
- **Slack (item 18)** and **Discord (item 19)**: thin adapters over the trait, with the same allowlist enforcement as Telegram (workspace/channel/user allowlist, off by default). Deliberately skip GitHub webhooks: that is coding-tool territory, not life-OS.

---

## Phase 6 — Scheduled workflows (items 20 to 21)

Compound the engine with the existing ticker.

- **Extend cron (item 20)**: the `prevail daemon` ticker that fires briefings also fires workflows whose `schedule` field is due. One scheduler, two payload types.
- **CLI (item 21)**: `prevail workflow schedule add --cron "0 7 * * *" --workflow weekly-finance-review` (and `list`/`remove`). A scheduled run still honors policy and approval; a 7am pull-then-council can hold at its `approve` node until the user responds on their phone.

---

## Phase 7 — Differentiators (items 22 to 24)

Only Prevail has the longitudinal, multi-domain, private context to do these. Lean in.

- **Cross-domain council node (item 22)**: a `council` node variant that loads state + memory from several domains at once (for example tax + wealth + career) plus ideal-state, for decisions that span life areas. No competitor has the domain context to attempt this.
- **`prevail memory` (item 23)**: query the intent ledger and `_memory.md` across domains ("what did I decide about the mortgage six months ago, and did it hold?"). Backed by `_decisions.jsonl`; optionally embedded for semantic recall (local only).
- **Decision tracking (item 24)**: extend `_decisions.jsonl` rows with an `outcome` field; a light loop (new daemon or a `memory` node behavior) revisits past decisions, tags whether they held, and resurfaces relevant ones in future related chats. This is the concrete proof of "gets sharper every time you use it."

---

## Sequencing and dependencies

1. **P1** is the keystone; nothing else is useful without it.
2. **P2** should land with or immediately after P1: never ship an engine that can write or run scripts without enforced gates.
3. **P3** pairs with P2 (gates decide, isolation makes decisions reversible).
4. **P4, P5, P6** are independent and can be done in any order once P1 to P3 exist.
5. **P7** builds on the `memory`/`_decisions.jsonl` plumbing P1 establishes.

Minimum trustworthy slice: P1 + P2 + P3. That single block absorbs the "custom agents," "policies," and "sandbox" gaps from both the omnigent and Archon analyses while keeping Prevail a private, local-first life-OS.

## Non-goals (guardrails)

- No database: workflows, runs, policy, and memory stay as files in the vault.
- No Docker, VPS, multi-tenant, or shared-server deployment: single-user local-first only.
- No coding-specific workflows (PR review, refactor, merge-conflict): borrow the engine, not the use case.
- No centralized cloud sandbox: isolation is local; nothing leaves the machine.
