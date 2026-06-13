# Apps and Connectors — Analysis and Build Plan

> ## Build status (2026-06-12, distilled from founder vision)
> Prevail already has the connectivity plumbing (the four ingestion tiers, keychain, sandboxed storage) and the self-learning loop (distill, taskgen, skillgen, reminders daemons over domains + vault + ideal-state). What does not yet exist is a first-class **App** construct: a catalog of the services in the user's life (banks, brokerages, email, portals, wearables, etc.), each with its own connectivity method, auth state, and refresh schedule, mapped to one or more domains, refreshing the vault headlessly so every domain conversation is grounded in up-to-date statements and data.
>
> This plan defines that construct and sequences the build. Apps are deliberately a SEPARATE construct from domains: one app (Capital One) can feed several domains (wealth, insurance); one domain (wealth) is fed by several apps (Capital One, Fidelity, US Bank).

| # | Capability | Exists today | Gap | Effort |
| --- | --- | --- | --- | --- |
| 1 | Connectivity tiers (MCP / Composio / Browser / CLI) | Yes (`ingestion/tier_a..d`) | No per-app binding or catalog on top | - |
| 2 | Secret storage | Yes (`ingestion/keychain.rs`) | Per-app auth-state model + status | S |
| 3 | Sandboxed artifact storage | Yes (`ingestion/storage.rs`) | Per-app import routing convention | S |
| 4 | **App construct + registry** | No | Catalog, data model, persistence | M |
| 5 | **App to domain mapping** | No | Many-to-many binding, manifest routing | M |
| 6 | **Connectivity + auth state** | Partial | Unified `connected / expired / error` per app | M |
| 7 | **Refresh scheduler (sync daemon)** | No | New daemon, per-app schedule, headless-first | L |
| 8 | **Apps UI (gallery + per-domain view)** | No | Icons/logos, status, last-sync, manual run | L |
| 9 | **Briefing daemon (daily/weekly)** | No | New daemon, email/Slack/Drive delivery | M |
| 10 | **Ideal-state alignment** | Partial (preamble) | Scoring + visual deviation indicator | L |
| 11 | Error elevation / triage surface | No | Failed syncs raised for action | M |

Effort key: S = under a day, M = 1 to 3 days, L = multi-day. Estimates assume the existing tiers are reused, not rebuilt.

---

## 1. Current state (grounding)

What is already load-bearing for this work (paths under `fd-apps/prevail-desktop/src-tauri/src/`):

- **Ingestion tiers** (`ingestion/mod.rs` orchestrator):
  - Tier A `tier_a_mcp.rs` — consume MCP servers from `mcp_config.json` (Gmail, etc.)
  - Tier B `tier_b_composio.rs` — managed gateway for 100+ SaaS (Plaid, Gmail, Slack, brokerages)
  - Tier C `tier_c_browser.rs` — headed Playwright for portals with MFA (Fidelity, management companies)
  - Tier D `tier_d_cli.rs` — spawn user-installed CLIs
- **Secrets**: `ingestion/keychain.rs` (macOS Keychain) plus engine DEK injection for vault encryption.
- **Artifact sandbox**: `ingestion/storage.rs` writes to `<vault>/<domain>/imports/<source>/<file>` with sha256 + metadata, path-traversal safe.
- **Daemon pattern**: `distill.rs`, `taskgen.rs`, `skillgen.rs`, `reminders.rs`. State machine `{Config, Status, State}` + tokio task + watch channel; per-domain enable via `<domain>/_daemons.json`; constitution injected via `ideal_state_preamble()`.
- **Domains**: `Domain { name, path, has_state, state_preview }` from `scan_vault` (lib.rs). Vault layout per domain already includes `_memory.md`, `_tasks.md`, `_state.md`, `_decisions.jsonl`, cursors.
- **Ideal-state**: `read/write_ideal_state` (lib.rs) with versioned snapshots; prepended to every daemon prompt.
- **Engine seam**: all CLI work routes through `engine::run_engine_json()`.

Implication: this is mostly an integration and modeling job, not a from-scratch build. The Apps construct sits ON TOP of the ingestion tiers.

---

## 2. The App construct (data model)

An **App** is a connectable service. It is persisted (engine-owned, vault-relative) so it survives across desktop and CLI.

Proposed record (`<vault>/_apps/<app_id>.json`, encrypted like other vault files):

