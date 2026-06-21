# Apps Area — Deep Research & Build Findings

> Status: research document, 2026-06-17. Scope: the **Apps** area of Prevail — the
> data-inflow layer that connects external services (Gmail, calendar, finance,
> wearables, etc.) and refreshes the vault on a schedule, locally and privately.
> Supersedes nothing; complements `docs/APPS-REDESIGN.md` (UX intent) and
> `docs/APPS-CONNECTORS-PLAN.md` (data model). Adds: a current-state code map,
> external best-practice research with sources, a curated app catalog, and a
> phased TODO.

**Constraints honored throughout:** local-first (data never leaves the machine),
single-user, privacy-first (secrets in OS keychain / 0600 files). We work from a
**curated list of apps (services)** — never an enumeration of individual bank
accounts.

---

## 0. Executive summary

- **The plumbing already exists and is good.** Prevail has a pattern-first
  connector engine: an app = a manifest + skill files, six runners (mcp / a2a /
  api-http / cli / browser / llm), a multi-strategy auth probe, an autonomous
  sync daemon with cursors + backoff + failure elevation, and a desktop Apps page
  with the 4-state status model and a "describe-the-goal" Connection Agent. The
  "set it up once and it runs by itself" loop is **largely built**, not aspirational.
- **The biggest concrete gap is the catalog.** `catalog.json` holds **1,468 apps**
  (340 of them `dev`, plus heavy B2B sales/SaaS), with **853 marked obscure**. This
  is the "bloated ~1000 apps" the founder describes. Recommendation: ship a curated
  **~150-app personal life-OS catalog** (the actual list is in §6), keep the long
  tail behind an "Advanced / all apps" toggle.
- **MCP-first is the right default and the ecosystem now supports it.** The MCP
  registry holds ~9,600 servers; OpenAI/Google/Microsoft adopted MCP. Most major
  services have official or strong-community servers. But the dominant *official*
  pattern is **remote (HTTP) + OAuth, vendor-hosted**, which round-trips through the
  vendor's endpoint — fine (same trust boundary as using the vendor's own app), but
  worth surfacing to a privacy-conscious user. For Gmail/Drive (no official server)
  use the canonical community local stdio servers.
- **Banking is the hard part and has a clean local-first answer: SimpleFIN Bridge.**
  No company registration, no hosted callback, read-only, user-revocable, ~$15/yr,
  called directly from the desktop. Plaid/MX/Finicity/Yodlee/Akoya/SnapTrade are
  powerful but B2B/company-vetted and cloud-callback by design — not a clean fit
  for a zero-server local app. Work at the *service/aggregator* level, never bank
  account numbers.

---

# PART 1 — Codebase recon (current Apps implementation)

Two repos:
- **Desktop:** `/Users/you/Documents/fru/fd-apps/prevail-desktop` (Tauri + React/TS)
- **Engine/CLI:** `/Users/you/Documents/fru/fd-apps/prevail-cli` (Bun/TS)

## 1.1 The Apps UI (desktop)