```jsonc
{
  "id": "capital-one",
  "name": "Capital One",
  "logo": "capital-one.svg",          // asset slug; bundled or fetched once
  "category": "banking",              // banking | brokerage | email | calendar | portal | health | gaming | other
  "connectivity": {
    "tier": "composio",               // mcp | composio | browser | cli  (headless-first preference order)
    "ref": "plaid:capital_one",       // tier-specific handle (mcp server name, composio action, portal id, cli)
    "headless": true
  },
  "auth": {
    "method": "oauth",                // oauth | api_key | browser_session | none
    "state": "connected",             // connected | expired | error | unlinked
    "secret_ref": "keychain://prevail/capital-one",
    "last_auth_ts": "2026-06-12T18:00:00Z",
    "last_error": null
  },
  "domains": ["wealth", "insurance"], // many-to-many; the app to domain map
  "refresh": {
    "schedule": "weekly",             // manual | daily | weekly | monthly | cron expr
    "last_sync_ts": "2026-06-11T06:00:00Z",
    "next_due_ts": "2026-06-18T06:00:00Z",
    "writes": [                       // what each sync produces, per domain
      { "domain": "wealth", "kind": "statement", "path": "imports/capital-one/" }
    ]
  }
}
```

Registry: `<vault>/_apps/_index.json` lists app ids + quick status for fast UI load. Engine exposes `apps_list`, `apps_get`, `apps_upsert`, `apps_remove`, `apps_test_connection`, `apps_sync_now`.

Note: apps are NOT domains and never appear in the domain sidebar list. They are their own navigation surface (section 7).

---

## 3. App to domain mapping

- A domain's manifest gains an `apps: [app_id]` view (derived from each app's `domains` array — single source of truth stays on the app record to avoid drift).
- The wealth domain view shows: Capital One, Fidelity, US Bank, each with last-sync + status.
- One sync run can write to multiple domains (Capital One brokerage to wealth; same login's coverage docs to insurance). The `refresh.writes[]` array makes the fan-out explicit and auditable.
- Distill/taskgen/skillgen already read `<domain>/imports/**` indirectly once it is summarized into `_memory.md`; add a lightweight `import_summarizer` step (section 5) so raw PDFs/statements become distill-readable text.

---

## 4. Connectivity and auth state

Reuse the four tiers; add a unified state machine per app:

- `unlinked` -> user connects (OAuth flow / API key entry / browser login capture) -> `connected`.
- `connected` -> token/cookie expiry or sync failure -> `expired` or `error` (with `last_error`).
- `apps_test_connection` does a cheap liveness probe per tier (MCP ping, Composio whoami, browser session check, CLI `--version`).
- Headless-first ordering: prefer `cli` and `mcp`/`api` (fully headless); fall back to `composio` (managed); use `browser` only when a portal has no API. Browser sessions capture and reuse cookies to stay headless after first MFA login; when MFA re-challenges, raise an error for triage rather than blocking.

---

## 5. Refresh engine (new `syncd` daemon)

Mirror `skillgen.rs`. New file `src-tauri/src/syncd.rs`.

- **Config**: `{ vault, provider, model, interval_sec, max_concurrent_syncs }`.
- **Status**: `{ running, last_run_ts, last_error, apps_synced, artifacts_written, failures }`.
- **run_once**: load `_apps/_index.json`, select apps where `next_due_ts <= now` and `auth.state == connected`, run each through its tier, write artifacts via `ingestion/storage.rs`, update `last_sync_ts` / `next_due_ts`, append a row to `<vault>/_apps/_sync_log.jsonl`.
- **Per-app enable**: reuse `_daemons.json` convention, plus per-app `refresh.schedule`.
- **Import summarizer**: after artifacts land, generate a short text summary per import into `<domain>/_memory.md`-feeder so the distill daemon picks it up (keeps statements queryable in chat).
- **Error elevation**: failures append to a triage queue (`<vault>/_apps/_triage.jsonl`) and fire a native notification; surfaced in UI (section 7) and optionally in the daily brief.

Scheduling stays simple first (interval poll comparing `next_due_ts`), cron expressions later.

---

## 6. Briefing daemon (new `briefing.rs`)

Mirror the daemon pattern. Delivers the "assistant" layer the founder described.

- **Daily brief** (per configured email, e.g. personal): inbox/triage summary, calendar for the day, upcoming events, tasks due, new tasks suggested, any sync failures needing action.
- **Friday weekly summary**: goals progress, tasks completed vs open, ideal-state alignment delta (section 8).
- **Delivery channels**: email (via Gmail MCP / Composio), Slack, or Google Drive doc. Channel is configurable per brief.
- **Voice and tone**: prompts include the domain `soul.md` + ideal-state preamble so output is in the user's voice; tone improves as `_memory.md` grows.
- **Source of email auth**: a Gmail App (section 2) with `domains: ["email"]` provides the connection the brief sends through.

---

## 7. Apps UI (desktop)

Founder priority: real app icons, easy to navigate, sync at a glance. Lives in `src/App.tsx` (current single-file app; extract components as needed).

- **Apps gallery** (new top-level section, sibling to domains, NOT inside the domain list): grid of app cards with logo, name, status dot (`connected/expired/error`), last-sync relative time, next-due. Click opens app detail.
- **App detail**: connectivity tier, auth state with reconnect button, domain bindings (editable), schedule selector, "Sync now", recent sync log, recent artifacts.
- **Per-domain apps strip**: inside each domain view, a compact row of bound app icons with status, so opening "wealth" shows which feeds are fresh.
- **Status pattern**: reuse `SidebarGatewayLive()` live-dot pattern (App.tsx ~1254) for app status polling via `apps_list`.
- **Triage surface**: a badge + list for `_triage.jsonl` items (failed syncs, expired auth) with one-click reconnect or retry.
- Honor existing UI rules: single-column, geometric-shape status glyphs, no emojis, no em dashes, surgical mirrored changes.

---

## 8. Ideal-state alignment

The founder wants a clear, visual read on how close life is to the defined ideal state, and what is pulling toward or away from it.

- **Scoring**: a periodic pass (could be a `briefing.rs` sub-step or its own daemon) reads `ideal-state.md` plus each domain `_state.md` / `_decisions.jsonl` and produces an alignment score per pillar (wealth, revenue, health, living, relationships) with a short rationale, written to `<vault>/_meta/alignment.json` (versioned).
- **Visual**: a home-page indicator (respecting the no-scroll home rule) showing each pillar's distance from ideal, trend arrow, and the top 1 to 3 corrective actions. Deviations flagged with a clear glyph (for example `▲` improving, `▼` deviating).
- **Tie-in**: corrective actions feed taskgen so they become real tasks; weekly brief reports the delta.

---

## 9. Phased roadmap

### Phase 0 — Model and registry (P0, foundation)
- [ ] Define App record + `_apps/` layout + `_index.json` (section 2). Effort M.
- [ ] Engine commands: `apps_list/get/upsert/remove`. Effort M.
- [ ] Per-app auth-state struct reusing `keychain.rs`. Effort S.
- [ ] App to domain binding read path for domain manifests. Effort S.

### Phase 1 — Connect and sync one app end to end (P0)
- [ ] `apps_test_connection` across the four tiers. Effort M.
- [ ] `syncd.rs` daemon (mirror skillgen) with interval scheduling. Effort L.
- [ ] Import summarizer so artifacts reach `_memory.md` / distill. Effort M.
- [ ] Error elevation to `_triage.jsonl` + notification. Effort S.
- [ ] Vertical slice: Gmail (Tier A MCP) -> email domain, and one bank (Tier B Composio or Tier C browser) -> wealth domain. Effort M.

### Phase 2 — UI (P1)
- [ ] Apps gallery + app detail + Sync now. Effort L.
- [ ] Per-domain apps strip. Effort M.
- [ ] Triage surface with reconnect/retry. Effort M.
- [ ] App logos/icons asset pipeline. Effort S.

### Phase 3 — Assistant layer (P1)
- [ ] `briefing.rs` daemon: daily brief + Friday weekly summary. Effort M.
- [ ] Delivery channels: email, then Slack, then Drive. Effort M.
- [ ] Reply-in-voice flow (read latest email, pull PDFs to vault, draft + send). Effort L.

### Phase 4 — Ideal-state alignment (P2)
- [ ] Alignment scoring pass -> `_meta/alignment.json`. Effort M.
- [ ] Home-page alignment indicator + corrective actions into taskgen. Effort L.

### Phase 5 — Scale and hardening (P2)
- [ ] Cron-expression schedules; concurrency cap; backoff on failures. Effort M.
- [ ] App catalog seed (common banks, brokerages, email, wearables) for quick add. Effort M.
- [ ] Headless browser session reuse + MFA re-challenge triage. Effort L.

---

## 10. Open decisions (need founder input)

1. **Composio vs self-hosted connectors**: Composio is the fastest path to 100+ services but is a third-party gateway holding tokens. Acceptable for financial data, or prefer self-hosted (Plaid direct + per-portal browser) for sensitive domains?
2. **Brief delivery default**: email only, or email + Slack + Drive from day one?
3. **Catalog scope for v1**: which 5 to 10 apps to seed first (suggest: Gmail x3 accounts, Capital One, Fidelity, one management-company portal, a wearable/health source)?
4. **Alignment scoring cadence**: daily, or weekly with the Friday brief?

---

## Appendix — naming

The construct is **Apps** (founder preference; not "tools", not "integrations"). Internally the connectivity layer remains "tiers" and the binding is "app to domain mapping". Apps are a peer construct to domains, never nested under them.