The Apps page was rebuilt around the redesign in `docs/APPS-REDESIGN.md` ("an app
is working iff it's reliably refreshing the vault on a schedule"). Two source files:

### `src/appspanel.tsx` (502 lines) — the connected-apps list

- `AppsPanel({ vaultPath })` — `appspanel.tsx:77`. Loads apps via
  `invoke<EngineApp[]>("engine_apps_list")` (`:85`), groups them by a **4-state
  status** model and renders one `AppCard` per app.
- **Status model** — `appStatus()` (`:21`) folds the engine's many status strings
  into four states: `connected | connecting | attention | disconnected`.
  `STATUS_META` (`:29`) maps each to a glyph/tint/dot. Groups render in order
  `attention → connecting → connected → disconnected` (`:118`) so problems surface
  first. A "`N of M apps live`" counter at `:166`.
- **Method badge** — `methodLabel()` (`:37`) renders MCP / Composio / Browser /
  CLI / API from the engine's `integration` id.
- **Per-app card** — `AppCard` (`:195`). Collapsed row = initial avatar, title,
  status pill, method badge, last-sync rel-time, schedule, next-due, domain chips.
  Expanded detail exposes the full **edit** surface (this is how a connection is
  edited):
  - **Change method by hand** — a `<select>` of `mcp/api/oauth/browser/manual`
    calling `engine_app_set_integration` (`changeMethod`, `:269`).
  - **Re-evaluate method** — re-runs the Connection Agent (`engine_app_connect`
    with `reevaluate:true`) and reports if a better method exists now (`reevaluate`,
    `:279`). Manual only; never auto-swaps a working connection.
  - **Edit schedule** — cadence picker (hourly / 6h / 12h / daily / weekly + time +
    weekday) → `engine_app_set_schedule` (`saveSchedule`, `:249`).
  - **Edit domains fed** — toggles domains (fetched via `scan_vault`) →
    `engine_app_set_domains` (`saveDomains`, `:226`).
  - **Config reveal** — shows `app.path` and opens it in Finder (`open_in_finder`,
    `:455`) so the user can see the manifest + connector config.
  - **Recent activity** — last runs (`app.runs`, `:468`) with ok/fail + summary.
  - **Scheduled-sync toggle** — `engine_app_set_enabled` pauses autonomous sync
    while keeping the app configured (`:484`; "Sync now" still works when paused).
  - **Sync now** — `engine_app_sync` (`syncNow`, `:104`).
- **In-app autonomous scheduler** — `startAppsScheduler(vault)` (`:60`). A 60s tick
  (`:73`) that, when `PREF.appsAutoSync` is on, calls `engine_apps_sync_due` on a
  cadence (default 300s) so apps refresh on their own schedule **while the app is
  open**. The headless `daemon --sync` does the same when the app is closed.

### `src/appconnect.tsx` (209 lines) — the "Connect an app" flow

This is **how a user adds an app today**: not a catalog + tier + auth forms, but a
**goal sentence**.

- `ConnectAppFlow` (`:28`). Two inputs: app **name** + a **goal** ("what should it
  pull in, and into which domain?"). One button: "Find the best way to connect."
- Calls `engine_app_connect` with `{name, goal, vault, provider, model}` (`find`,
  `:67`). The engine's **Connection Agent** researches the method and returns a
  `Plan` `{integration, why, auth_step, schedule, domains, data}` plus a
  `verified`/`proof` result (it tests the connection itself).
- **Duplicate guard** — `match` (`:56`) fuzzy-matches the typed name against
  already-connected apps and offers "open it instead of creating a duplicate."
- **Method-research progress** — a cycling phase list (`RESEARCH_PHASES`, `:35`:
  "Checking for an MCP server… / official API / local CLI / Composio / browser").
- **One auth step** — if the plan needs auth, it renders exactly one instruction
  ("sign in to Google" / "paste an API key" / "I'll open a browser; log in once").
  Verified connections show a green "Connected + verified" with proof (`:176`).

**Connection methods that exist (the labels the UI exposes):** MCP, API, OAuth,
CLI, Composio, Browser (Playwright), Manual.

**Legacy catalog browser** still exists under "Advanced" via Rust command
`ingestion_connector_catalog`, consumed by `src/settings3.tsx:92` — this is the
old "browse 1000 apps and add" path, separate from the goal-driven flow.

## 1.2 Where the catalog comes from (the ~1000 apps)

- **Source file:** `src-tauri/resources/connectors/catalog.json` (180 KB).
  Top-level: `{ version:2, note, patterns, fallbackLadder, domains[30], apps[] }`.
- **Size:** **1,468 apps.** Breakdown by domain: `dev` 340, `productivity` 127,
  `career` 117, `travel` 114, `money` 89, `learning` 65, `shopping` 64, `media` 55,
  `health` 53, `realestate` 53, `utilities` 41, `insurance` 36, `files` 32,
  `automotive` 30, `communication` 27, `fitness` 27, `food` 24, `social` 24,
  `family` 22, `security` 20, `investing` 17, `news` 15, `taxes` 15, `government` 14,
  `legal` 11, `credit` 9, `smarthome` 9, `calendar` 8, `email` 8, `giving` 2.
- Each app: `{ name, domain, pattern (api|oauth|cli|browser), sources[]
  (chatgpt|claude|gemini), verified, tier (1|2), obscure }`.
  - **By pattern:** api 1224, browser 159, oauth 72, cli 13.
  - **By tier:** tier-1 (core) 400, tier-2 1068.
  - **obscure=true: 853** (the long-tail junk). verified=true: 1260.
  - The `note` field says it was sourced from "the real connector directories of
    Claude/ChatGPT/Gemini (June 2026) plus preserved household-name life
    essentials" — i.e. an aggregation of three assistants' app pickers, which is
    why it's full of B2B SaaS and dev tools.
- **Provenance / generation:** logos come from `logos.json` (300 KB, 278 brand SVG
  paths) built by `scripts/gen-logos.mjs` + `enrich-logos.mjs`; tags by
  `scripts/gen-tags.mjs`. There's no single "generate catalog" script checked in —
  it's a curated/aggregated artifact.
- A small separate `cli_providers.json` lists the 4 official-CLI providers wired
  for the CLI runner: GitHub (`gh`), 1Password (`op`), Stripe (`stripe`), Google
  Cloud (`gcloud`).

**Note:** `catalog.json` is NOT read by the Connection Agent (which researches
live). It powers the legacy "browse the catalog" UI and onboarding. So curating it
is a UI/scope change, low-risk to the connect flow.

## 1.3 How connected apps are stored (manifest + secrets)

On-disk a connected app is a **folder** (the connector-architecture.md shape):

```
<vault>/apps/<id>/            (new apps scaffold INTO the vault — single source of truth)
  manifest.json               name, integration, connections[], refresh, domains, routes, auth_check, autonomy, account
  SKILL.md / connection.md    human overview
  skills/<skill>.md           runnable skill files (YAML frontmatter: runner, trigger, inputs, outputs, http/mcp/cli)
  sync-state.json             cursor, runs ring (last 20), next_due_ts, consecutive_failures, backoff
  connection-status.json      mirrored health {status, lastSuccessTs, lastError}
  data/                       synced data (JSONL/JSON/MD)  [per architecture doc]
```

- **Types** (`prevail-cli/src/vault.ts`): `AppSkill` (`:528`) =
  `{ id, title, domains[], integration ("api"|"oauth"|"browser"|"mcp"|"manual"),
  status, lastSuccessTs/lastError, configured, authCheck, oauth, refresh,
  autonomy ("read-only"|"draft"|"act"), enabled, account{label,address}, routes[],
  connections[] }`. `AppConnection` (`:600`) = ordered fallback strategies
  `{kind, description, auth_check, skill}`. `AppRoute` (`:616`) =
  `{match (glob), domain, copy?}`.
- **Discovery dirs** — `communityAppsDirs` (`vault.ts:642`): `~/.prevail/apps`
  (user), `$PREVAIL_APPS_DIR` (dev), bundled `apps/community/` (ships with binary).
  Examples on disk today: `apps/community/{gmail, google-calendar, github, plaid,
  linkedin, youtube-analytics}`.
- **Multi-strategy connections** — see the **gmail** manifest: `connections[]` =
  `[{kind:"mcp", auth_check:env-keys GMAIL_MCP_COMMAND, skill:"sync-inbox-mcp"},
  {kind:"oauth", auth_check:file-exists refresh.token, skill:"sync-inbox"},
  {kind:"cli", auth_check:command gam version, skill:"sync-inbox-cli"}]`. Probed in
  order; first passing `auth_check` becomes the active connection. This *is* the
  fallback ladder, expressed per-app.
- **Secrets** — credentials are **never** written into the app folder or the vault.
  OAuth tokens are files at `~/.prevail/connectors/<id>/auth/` (`refresh.token`,
  `oauth.json`), written `chmod 0600` by `oauth-flow.ts` (`:243`); `client_secret`
  is env-only, never serialized. API keys live in env (`~/.ai/env/.env` /
  `~/.prevail` env). `looksLikeSecretFile` (`daemon-sync.ts:217`) blocks
  credential-shaped artifacts from ever being copied into the vault.
  - **Gap vs. spec:** `APPS-CONNECTORS-PLAN.md` and the keychain claim
    (`ingestion/keychain.rs` macOS Keychain) describe keychain storage, but the
    **TS engine path actually uses 0600 files + env**, not the macOS Keychain. The
    Rust `ingestion/keychain.rs` exists for the Rust tier path; the live connector
    engine is the TS path. **Unifying on the OS keychain is a real P1 item.**

## 1.4 How a domain consumes app data

The sync daemon writes results as `kind:"intent"` records into each target
domain's `_intents.jsonl` (`routeIntents`, `daemon-sync.ts:142`) — the **same
ledger every other surface writes** — so the existing distiller folds synced data
into `_memory.md` / `_state.md` with no new machinery. `copy:true` routes also copy
matched artifacts into `<vault>/<domain>/imports/<app>-<file>` with a provenance
sidecar (`copyRoutedArtifacts`, `:172`). Many-to-many: one app's run can feed
several domains; targets come from `app.routes[]` or default to `app.domains`.

## 1.5 The scheduled / autonomous pull mechanism (already built)

`prevail-cli/src/daemon-sync.ts` — **the autonomous-sync daemon**. Pattern-first:
the loop knows nothing about any specific app. Per due app, five steps:
`due? → probe auth → run refresh skill (+ after: chain) → route into domains →
advance cursor`.

- `runSyncDaemon` (`:442`) wakes every `tickSec` (default 60, min 30), runs
  `syncOnce` capped at `maxRunsPerTick` (default 2, to cap model/API spend).
- `syncOnce` (`:286`) selects apps with `refresh && status != "not-configured" &&
  enabled !== false`; due check via `next_due_ts` (`:299`); per-app file lock
  (`tryAcquireLock`, `:302`) so the daemon and the in-app scheduler never collide.
- **Auth first** — `probeConnector` runs before any model call so a dead token
  doesn't burn a run (`:307`).
- **Backoff** — `backoffNextDue` (`:113`): after N consecutive failures, push next
  due out (2^N × 5min, capped 6h) so a broken connector doesn't hammer its API.
- **Failure elevation** — after 3 consecutive failures, `elevateFailure` (`:201`)
  writes a `- [ ] Fix <app> sync:` task into each target domain's `_tasks.md`, once.
- **Status mirror** — `mirrorConnectionStatus` (`:90`) writes
  `connection-status.json` so every status surface reflects sync health.
- `syncApp` (`:381`) = the on-demand "Sync now" path (same machinery, ignores
  schedule).

**Daemons that exist** (`daemon-launchd.ts:13`): three LaunchAgents install at
login — `sh.prevail.learn` (`--learn`: distill/taskgen/skillgen/intent self-learning),
`sh.prevail.loops` (`--loops`: domain loop advancement), `sh.prevail.sync`
(`--sync`: this app refresh). Each is a forever-loop with the interval inside.
**Follow-up noted in the redesign doc:** confirm `--sync` is installed alongside
`--learn` so apps also refresh when the desktop app is fully closed.

## 1.6 How the engine talks to a connected service (runners)

`prevail-cli/src/runners.ts` — six pattern runners, all driven by skill
frontmatter, no per-app TypeScript. Shared `substituteFull()` (`:30`) expands
`${cursor.x}`, `${input.x}`, `${env.x}`, `${date}`, `${auth.token}` (lazily
refreshing OAuth via `oauth-flow.ts`).

| Runner | What it does | file:line | Notes |
|---|---|---|---|
| `mcp` | spawns a **local stdio MCP server**, JSON-RPC `initialize → tools/call` | `runSkillMcp` `:314` | command from `mcp_command:`; regex-validated, no `..`, no shell, 15s timeout |
| `a2a` | **remote** MCP over HTTPS JSON-RPC to `mcp_url:` | `runSkillA2a` `:418` | `isUnsafeRemoteUrl` guard (`:400`): https-only, blocks localhost/RFC1918 |
| `api` (http) | declarative REST: templated url/method/headers/body | `runSkillHttp` `:199` | **https-only** (`:225`), cursor via JSON path; default for `runner:api` |
| `cli` | runs `command:` via `/bin/sh -c`, scoped env, cwd=connector | `runSkillCli` `:88` | 5-min timeout, 512KB cap |
| `browser` | read-only Playwright scrape via a **fixed driver script** | `runSkillBrowser` `:473` | no user code; url/selector via env; Playwright user-installed |
| `llm` | spawns a CLI model (claude/codex/gemini) with auth + tools attached | `connector-skills.ts` (`runSkillLLM`) | "covers 80% of skills"; the model does the logic |

- **Autonomy gate** is enforced upstream in `connector-skills.ts` (`runSkill`,
  ~`:577`) per op-class — read-only / draft / act — at the runner boundary, in code.
- Outputs are always sandboxed to the connector dir (`safeOutputPath`).

## 1.7 The Connection Agent (autonomous-connect / probe)

- **Connection Agent** — `prevail-cli/src/index.tsx:1954` (`connectors connect`),
  exposed to desktop as `engine_app_connect` (`prevail-desktop/src-tauri/src/engine.rs:800`).
  It is **LLM-driven with live web search, NOT catalog-driven** — it does *not* read
  `catalog.json`. It prompts a CLI model (`runChatTurn`, `act:true`) to research the
  best method right now and return strict JSON. **Preference ladder in the prompt**
  (`index.tsx:1990`): **MCP > official API/SDK or installed CLI (gcloud/gh) >
  Composio > browser automation.** The model must also return a concrete
  `auth_check` so the connection is verifiable (`:1992`).
- On success: `scaffoldCommunityApp` (`vault.ts:1207`) writes the app folder
  (manifest + SKILL.md + connection.md + connection-status.json) **into the vault**.
  Then **autonomously verifies**: if `auth_step.kind === "none"` and an `auth_check`
  exists, it runs `probeConnector` immediately and returns `{verified, proof}`.
- `--reevaluate` (`:1971`) = research-only; reports whether a better method exists,
  does not scaffold.
- **The probe** — `prevail-cli/src/connector-probe.ts`. `probeConnector` (`:68`)
  dispatches by `auth_check.kind`: `env-keys` (every key set), `file-exists`
  (token/session file present), `command` (spawn + exit code + stdout match),
  `http` (GET with auth header, 401/403→`expired`), `mcp` (stdio binary on PATH, or
  http endpoint up), `manual` (watched file freshness). Multi-strategy: tries each
  `connections[]` entry in order, first pass wins (`:72`). SSRF guard `isUnsafeUrl`
  (`:454`) blocks metadata endpoints.

## 1.8 Prevail's own MCP role

Prevail is **both** an MCP client and an MCP server.
- **Server** (`mcp-server.ts:107`): exposes Prevail's intelligence as MCP tools —
  `council, chat, list_domains, read_state, read_log` — so an external host (Claude
  Desktop) can drive Prevail. `mcp-config.ts` only manages Prevail's *own* server
  auth token (`~/.prevail/mcp.json`, chmod 0600) — unrelated to connecting external
  services.
- **Client** (the `mcp`/`a2a` runners): each connected app names its own
  `mcp_command`/`mcp_url`; there's no central registry of external MCP servers yet.

## 1.9 Current-state scorecard

| Capability | State | Where |
|---|---|---|
| 4-state status UI + method badge + last/next sync + domain chips | **Built** | `appspanel.tsx` |
| Describe-the-goal connect + Connection Agent + one auth step + verify | **Built** | `appconnect.tsx`, `index.tsx:1954` |
| Edit method / re-evaluate / schedule / domains / pause / sync-now | **Built** | `appspanel.tsx:226-295` |
| Six runners (mcp/a2a/http/cli/browser/llm) | **Built** | `runners.ts`, `connector-skills.ts` |
| Multi-strategy auth probe + fallback ladder | **Built** | `connector-probe.ts` |
| Autonomous sync daemon: cursor, backoff, elevation, lock | **Built** | `daemon-sync.ts` |
| Route synced data into domain `_intents.jsonl` (distiller picks up) | **Built** | `daemon-sync.ts:142` |
| launchd `--sync` agent (closed-app refresh) | **Built, verify install** | `daemon-launchd.ts` |
| Curated personal catalog (~150 vs 1468) | **GAP** | `catalog.json` |
| Secrets on **OS keychain** (vs 0600 files/env) | **GAP / partial** | `oauth-flow.ts` files; `keychain.rs` unused by TS path |
| First-party seeded connectors beyond 6 community apps | **GAP** | `apps/community/` (6 apps) |
| SimpleFIN (local-first banking) connector | **GAP** | — |
| Tabbed app-detail workspace (Overview/Auth/Sync/Skills/Data/Chat) | **Partial / planned** | `connector-architecture.md` |
| "Connect with data preview" / data tab | **GAP** | — |

---

# PART 2 — External research (best-practice patterns)

## 2.1 Local-first "personal data warehouse" patterns

**The canonical architecture: per-source extractors → local store → scheduled
incremental sync → tokens in a local secure store.** This is exactly what Prevail's
sync daemon already does (skills = extractors, vault = store, cursors = incremental,
`~/.prevail/.../auth` = token store). Prior art validates the shape:

- **Dogsheep (Simon Willison)** — the reference implementation of a personal data
  warehouse. A family of `{source}-to-sqlite` CLIs (`twitter-to-sqlite`,
  `github-to-sqlite`, `healthkit-to-sqlite`, `evernote-to-sqlite`) each pull one
  source into local SQLite, browsed via Datasette. Philosophy: "reclaim your data";
  prefer the official API, fall back to the service's "export your data" ZIP when no
  API exists. ([dogsheep.github.io](https://dogsheep.github.io/),
  [Personal Data Warehouses](https://simonwillison.net/2020/Nov/14/personal-data-warehouses/),
  [twitter-to-sqlite](https://github.com/dogsheep/twitter-to-sqlite),
  [Datasette ecosystem](https://docs.datasette.io/en/stable/ecosystem.html))
  - *Takeaway for Prevail:* one extractor (skill) per source normalizing into a
    shared store is the right unit. Add a "manual / export-ZIP import" runner as a
    universal fallback for sources with no API (Apple Health already follows this).
- **ELT connector standards** — **Singer.io** taps/targets (JSON spec, incremental
  state) is a lightweight connector contract that maps onto Prevail's skill
  frontmatter. **Airbyte** (self-hostable, hundreds of connectors) is borrowable
  conceptually but **too heavy to embed** (Docker/K8s). **Fivetran** is cloud-only —
  **disqualified** for local-first. ([Airbyte vs Singer](https://hevodata.com/learn/airbyte-vs-singer/),
  [Fivetran vs Airbyte](https://portable.io/learn/fivetran-vs-airbyte-comparison))
- **rclone** — the model for "connect to many backends privately": one uniform
  backend interface over 70+ services, OAuth tokens stored locally (optionally
  encrypted), a `crypt` backend for client-side encryption. ([Storage Backends](https://deepwiki.com/rclone/rclone/3-storage-backends),
  [OAuth/Auth](https://deepwiki.com/tgdrive/rclone/5.2-oauth-and-authentication),
  [rclone docs](https://rclone.org/docs/))
  - *Takeaway:* replace rclone's encrypted-config-file with the **OS keychain** —
    the strongest local-first credential pattern (Keychain / Credential Manager /
    Secret Service). This is the credential-storage gap noted in §1.3.
- **Browser-automation scraping (when no API)** — feasible but costly: **fragility**
  (DOM changes break selectors), **anti-bot detection → CAPTCHAs** (stealth plugins
  get flagged), **2FA** (one-time interactive login persists a session; CAPTCHAs
  need avoidance or paid solvers), and **ToS/legal** exposure (post *Meta v. Bright
  Data* 2024 the question is contractual ToS, which finance sites prohibit).
  ([Playwright scraping](https://oxylabs.io/blog/playwright-web-scraping),
  [anti-bot guide](https://bug0.com/knowledge-base/playwright-web-scraping),
  [is web scraping legal](https://www.browserless.io/blog/is-web-scraping-legal))
  - *Nuance favoring Prevail:* browser automation runs on the **user's own machine,
    with the user's own credentials/session** — closer to "the user automating their
    own access" than third-party scraping. Still: prefer APIs, treat browser as
    best-effort fallback, expect breakage.

## 2.2 Financial data — local-first, at the service/aggregator level (no account numbers)

**Feasibility verdict up front:**
- **Local-first FEASIBLE (no cloud intermediary you must run):** **SimpleFIN Bridge**
  (US/CA), direct **brokerage/crypto APIs** (Schwab, Coinbase), **OFX/CSV import**.
  GoCardless/Nordigen (EU) *was* feasible but is closed to new customers.
- **REQUIRES company vetting and/or a hosted callback (NOT a clean fit):** **Plaid,
  MX, Finicity (Mastercard), Yodlee (Envestnet), Akoya, TrueLayer, Tink, SnapTrade.**

### SimpleFIN Bridge — the local-first sweet spot (US/Canada) — RECOMMENDED
A **read-only, user-permissioned open protocol** ("a window on a safe: look but not
touch"). No API key for your app, no company registration. Two-token flow: the user
authenticates at the SimpleFIN Bridge and gets a one-time setup token → your app
POSTs it once to claim a permanent **Access URL** (contains connection-specific HTTP
Basic creds, not the bank password) → your app stores the Access URL **locally** and
GETs `/accounts` for balances + transactions. **App never sees bank credentials; all
read-only; user can revoke anytime (403 signals revocation); a desktop app calls it
directly with no network intermediary for credential handling.** ~$1.50/mo or $15/yr,
North American banks, MX upstream, ~daily refresh. The only secret to protect is the
Access URL → **OS keychain**. ([simplefin.org](https://www.simplefin.org/),
[protocol](https://www.simplefin.org/protocol.html),
[security](https://beta-bridge.simplefin.org/info/security),
[Actual Budget setup](https://actualbudget.org/docs/advanced/bank-sync/simplefin/))

### Plaid and the B2B aggregators
- **Plaid** — embed Link → user OAuths to bank → read-only tokens for
  balances/transactions. A newer free **Trial plan** (US/CA) gives real data for up
  to 10 Production Items and major OAuth banks, with a more user-friendly
  non-business questionnaire. **But** it's architecturally a cloud-callback product
  (OAuth redirect + webhooks) and approval assumes a company. Usable by a hobbyist
  with a self-hosted callback; **not a clean fit for a zero-server desktop app.**
  ([Plaid API](https://plaid.com/docs/api/),
  [Can I use Plaid for free](https://support.plaid.com/hc/en-us/articles/16194695660311-Can-I-use-Plaid-for-free))
- **MX / Finicity (Mastercard) / Yodlee (Envestnet) / Akoya** — all B2B,
  company-vetted, enterprise sales. **Akoya** is the cleanest model (bank-owned,
  100% API, no screen-scraping, consumer-permissioned, 4,300+ institutions) but
  membership is for fintechs/aggregators/FIs, **not individuals**.
  ([Plaid alternatives](https://www.openbankingtracker.com/api-aggregators/plaid/alternatives),
  [akoya.com](https://akoya.com/))
- **EU open banking** — **GoCardless Bank Account Data (formerly Nordigen)** was the
  one free PSD2 API for individual devs (2,300+ banks, 31 countries) but is **no
  longer onboarding new customers** (~Sept 2025). TrueLayer / Tink (Visa) / Yapily /
  Salt Edge are enterprise-only. ([Nordigen free API](https://nordigen.medium.com/were-launching-a-free-psd2-data-api-for-europe-941f6298c0dc),
  [closed to new signups](https://forum.invoiceninja.com/t/gocardless-nordigen-service-no-longer-available-alternative-needed/22576))

### What self-hosted finance apps do (validates the design)
- **Actual Budget** → SimpleFIN (NA) + GoCardless (EU) + Pluggy (Brazil).
- **Firefly III** → Nordigen/GoCardless (EU).
- **Monarch Money** (cloud) → Plaid + Finicity + MX (which is *why* it's cloud).
- Pattern: **local/self-hosted apps lean on SimpleFIN (US) and Nordigen (EU)**
  precisely because those don't require being a vetted company. ([Actual: bank sync](https://actualbudget.org/docs/advanced/bank-sync/),
  [Monarch data providers](https://help.monarch.com/hc/en-us/articles/33707613533972-Understanding-Data-Providers-and-Connections))

### Brokerages & crypto (read-only)
- **Charles Schwab** — public Developer Portal; an individual brokerage account gets
  read-only "Accounts & Trading" + "Market Data" APIs (OAuth redirect flow).
  Genuinely usable by an individual. ([Schwab Developer Portal](https://developer.schwab.com/))
- **Fidelity** — **no general retail developer API** (institutional only).
- **Vanguard** — **no developer API at all.**
- **SnapTrade** — the brokerage analog to Plaid: one unified read-only API across
  Robinhood/Schwab/Fidelity/Vanguard/Coinbase; markets to individual investors; but
  hosted aggregator (OAuth/cloud-callback). Best uniform coverage for the no-API
  brokerages, with the same local-first caveat as Plaid. ([snaptrade.com](https://snaptrade.com/))
- **Coinbase** — developer API with read-only scopes; a local app can use the user's
  own read-only key directly — a clean local-first fit.
- **OFX / QFX / CSV import** — the most purely local-first path (manual/file-based
  refresh, zero aggregator dependency). Good universal fallback.

## 2.3 The MCP ecosystem (the scalable connection method)

**Strategic picture (mid-2026):** MCP is the default integration layer. Official
registry ~9,600 servers; crawlers (Glama) index ~37,000. OpenAI/Google/Microsoft
adopted it. **The dominant *official* pattern is REMOTE (HTTP) + OAuth,
vendor-hosted** — which round-trips data through the vendor's endpoint (acceptable:
same trust boundary as using the vendor's own app, but worth surfacing). For true
local stdio + read-only you rely on excellent community servers — two are
near-canonical: **`taylorwilsdon/google_workspace_mcp`** (all Google, real
`--read-only`) and **`softeria/ms-365-mcp-server`** (all Microsoft, `--read-only`,
no Copilot license needed). Anthropic's first-party reference servers (Gmail-ish,
Drive, Maps, Slack, GitHub) are **archived** — don't build on them.
([registry](https://registry.modelcontextprotocol.io/),
[anniversary](https://blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/),
[servers-archived](https://github.com/modelcontextprotocol/servers-archived))

**Server availability by category** (O=official vendor, C=community, L=local stdio,
R=remote HTTP):

| Category | Service | Server | Transport | Read-only |
|---|---|---|---|---|
| Email | Gmail | **None official** — `taylorwilsdon/google_workspace_mcp` (C) | L+R | Yes (`gmail.readonly`) |
| Email | Outlook/M365 | MS Work IQ (O, preview, Copilot-gated); `softeria/ms-365-mcp-server` (C) | R / L | scope / `--read-only` |
| Calendar | Google Calendar | Google-managed (O, preview) `calendarmcp.googleapis.com`; community | R / L | Yes |
| Calendar | Outlook Calendar | MS Work IQ (O, preview); softeria (C) | R / L | yes/scope |
| Calendar | Apple Calendar | **None** — `FradSer/mcp-server-apple-events` (C, EventKit) | L (macOS) | partial |
| Files | Google Drive | **None official** (Anthropic ref archived) — google_workspace_mcp (C) | L+R | Yes (`drive.readonly`) |
| Files | OneDrive | MS Work IQ (O, preview); softeria (C) | R / L | scope/`--read-only` |
| Files | Dropbox | **Official** `mcp.dropbox.com/mcp` (beta) | R | scope |
| Files | Box | **Official** `mcp.box.com` (production) | R | yes (folder-scoped) |
| Notes/Prod | Notion | **Official** `mcp.notion.com/mcp` | R | perm-bound |
| Notes/Prod | Linear | **Official** `mcp.linear.app/mcp` | R | perm-bound |
| Notes/Prod | Atlassian (Jira/Confluence) | **Official** (Rovo, GA Feb 2026) | R | perm-bound |
| Notes/Prod | Asana | **Official** `mcp.asana.com/v2/mcp` | R | perm-bound |
| Notes/Prod | ClickUp | **Official** (beta) | R | perm-bound |
| Notes/Prod | Todoist | **Official** `ai.todoist.net/mcp` + community local | R / L | partial |
| Notes/Prod | Obsidian | **Community** (Local REST API plugin) | L | Yes (fully local) |
| Notes/Prod | Trello | **Community** (`delorenj/mcp-server-trello`) — NOT in Atlassian's | L | partial |
| Comms | Slack | **Official** (Salesforce/Slack, GA Feb 2026; Anthropic ref archived) | R | perm-bound |
| Comms | Discord | **Community** (bot token) | L | via perms |
| Comms | Telegram | **Community** (MTProto / bot) | L | partial |
| Comms | WhatsApp | **Community** `lharries/whatsapp-mcp` (whatsmeow, local SQLite, QR) | L | Yes — fully local |
| Finance | Plaid | Official MCP is **dev diagnostics only — NOT consumer data**; use `elcukro/bank-mcp` (C) with your own keys | R / L | read-only (community) |
| Finance | Stripe | **Official** `mcp.stripe.com` | R+L | yes (read-only key) |
| Finance | PayPal | **Official** `paypal/paypal-mcp-server` | R+L | yes (txn reports) |
| Finance | QuickBooks | **Official** `intuit/quickbooks-online-mcp-server` | L | yes (BS/P&L/cashflow) |
| Finance | Coinbase | **Official** (AgentKit/CDP) | L | action-oriented |
| Finance | Schwab | **Community** `sudowealth/schwab-mcp` (real Schwab OAuth) | L/R | yes |
| Finance | Fidelity | **None** — brittle Playwright server only | L | fragile |
| Health | Apple Health | **None** — `neiltron/apple-health-mcp` (XML export) | L | yes (export) |
| Health | Oura | **None official** — `tomekkorbak/oura-mcp-server` (PAT) | L | yes (easiest) |
| Health | Whoop | **None official** — community over official OAuth API | L | yes |
| Health | Fitbit | **None official** — `TheDigitalNinja/mcp-fitbit` (OAuth) | L | yes |
| Health | Garmin | **None official** — reverse-engineered login (can break) | L | mostly |
| Other | GitHub | **Official** (highest maturity; remote OAuth2.1 + local PAT; read-only toolsets) | R+L | yes (configurable) |
| Other | Google Maps | **Official from Google** (older ref archived) | R | yes (grounding) |
| Other | Spotify | Anthropic-hosted connector (R) + community OAuth servers | R/L | action-capable |
| Other | YouTube | **Community** (Data API v3 key read; OAuth write) | L | read via key |

**Key finance nuance:** Plaid's *official* MCP (`api.dashboard.plaid.com/mcp`) is
for developer diagnostics — it does **not** expose consumer transactions/balances.
To actually read transactions you use a **community server with your own keys** —
best maintained is **`elcukro/bank-mcp`** (local stdio, strictly read-only, supports
Plaid/Teller/Enable Banking/Tink, 15k+ institutions). ([Plaid MCP](https://plaid.com/docs/resources/mcp/),
[bank-mcp](https://github.com/elcukro/bank-mcp))

**Registry landscape:** Official MCP Registry ~9,600 (preview, API v0.1); Glama
~37,000 (crawl); mcp.so ~19,700; PulseMCP ~11,800 (hand-reviewed); Smithery
(registry + hosting/proxy). Sub-registries build on the official one; overlap
explains the count spread. ([official registry](https://github.com/modelcontextprotocol/registry),
[PulseMCP](https://www.pulsemcp.com/servers))

**Composio** — managed integration platform, **1,000+ apps (500+ managed OAuth)**
via SDK and MCP. It *is* an OAuth gateway: it stores the user's tokens in
**Composio's cloud vault**, auto-refreshes them, and **makes the actual upstream API
call from its own infrastructure** (brokered-credential model). This is **at odds
with strict local-first** — it centralizes credentials and routes live traffic
through Composio's cloud. A self-hosted Docker option recovers sovereignty but
erases most of the convenience (you register your own OAuth app per integration).
**Verdict: keep Composio as an optional, clearly-labeled managed convenience layer,
never the core.** ([composio.dev](https://composio.dev/),
[managed auth](https://docs.composio.dev/docs/managed-authentication),
[security guide](https://composio.dev/content/secure-ai-agent-infrastructure-guide))

---

# PART 3 — Recommendations (strategy, layout, plan)

## 3.1 Connection-method strategy

Keep the existing **preference ladder** in the Connection Agent, refined and made
privacy-explicit. Per app, choose the first that applies:

1. **Local stdio MCP (read-only)** — best for local-first. Default for Google
   (`google_workspace_mcp --read-only` → Gmail/Calendar/Drive), Microsoft
   (`ms-365-mcp-server --read-only`), Obsidian, WhatsApp, Oura/Whoop/Fitbit,
   QuickBooks, Coinbase, GitHub (local PAT), banking via `bank-mcp` with the user's
   own keys.
2. **Official API / OAuth (read-only scope) or installed CLI** — when no good local
   MCP exists but a clean read-only API does: Schwab, Coinbase, Strava, Fitbit/Oura
   direct, Stripe (restricted key), GitHub (`gh`), Google Cloud (`gcloud`),
   1Password (`op`).
3. **Official remote MCP (vendor-hosted, OAuth)** — Notion, Linear, Slack, Box,
   Dropbox, Atlassian, Asana, ClickUp, Google Calendar (managed), Google Maps.
   **Surface a "via vendor cloud" note** so the privacy-conscious user understands
   data round-trips the vendor endpoint (same boundary as the vendor's own app).
4. **SimpleFIN Bridge** — the **dedicated banking path** (US/CA), local-first,
   read-only, user-revocable. Make this a **first-class seeded connector**, not a
   generic "describe a bank" path. (EU: note GoCardless is closed; offer OFX/CSV.)
5. **Browser automation (Playwright, one-time login)** — last resort for portals
   with no API (Fidelity, many insurers, some banks). One-time interactive login
   persists a session; on MFA re-challenge, raise to "needs attention" for triage
   rather than blocking. Expect breakage; label as best-effort.
6. **Manual / export-ZIP import** — universal fallback (Apple Health XML, CSV/OFX
   statements, "export your data" archives). A watched folder + freshness probe
   (already supported via `auth_check.kind:"manual"`).
7. **Composio** — optional, opt-in, clearly labeled "routes through Composio cloud."
   Only when nothing above works and the user accepts the trade-off.

**Make "set up once, runs by itself" real (mostly already true):**
- Keep the **per-app schedule + sync daemon** (`daemon-sync.ts`). Confirm the
  `--sync` launchd agent is installed so closed-app refresh works (§1.5 follow-up).
- **Cap spend** stays via `maxRunsPerTick` + per-app cadence + backoff.
- **Surface status relentlessly** (already done): 4-state badge, last/next sync,
  recent-activity log, and **failure → `_tasks.md` elevation** so a broken
  connector becomes a visible action, not a silent gap.
- **Re-auth without re-setup:** when a token expires (`attention`), the card's
  single CTA should re-run only the auth step (re-OAuth / re-login), not the whole
  connect flow.
- **Method upgrade over time:** keep "re-evaluate" (manual). Optionally a low-freq
  background "is there a better method now?" that only *suggests* (never auto-swaps
  a working connection).

## 3.2 Apps-area UX / layout

Three surfaces; keep the calm single-column, geometric-glyph, no-emoji rules.

### A. Connected-apps list (today's `AppsPanel`) — keep, refine
- Grouped by status (Attention → Connecting → Connected → Not connected), live
  counter, "+ Connect an app." Card = logo · name · status pill · method badge ·
  last/next sync · domain chips. (All built.)
- **Add to the method badge:** a tiny "local" vs "via <vendor> cloud" indicator so
  the privacy posture of each connection is legible at a glance.

### B. Connect flow (today's `ConnectAppFlow`) — keep, add a catalog on-ramp
- Keep the goal-sentence + Connection Agent as the **primary** path.
- Add an optional **"or pick from popular apps"** grid below the input, backed by
  the **curated ~150 catalog** (§6), grouped by life category, with real logos.
  Clicking one pre-fills the name and a sensible default goal, then runs the same
  agent. This gives discovery without forms, and is where the curated catalog lives.
- For **banking specifically**, the grid routes to a **SimpleFIN setup card**
  (paste setup token → claim Access URL → store in keychain) rather than the generic
  agent — because the local-first path is known and shouldn't be re-researched.

### C. App detail — evolve toward the tabbed workspace
The expanded card already covers Overview/Auth/Sync/Domains/Config. Per
`connector-architecture.md`, evolve to tabs as content grows:
- **Overview** — what it pulls, domains fed, status, last/next sync, quick actions.
- **Auth** — method, state, the single re-auth CTA, where the secret lives
  (keychain ref), "test connection."
- **Sync** — schedule picker, last/next, run history, "sync now," pause.
- **Skills** — runnable skills with [Run] + last result.
- **Data** — file tree under the app's `data/`, sizes, last modified, **a small
  preview of the most recent pulled items** (this is the "data preview" the founder
  wants — proof the connection produces real data).
- **Chat** — a connector-scoped chat that sees only this app's `data/`.

### States to design explicitly (per card)
- `disconnected`: "described but not working — needs <X>"; one CTA.
- `connecting`: agent researching / setting up (animated).
- `connected`: method named ("Google MCP, read-only"), last/next sync, domains.
- `attention`: what broke + one CTA (re-auth / fix); already elevated to tasks.
- `manual-pending` (sub-state of disconnected): "waiting for your one step"
  (paste key / sign in / drop file).

## 3.3 Phased TODO

Scoped to what's safe/feasible for a local-first single-user app. Effort: S = <1 day,
M = 1-3 days, L = multi-day.

### P0 — Catalog curation + safety (highest leverage, lowest risk)
- [ ] **Replace the 1468-app catalog with the curated ~150** (§6). Mark everything
  else `obscure`/tier-2 and hide behind "Advanced / all apps." Keep `catalog.json`
  schema; just re-tier. (M)
- [ ] **Add a `connection_hint` to each curated app** (preferred method + known
  MCP server / SimpleFIN / CLI) so the Connection Agent and the catalog on-ramp
  start from the right rung instead of researching from scratch. (M)
- [ ] **Confirm the `--sync` launchd agent installs** alongside `--learn`/`--loops`
  so apps refresh when the desktop app is closed. (S)
- [ ] **Surface the privacy posture** (local vs vendor-cloud) on each method badge
  and in the connect plan. (S)

### P1 — Local-first banking + keychain (the founder's headline use case)
- [ ] **SimpleFIN Bridge connector** as a first-class seeded app: setup-token →
  claim Access URL → store Access URL in **OS keychain** → read-only `/accounts`
  sync skill → route balances/transactions (as service-level summaries, **never
  account numbers**) into `money`/`wealth`/`tax`. (L)
- [ ] **Unify secrets on the OS keychain** (close the §1.3 gap): route OAuth
  tokens + API keys + SimpleFIN Access URL through the keychain instead of 0600
  files/env where the platform supports it; keep 0600 files as fallback. (M)
- [ ] **Seed read-only finance connectors:** Schwab (OAuth read-only), Coinbase
  (read-only key), `elcukro/bank-mcp` (user's own Plaid/Teller keys), QuickBooks
  (official MCP), Stripe/PayPal (official MCP). (M)
- [ ] **OFX/CSV + export-ZIP import runner** as the universal local fallback
  (extends the existing `manual` probe). (M)

### P1 — Seed the catalog with real working connectors (beyond the 6 today)
- [ ] **Google bundle** via `google_workspace_mcp --read-only`: Gmail, Calendar,
  Drive, Docs/Sheets, Contacts, Photos. (M)
- [ ] **Microsoft bundle** via `ms-365-mcp-server --read-only`: Outlook mail +
  calendar, OneDrive. (M)
- [ ] **Health/wearables:** Oura (PAT), Whoop (OAuth), Fitbit (OAuth), Strava
  (OAuth), Apple Health (XML export), Garmin (best-effort). (M)
- [ ] **Productivity/comms official remote MCP:** Notion, Linear, Slack, Todoist,
  GitHub, Obsidian (local), WhatsApp (local). (M)
- [ ] Each seeded app ships a manifest with the **multi-strategy `connections[]`
  ladder** (like gmail) so the probe falls back gracefully. (M, spread across above)

### P1 — App-detail workspace + data preview
- [ ] **Tabbed app detail** (Overview/Auth/Sync/Skills/Data/Chat). (L)
- [ ] **Data tab with last-pulled preview** — proof the connection produces real
  data (the founder's "data preview"). (M)
- [ ] **Re-auth-only CTA** on `attention` cards (re-run just the auth step). (S)
- [ ] **Catalog on-ramp grid** under the connect input (curated list + logos). (M)

### P2 — Scale, polish, autonomy
- [ ] **Background method-upgrade suggester** (low-freq "better method now?" that
  suggests, never auto-swaps). (M)
- [ ] **Connector-scoped chat** ("chat with my <app> data"). (M)
- [ ] **Optional Composio path**, opt-in, clearly labeled "routes through Composio
  cloud," self-host documented. (M)
- [ ] **Browser-tier hardening:** session reuse, MFA re-challenge → triage, clear
  "best-effort / may break" labeling. (L)
- [ ] **Logo/asset pipeline** kept in sync with the curated catalog
  (`gen-logos.mjs`). (S)
- [ ] **First-run-approval option** (founder open question): let a connection's
  first sync surface for approval before going fully unattended. (S)

### Explicit non-goals / guardrails
- **Never enumerate individual bank accounts** — work at the service/aggregator
  level; surface balances/transactions as domain summaries, not account inventories.
- **No cloud intermediary you must run** — SimpleFIN/direct APIs/MCP-local over
  Plaid/SnapTrade/Composio cloud, unless the user explicitly opts in.
- **Credentials never enter the vault** (already enforced) and move to the OS
  keychain.

---

# 4. Curated catalog — recommendation

**Recommended size: ~150 apps** (range 120-180). Rationale: the current 400 tier-1
is still B2B-heavy (50 `dev`, 27 `career` sales tools) and 853 are obscure. ~150 is
the set a real person's "life OS" actually uses — every category covered, no
long-tail noise, every app has a real logo and a known connection method. The other
~1,300 stay behind "Advanced / all apps" (the catalog file keeps them; they're just
re-tiered, so nothing is deleted and the long tail is still reachable).

The list below is drawn from the existing tier-1 set (so logos/metadata already
exist), filtered to personal life-OS relevance and de-duplicated (the catalog has
dupes like "Nike Run Club"/"Nike+ Run Club", "TurboTax"/"Intuit TurboTax", multiple
OEM Notes apps — keep one each).

## §6 The curated ~150 (categorized)

**Email (7)** — Gmail, Outlook / Outlook.com, Yahoo Mail, iCloud Mail, Proton Mail,
Fastmail, Google Workspace (catch-all).

**Calendar (5)** — Google Calendar, Microsoft Outlook Calendar, Apple Calendar,
Fantastical, Calendly.

**Finance — Banking & aggregators (8)** — *service-level only.* SimpleFIN Bridge
(recommended path), Chase, Bank of America, Wells Fargo, Capital One, Citibank,
American Express, Ally Bank. (Plus the SimpleFIN path covers most others without
listing them.)

**Finance — Budgeting & money mgmt (8)** — Monarch Money, YNAB, Rocket Money,
Empower, Credit Karma, Mint-style aggregators via SimpleFIN, Wise, PayPal.

**Payments (6)** — PayPal, Venmo, Cash App, Zelle, Apple Pay, Google Pay.

**Brokerage / Investing / Crypto (10)** — Fidelity Investments, Charles Schwab,
Vanguard, Robinhood, E*TRADE, Merrill Edge, Webull, Betterment/Wealthfront,
Coinbase, Crypto.com.

**Credit & reports (5)** — Credit Karma, Experian, Equifax, TransUnion, myFICO.

**Taxes & accounting (6)** — Intuit TurboTax, H&R Block, FreeTaxUSA, Intuit
QuickBooks, Expensify, Ramp/Brex (for self-employed).

**Productivity / Notes / Tasks (12)** — Notion, Obsidian, Evernote, Apple Notes,
Google Keep, Todoist, TickTick, Things 3, Google Tasks, Trello, Asana, ClickUp.

**Project / Dev (kept minimal for a personal OS) (6)** — GitHub, Linear, Jira,
Google Cloud / AWS (CLI), Vercel, 1Password (op).

**Storage / Files / Docs (9)** — Google Drive, Microsoft OneDrive, Dropbox, Box,
Apple iCloud Drive, Google Docs, Google Sheets, Google Photos, Docusign.

**Health & medical (10)** — Apple Health, Epic MyChart, One Medical, Zocdoc,
Labcorp, Quest Diagnostics, CVS Pharmacy, Walgreens, GoodRx, Teladoc.

**Fitness & wearables (10)** — Oura Ring, Whoop, Fitbit, Garmin Connect, Apple
Fitness, Google Fit, Strava, AllTrails, Peloton, Withings.

**Mindfulness (2)** — Calm, Headspace.

**Insurance (8)** — GEICO, State Farm, Progressive, Allstate, Liberty Mutual,
Aetna, Cigna, UnitedHealthcare. (Mostly browser-tier.)

**Travel & transport (12)** — Google Maps, Waze, TripIt, Uber, Lyft, Airbnb,
Booking.com, Expedia, Google Flights, United / Delta / American / Southwest
(airlines, browser-tier), Marriott / Hilton (hotels).

**Shopping & food (10)** — Amazon, Costco, Best Buy, eBay, Etsy, Instacart,
DoorDash, Uber Eats, Grubhub, OpenTable.

**Communication (10)** — Slack, Microsoft Teams, Discord, Telegram, WhatsApp,
Signal, Zoom, Google Meet, Apple Messages, Contacts.

**Social & media (12)** — X (Twitter), Instagram, Facebook, LinkedIn, Reddit,
YouTube, TikTok, Threads, Pinterest, Spotify, Apple Music / YouTube Music, Netflix.

**News & reading (6)** — Apple News, Google News, Feedly, Substack, NYT, WSJ.

**Smart home (8)** — Apple Home (HomeKit), Google Home, Amazon Alexa, Samsung
SmartThings, Home Assistant, Philips Hue, Ring, ecobee.

**Automotive (2)** — Tesla, (generic OBD/automaker app).

**Government & identity (6)** — IRS online account, Social Security (my SSA),
Login.gov, ID.me, USPS, DMV (state).

**Family & home services (4)** — Life360, Cozi, Care.com, Thumbtack/Taskrabbit.

**Security & passwords (6)** — 1Password, Bitwarden, Dashlane, Authy, NordVPN,
Proton Pass.

**Learning (4)** — Duolingo, Audible, Goodreads, Udemy/MasterClass.

> Total ≈ 150 (some overlap across Finance sub-groups is intentional — they surface
> under multiple life lenses). Every entry exists in today's catalog with a logo;
> curation is a re-tiering + de-dupe, not new asset work.

---

## 5. Sources (consolidated)

**Local-first / data warehouse:** dogsheep.github.io · simonwillison.net/2020/Nov/14
· github.com/dogsheep/twitter-to-sqlite · docs.datasette.io ecosystem ·
hevodata.com Airbyte-vs-Singer · portable.io Fivetran-vs-Airbyte · rclone.org/docs ·
deepwiki.com/rclone storage-backends + oauth · oxylabs.io Playwright scraping ·
browserless.io is-web-scraping-legal.

**Finance:** simplefin.org (+ /protocol.html, beta-bridge security) · plaid.com/docs
· support.plaid.com free-plan · openbankingtracker.com plaid/alternatives · akoya.com
· nordigen.medium.com free-PSD2 · forum.invoiceninja.com gocardless-closed ·
actualbudget.org/docs/advanced/bank-sync (+ /simplefin) · help.monarch.com
data-providers · developer.schwab.com · snaptrade.com (+ /brokerage-integrations).

**MCP:** registry.modelcontextprotocol.io · blog.modelcontextprotocol.io anniversary
· github.com/modelcontextprotocol/servers-archived · github.com/taylorwilsdon/
google_workspace_mcp · github.com/softeria/ms-365-mcp-server · developers.notion.com
mcp · linear.app/docs/mcp · github.com/atlassian/atlassian-mcp-server ·
developers.asana.com mcp · developer.clickup.com mcp · docs.slack.dev slack-mcp ·
github.com/lharries/whatsapp-mcp · plaid.com/docs/resources/mcp · github.com/elcukro/
bank-mcp · docs.stripe.com/mcp · github.com/paypal/paypal-mcp-server · github.com/
intuit/quickbooks-online-mcp-server · github.com/sudowealth/schwab-mcp ·
github.com/tomekkorbak/oura-mcp-server · github.com/TheDigitalNinja/mcp-fitbit ·
github.com/neiltron/apple-health-mcp · github.com/github/github-mcp-server ·
help.dropbox.com mcp · developer.box.com box-mcp · pulsemcp.com/servers ·
composio.dev (+ docs.composio.dev managed-authentication).
