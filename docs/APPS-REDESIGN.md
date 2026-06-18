# Apps — Real-Connection Redesign (2026-06-18)

> Founder's verdict: today an app can read **CONNECTED · MCP** without the user
> ever authenticating. That is **scaffolding, not a working connection**. This
> doc supersedes the old "describe-the-goal" redesign (now in git history). The
> data model, runners, OAuth, keychain, and sync daemon are mostly REAL — the
> hole is the **verification gate**: we mark connected on credential *presence*
> (or worse, on a catalog hint) instead of on a *real data fetch*. We fix that
> first, prove it with PayPal end-to-end, then generalize.

Design-first. No code changed by this doc.

---

## PART A — What actually exists today (honest stub-vs-real audit)

### A0. The crux: why PayPal shows "CONNECTED · MCP" with no auth

There are **two different "PayPal"s** in the product and they get conflated:

1. **The catalog entry** in
   `prevail-desktop/src-tauri/resources/connectors/catalog.json`. PayPal is:
   ```json
   {"name":"PayPal","domain":"money","pattern":"api","tier":1,"curated":true,
    "connection_hint":{"method":"mcp","server":"paypal/paypal-mcp-server",
    "privacy":"vendor-cloud","readOnly":true,"note":"Transaction reports."}}
   ```
   The `connection_hint.method = "mcp"` is **only a starting hint for the
   Connection Agent** (set by `scripts/curate-catalog.mjs:115`). It is **not** an
   installed server, not an auth, not a connection. Any UI that renders the
   method badge off the catalog/integration string will print **"MCP"** here.
   `methodLabel()` in `appspanel.tsx:37-45` maps anything containing "mcp" → "MCP".

2. **A scaffolded app record** under `<vault>/apps/paypal/` (or `data/apps/…`).
   There is **no PayPal app on disk today** (only 6 community apps: gmail,
   google-calendar, github, youtube-analytics, linkedin, plaid). So a "CONNECTED"
   PayPal can only be coming from the **catalog tile** + the status fold being too
   loose — see below.

**The status fold is presence/optimism-biased.** `appStatus()` in
`appspanel.tsx:21-27`:
```ts
export function appStatus(a: EngineApp): AppStatus {
  const s = (a.status || "").toLowerCase();
  if (s.includes("sync") || s.includes("connecting") || s.includes("probing")) return "connecting";
  if (!a.configured) return "disconnected";
  if (a.lastError || s.includes("error|expired|fail|auth")) return "attention";
  return "connected";   // <-- DEFAULT IS "connected"
}
```
The default branch is **connected**. So any app whose engine `status` isn't an
explicit error/expired and which is `configured` reads as the green ● Connected
dot. "Configured" and "connected" are not the same as "we actually pulled data."

**And "connected" in the engine is set on a probe, not a fetch.** The connect
command (`prevail-cli/src/index.tsx` `connectors connect`, ~lines 1954–2037):
- writes a manifest via `scaffoldCommunityApp()` (`vault.ts:1207-1250`) with
  initial `connection-status.json → {"status":"not-configured"}` (`vault.ts:1250`),
- if `auth_step.kind === "none"`, runs `probeConnector()` **once** and reports
  `verified = probe.ok` (`index.tsx:2017-2034`).

Then `daemon-sync.ts` flips status to **"connected"** via
`mirrorConnectionStatus(app,"connected",…)` whenever a **probe passes** —
and the probe kinds (`connector-probe.ts`) are mostly **presence checks**:
- `env-keys` → the listed env vars are non-empty (`connector-probe.ts:143-165`),
- `file-exists` → the refresh-token file exists (`:167-184`),
- `command` → a command exits 0 (e.g. the e2e test literally uses `command:"true"`,
  see `connect-e2e.test.ts:44`),
- `http` → a GET returns 200 (`:261-328`) — **this one is real auth validation**,
- `mcp` → the server binary answers `--help` / a JSON-RPC ping (`:330-400`) —
  **availability, not authenticated data**.

**Conclusion.** "Connected" today means *"a credential/binary appears to be
present"* (or, for the catalog tile, *"we have a hint that PayPal could use
MCP"*). It does **not** mean *"we authenticated and pulled real data once."* That
is exactly the founder's complaint. The fix is a **fetch-gated** definition of
connected.

### A1. Connect flow (UI → Tauri → engine), file:line
- UI: `prevail-desktop/src/appconnect.tsx` — single input (name + goal),
  calls `invoke("engine_app_connect", {name, goal, vault, provider, model})`
  (`appconnect.tsx:74`). Renders the returned plan, an optional **one auth step**
  (`:188-196`), and `verified`/`proof` badges (`:176-186`). The "verified" badge
  is shown purely from the engine's probe result.
- Tauri: `engine_app_connect` in `prevail-desktop/src-tauri/src/engine.rs:800-825`
  → shells `connectors connect --name --goal --vault --json`.
- Engine "Connection Agent": `prevail-cli/src/index.tsx` ~`1983-1997` builds an
  LLM prompt ("You are Prevail's Connection Agent…") via `runChatTurn()`. The LLM
  **researches a method and returns a PLAN** (`integration`, `auth_step`,
  `auth_check`, `schedule`, `domains`, `data`) — it does **not** authenticate.
- Scaffold + verify: `index.tsx:2016-2034` → `scaffoldCommunityApp()` then
  (only if no user step needed) one `probeConnector()` call → `verified/proof`.

### A2. Auth machinery that EXISTS (and is real)
- **OAuth is REAL, production-grade.** `prevail-cli/src/oauth-flow.ts`:
  `runOAuthFlow()` (`:81-266`) does authorization-code + **PKCE**, a real loopback
  HTTP server on `127.0.0.1`, state/CSRF validation, real code→token exchange,
  and persists the refresh token to
  `~/.prevail/connectors/<id>/auth/refresh.token` at **chmod 0600**.
  `refreshAccessToken()` (`:271-317`) does real refresh; runners pull it lazily
  for `${auth.token}` (`runners.ts:38-43`).
- **Keychain is REAL.** `prevail-desktop/src-tauri/src/ingestion/keychain.rs:44-107`
  wraps `/usr/bin/security add/find/delete-generic-password` (service
  `prevail.ingestion`). API keys are entered in `settings7.tsx:143-327`
  ("Stored in the OS Keychain, never in plaintext") and exposed to the engine as
  env vars (`cli-bridge.ts` injects `PREVAIL_*` keys).
- **Probes only CHECK; they do not authenticate.** `connector-probe.ts` — see A0.
  `env-keys`/`file-exists`/`command` = presence; `http`/`mcp` = reachability.
  Crucially, **none of them ingests real data into the vault**. So a probe pass
  is *necessary but not sufficient* for "connected."
- **Is there UI that walks the user through real auth?** Partially. API-key entry
  (settings7) and OAuth-CLI exist. The **connect flow itself** only shows a text
  `auth_step.instruction` and a "mark done" button (`appconnect.tsx:188-201`) —
  there's **no inline key field, no "Sign in" button that launches the OAuth
  loopback, no MCP install/spawn**. The user is told what to do; the app doesn't
  do it.

### A3. Runners (`prevail-cli/src/runners.ts`) — REAL, not stubs
All six runners execute and write to `<connector>/data/…`:
- `cli` (`:88`) — `Bun.spawn` a shell command, scoped env, capture, cursor advance.
- `http`/`api` (`:199`) — real `fetch`, https-only, save body, cursor/summary
  extraction.
- `mcp` (`:314`) — **spawns a local stdio MCP server**, real JSON-RPC
  `initialize`→`tools/call`, ingests text content. Guards `mcp_command` against
  traversal (`:328`). **Does not install** the server.
- `a2a` (`:418`) — remote MCP over HTTPS JSON-RPC, SSRF-guarded (`:400-409`).
- `browser` (`:473`) — **real Playwright**, headless chromium, read-only
  `innerText` scrape. BYO-tool: if Playwright isn't installed it fails gracefully
  with an install hint (`:492`). It does **not** persist a logged-in session yet
  (no `storageState`), so it can't get past auth walls.
- `llm` (`connector-skills.ts:403`) — spawns a CLI panelist with the skill prompt.

### A4. MCP path — runner real, install/config is BYO
`runSkillMcp` spawns `mcp_command` from the skill frontmatter
(`mcp_command: "${env.GMAIL_MCP_COMMAND}"`) and resolves `${env.X}`
(`runners.ts:323`). There is **no auto `npm i`** and no auto-write of the
command — the user must install the server and set the env var. The `mcp`
auth_check only verifies the binary answers, not that it's authenticated.
So a real PayPal MCP connection needs: install `@paypal/mcp`, set
`PAYPAL_MCP_COMMAND` (+ token env), then a skill with `runner: mcp`,
`tool: list_transactions`.

### A5. Sync / Run / Schedule — REAL
- Sync button: `appspanel.tsx:106` → `engine_app_sync`
  (`engine.rs:775-777`) → `connectors sync <id>` (`index.tsx:2160-2175`) →
  `syncApp()` in `daemon-sync.ts:381-439`: scan app → read sync-state → probe →
  `runAppRefresh()` (runs the skill, real fetch) → route artifacts → persist.
  **This is a real run, not a no-op.** It "looks like it's working but doesn't
  fetch" today only because the underlying app has no credentials / no real skill
  (e.g. plaid's `connection-status.json` = `expired`, `last_error: "missing env
  vars: PLAID_CLIENT_ID, PLAID_SECRET"`).
- Schedule: `refresh:{every,at}` → cron via `refreshToCron` →
  `nextRunWithin()` (`schedule.ts:192-200`); `backoffNextDue()`
  (`daemon-sync.ts:113-117`) applies exponential backoff on failure;
  `state.next_due_ts` persisted (`:361`).
- next-run IS surfaced: `engine_app_runs` (`engine.rs:844`) → `index.tsx:2140-2149`
  returns `nextDueTs`; desktop type `AppRunHistory.nextDueTs` (`types.ts:292`),
  rendered in the per-app Runs facet. The Connect-flow card does **not** show it.
- `sync-state.json` (`daemon-sync.ts:42-53`): `last_run_ts/last_ok_ts/
  last_run_ok/last_error/consecutive_failures/next_due_ts/elevated/cursor/runs[]`.

### A6. On-disk layout + domain links
- App home: `appsContainer(vault)` → `<vault>/data/apps/<id>/` (v4) or
  `<vault>/apps/<id>/` (legacy) — `path-safety.ts:189-196`.
- App dir: `manifest.json`, `SKILL.md`, `skills/<id>/SKILL.md`, `sync-state.json`,
  `connection-status.json`, `data/…` (skill outputs, sandboxed by
  `safeOutputPath` — `connector-skills.ts:377-382`), `_log/`.
- Synced data → `<app>/data/<path>` (e.g. plaid skill writes
  `transactions/recent.jsonl`).
- Domain routing: `manifest.domains[]` (every result → each domain's
  `_intents.jsonl`) and optional `routes[]` (`vault.ts:616-619`: `{match, domain,
  copy}`) that copy matched artifacts to `<domain>/imports/`. Secrets filtered by
  `looksLikeSecretFile()`.
- Domain→app link EXISTS but is thin: desktop `AppFacetPanel` (per-domain apps,
  `shell.tsx:36` / `domainpanels.tsx`); CLI `domain-detail.tsx:337`
  `apps.filter(a => a.domains.includes(domainName))`. **There is no hyperlink
  from a domain's "fed by" list to the actual loaded data files** — that's a gap.

### A7. PayPal manifest
**None exists** under `apps/community/`. Reference ladders:
- Plaid (`apps/community/plaid/manifest.json`): `integration:"api"`,
  `connections:[{kind:api,auth_check:env-keys[PLAID_CLIENT_ID,PLAID_SECRET],
  skill:recent-transactions},{kind:cli,…}]`, `refresh:{every:daily,at:07:00}`,
  `autonomy:read-only`.
- Gmail (`apps/community/gmail/manifest.json`): `integration:"oauth"`,
  3-rung `connections[]` ladder **mcp → oauth → cli**, each with its own
  `auth_check` + `skill`, plus a full `oauth{provider,client_id_env,token_url,
  scopes,redirect_port}` block. **This is the template to copy for PayPal.**

### A8. Catalog + curation tiers (confirmed)
`catalog.json` (v2): **1,469 apps** (`cat.apps.length`). Tiering:
**tier 1 = 195 (Core / default view)**, tier 2 = 1,274; `obscure:true` = 849.
Patterns: api 1,225 / browser 159 / oauth 72 / cli 13. Governance:
`scripts/curate-catalog.mjs` — a hardcoded `CURATED[]` name list (~150 entries)
→ matched apps get `tier:1, obscure:false, curated:true`; everything else
`tier:2`. Non-destructive (nothing deleted). It also attaches `connection_hint`
from a `HINTS{}` map (this is where PayPal's `method:"mcp"` hint comes from).
"Core" view = `tier===1`; "All" = include tier 2 via search / show-all.

---

## PART B — PayPal: the real ways to pull transactions locally

Three viable methods (founder asked which is cleanest for a local-first desktop):

### B1. Official PayPal MCP server (`@paypal/mcp`)
- Install/run: `npx -y @paypal/mcp --tools=all` with env
  `PAYPAL_ACCESS_TOKEN=<token>` and `PAYPAL_ENVIRONMENT=SANDBOX|PRODUCTION`
  (Node 18+). Exposes `list_transactions` (+ invoices/orders/disputes).
- Auth: needs a **PayPal *access token***, which you mint from a Client ID +
  Secret (created in the PayPal Developer Dashboard) via the OAuth2
  client-credentials call below. The MCP server itself does **not** do the
  client-credentials exchange or auto-refresh — **you feed it a token**, and
  tokens expire in ~8.8h. That refresh burden lands on us.
- Privacy: the MCP server talks to PayPal's cloud; tool runs locally over stdio.
- Fit: works, but adds a node dependency + a token-refresh wrapper, and the value
  it adds over a direct HTTP call is thin for a single read endpoint.

### B2. PayPal REST API directly (OAuth2 client-credentials → Transaction Search) ✅ RECOMMENDED
- **Token:** `POST https://api-m.paypal.com/v1/oauth2/token` (sandbox:
  `api-m.sandbox.paypal.com`), Basic auth `base64(CLIENT_ID:CLIENT_SECRET)`,
  body `grant_type=client_credentials`. Returns a bearer token (~8.8h).
- **Data:** `GET /v1/reporting/transactions?start_date=…&end_date=…&fields=all&page_size=500&page=N`
  with `Authorization: Bearer <token>`. Dates RFC-3339; **max 31-day window per
  call**; data lags up to 3h; 3 years of history available.
- **Scope required on the app:** `https://uri.paypal.com/services/reporting/search/read`
  (enable "Transaction Search" on the REST app).
- Fit: **cleanest for local-first.** Two plain HTTPS calls, no extra process, no
  npm install. Maps directly onto the existing **`http`/`api` runner** (which
  already does headers + `${auth.token}` + save + cursor). The only missing
  piece is **client-credentials token minting** (our OAuth-flow does
  *authorization-code*, not client-credentials — small addition).

### B3. Browser automation fallback
- Playwright logs into paypal.com and scrapes Activity/Statements. Brittle
  (2FA/anti-bot), and our `browser` runner has **no persisted session** yet.
  Use only as a last resort when a user can't create REST credentials.

**Verdict:** **B2 (REST + client-credentials)** is the P0 path. B1 (official MCP)
is the P2 "upgrade" option once we have generic MCP install/spawn. B3 is the
backstop.

---

## PART C — The redesign

### C1. Core principle: connected == we pulled real data once
Introduce a hard gate. An app may be `configured` (creds present, probe passes)
**without** being `connected`. **`connected` is only set after a real sync writes
≥1 artifact (or returns a non-empty, parseable payload) into `<app>/data/`.**

Concretely:
- Add a status `verified` step to `sync-state.json`: a boolean
  `first_fetch_ok` + `first_fetch_ts`. `mirrorConnectionStatus` may write
  `"connected"` **only when `first_fetch_ok === true`**. Until then the status is
  `"configured"` (new) → renders as **◐ "Authorized — verifying"**, not green.
- Fix the desktop fold (`appspanel.tsx:21-27`) so the **default is NOT
  connected**. New mapping:
  - `disconnected` — no creds / not configured.
  - `authorized` — creds present, probe ok, but **no successful fetch yet**.
  - `connecting` — a sync/probe is in flight.
  - `connected` — `first_fetch_ok` AND a recent successful run.
  - `attention` — was connected, now failing.
- The connect-flow "verified" badge (`appconnect.tsx:176`) must reflect the
  **fetch**, not the probe. Engine `engine_app_connect` should, after scaffolding
  and (if possible) authorizing, **run one real sync** and return
  `verified = first_fetch_ok` with `proof = "pulled 142 transactions
  (2026-05-01 … 2026-05-31)"`.

### C2. Auth flow PER method (the missing "do it for me" UI)
The connect card must *perform* the auth step, not just describe it. Per method:

- **API key** — render an inline secret field (reuse the `settings7.tsx`
  password input + `provider_key_set` → Keychain). On submit, store under
  Keychain service `prevail.ingestion`, account `<app-id>`, then **immediately
  run the verify fetch**.
- **OAuth (authorization-code)** — render a **"Sign in to <App>"** button that
  invokes a new Tauri command `engine_app_oauth(id)` → `runOAuthFlow()` (already
  real). On the loopback callback + token save, **run the verify fetch**. (Gmail
  already has the oauth block; just wire the button.)
- **OAuth client-credentials (PayPal)** — two secret fields (Client ID, Secret) +
  environment toggle (Sandbox/Live). Store in Keychain; a small engine helper
  mints the token (B2) on demand and caches it; **then verify fetch**.
- **MCP** — a guided 3-step: (1) show the exact install command
  (`npx -y @paypal/mcp …` / `npm i -g <server>`), (2) collect the token/creds the
  server needs into Keychain/env, (3) **spawn the server + call one tool** to
  verify. Optionally auto-run the install in a sandboxed shell with explicit user
  consent. Only mark connected after the tool returns data.
- **Browser** — launch a **non-headless** Chromium, let the user log in once,
  persist `storageState` to `<app>/auth/state.json` (0600), then the headless
  `browser` runner reuses it. (Requires adding `storageState` load/save to
  `runSkillBrowser` — currently absent.) Verify by scraping one known element.

In all cases the **last step is the same**: run the real sync once; only a
successful fetch flips the card to green.

### C3. The "verify by real fetch" gate
A single engine entrypoint `verifyConnection(app)`:
1. resolve the active connection (`probeConnector` picks the first passing rung),
2. run that rung's `skill` once via the existing runners,
3. require the result to be `ok` AND (`artifacts.length > 0` OR a non-empty parsed
   payload),
4. on success: write `first_fetch_ok/ts`, `mirrorConnectionStatus("connected")`,
   set `next_due_ts`; on failure: status stays `authorized` (creds ok) or
   `attention` (creds bad), with `proof` = the real error.
Reuse this for connect-time verify AND the per-app "Re-test" button.

### C4. Run now / schedule / next-run UX
- Surface `nextDueTs` everywhere a card is shown (it already flows through
  `engine_app_runs`): "Synced 2h ago · next in 22h". Add it to the connect-flow
  success card (`appconnect.tsx`) and the gallery card (`appspanel.tsx:312`).
- "Sync now" stays (`engine_app_sync`), plus a cadence picker bound to
  `refresh.every`/`at` (reuse the benchFreq/backupFreq control), and a pause
  toggle (`enabled:false`).
- Show the last run's summary + artifact count from `sync-state.json runs[]`.

### C5. data/ layout + domain↔app cross-links
- Keep `<vault>/data/apps/<id>/data/<skill-output>`; keep routing to
  `<domain>/imports/` + `_intents.jsonl`.
- **New: bidirectional hyperlinks.**
  - From an app card: list "Domains fed" as chips that deep-link to the domain
    (already partly there via `onOpenDomain`).
  - From a **domain view**: render "Fed by N apps" where each app links to its
    card AND lists the **actual files it loaded** (read `<app>/data/**` filtered
    by that domain's `routes[]`, or `<domain>/imports/<app>/*`). Clicking a file
    opens it. This is the missing link in `domainpanels.tsx` /
    `domain-detail.tsx:337`.
- Provenance: each `_intents.jsonl` record already carries `app` + `summary`;
  add the artifact relpath so the domain view can hyperlink straight to the file.

### C6. Curation to ~250 quality apps
Reuse `scripts/curate-catalog.mjs` (it already does tier-1 marking +
`connection_hint`). Steps:
1. Grow `CURATED[]` from ~150 → ~250 (add the next tier of household names per
   domain; the script reports unmatched names with near-miss suggestions to fix
   aliases).
2. Expand `HINTS{}` so every curated app starts the Connection Agent on a known
   rung (method + server/endpoint + privacy + readOnly).
3. `node scripts/curate-catalog.mjs --write` → tier-1 becomes ~250,
   `curatedCount` updated, long tail stays tier-2 (reachable via search). Nothing
   deleted. "Core" view filters `tier===1`.
4. Add a CI check that every tier-1 app has a `connection_hint` and a known
   working method (so "Core" never contains an unconnectable app).

### C7. PayPal END-TO-END plan (P0 — make it actually work)

**Method:** B2 — PayPal REST API, OAuth2 client-credentials → Transaction Search,
via the existing `http`/`api` runner. (No new heavy deps.)

**1. Credentials (the ONE user step).**
- Card shows: "Create a REST app at developer.paypal.com, enable *Transaction
  Search*, paste Client ID + Secret." Two secret fields + Sandbox/Live toggle.
- Store in Keychain: service `prevail.ingestion`, accounts `paypal:client_id`,
  `paypal:client_secret`. Exposed to the engine as env
  `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV`.

**2. Token minting (small engine addition).**
- Add `mintClientCredentialsToken(app)` (sibling of `oauth-flow.ts`): POST to
  `https://api-m{.sandbox}.paypal.com/v1/oauth2/token`, Basic
  `base64(id:secret)`, `grant_type=client_credentials`; cache token +
  `expires_at` at `~/.prevail/connectors/paypal/auth/token.json` (0600); refresh
  when within 5 min of expiry. Expose it to the runner as `${auth.token}` (extend
  the `${auth.token}` resolver in `runners.ts:38-43` to support a
  client-credentials provider, not just `refreshAccessToken`).

**3. Manifest** `apps/community/paypal/manifest.json` (copy the gmail/plaid shape):
```json
{
  "id": "paypal", "name": "PayPal", "version": "0.1.0",
  "description": "Pull PayPal transaction history into the money domain.",
  "domains": ["wealth", "tax"],
  "integration": "api",
  "connections": [{
    "kind": "api",
    "description": "PayPal REST Transaction Search via OAuth2 client-credentials.",
    "auth_check": { "kind": "env-keys", "env_keys": ["PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET"] },
    "skill": "recent-transactions"
  }],
  "auth": "api-key",
  "auth_env_vars": ["PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET","PAYPAL_ENV"],
  "refresh": { "every": "daily", "at": "07:00", "skill": "recent-transactions" },
  "autonomy": "read-only",
  "homepage": "https://www.paypal.com"
}
```

**4. Sync skill** `apps/community/paypal/skills/recent-transactions/SKILL.md`
(`http`/`api` runner; `${auth.token}` resolves to the client-credentials token):
```
---
id: recent-transactions
runner: api
auth: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV]
url: https://api-m.paypal.com/v1/reporting/transactions?start_date=${cursor.start_date}&end_date=${date}&fields=all&page_size=500
headers:
  - "Authorization: Bearer ${auth.token}"
  - "Accept: application/json"
save: data/transactions/${date}.json
cursor_path: end_date            # advance the window opaquely
summary_path: total_items
outputs:
  - { path: data/transactions/${date}.json, kind: replace }
---
Pull PayPal transactions for the last window (≤31 days) into the money domain.
```
(31-day windowing + pagination is enforced by the skill template / a thin loop;
the runner already saves the body, advances the cursor, and extracts a summary.)

**5. Where data lands + domains.** `<vault>/data/apps/paypal/data/transactions/
<date>.json`; routed to `wealth`+`tax` `_intents.jsonl`; optional `routes[]`
copy to `<domain>/imports/paypal/`.

**6. Verify (the gate).** After creds are saved, `verifyConnection(paypal)` mints
a token and runs `recent-transactions` over the last 7 days. Success
(`artifacts>0` / `total_items>=0` parsed) → `first_fetch_ok=true` →
status `connected`, `proof="pulled N transactions"`. Card turns green only then.

**7. Test it.**
- Unit: token-mint helper (mock the token endpoint), 31-day windowing, cursor
  advance, manifest round-trip (extend `connect-e2e.test.ts`).
- Integration: PayPal **Sandbox** app + seeded sandbox transactions →
  `connectors sync paypal --vault <tmp>` → assert
  `data/transactions/*.json` non-empty and `connection-status.json:"connected"`.
- Manual: real Live creds (read-only scope), confirm green card + visible
  next-run + domain hyperlink to the saved file.

### C8. Phased build plan
- **P0 — PayPal works end-to-end (vertical slice).**
  - Client-credentials token mint + cache (`paypal-auth.ts`); `${auth.token}`
    resolver supports it.
  - PayPal manifest + `recent-transactions` skill (31-day window + pagination).
  - `verifyConnection()` gate; `first_fetch_ok` in `sync-state.json`;
    `mirrorConnectionStatus("connected")` only on first real fetch.
  - Connect card: inline Client-ID/Secret fields + Sandbox toggle; on save →
    verify fetch → green + `proof` + next-run. Sandbox + Live tests green.
- **P1 — Generalize the real-connection model.**
  - Fix `appStatus()` default (no more optimistic green); add `authorized` state.
  - Per-method auth UI: inline API-key field, "Sign in" OAuth button
    (`engine_app_oauth` → `runOAuthFlow`), browser `storageState` persistence.
  - `verifyConnection()` becomes the universal connect/Re-test gate for all apps.
  - Domain↔app cross-links: domain view lists feeding apps + hyperlinks to the
    actual loaded files; intents carry artifact relpaths.
  - Backfill the existing 6 community apps to the fetch-gated model.
- **P2 — Scale + curate + MCP upgrades.**
  - Generic MCP install/spawn helper (consented `npm i`, write `mcp_command`,
    verify a tool call) → enables the official PayPal/Stripe/etc. MCP servers as
    an *upgrade* path; method re-evaluation can swap a working rung up the ladder.
  - Curate `catalog.json` to ~250 (grow `CURATED[]`/`HINTS{}`,
    `curate-catalog.mjs --write`); CI: every tier-1 app has a hint + known method.
  - Bring 15–25 highest-value curated apps to verified end-to-end (banking via
    SimpleFIN, Gmail via OAuth, Oura/Fitbit via local MCP, etc.).

---

## Appendix — key file:line references
- Connect UI: `prevail-desktop/src/appconnect.tsx:74,176-201`
- Status fold (bug): `prevail-desktop/src/appspanel.tsx:21-27`; method badge `:37-45`
- Sync button → engine: `appspanel.tsx:106`, `engine.rs:775-777,800-825,844`
- Connection Agent + verify: `prevail-cli/src/index.tsx:1983-1997,2016-2037,2140-2175`
- Scaffold + initial status: `prevail-cli/src/vault.ts:1207-1250` (status `:1250`)
- Probes (presence-only): `prevail-cli/src/connector-probe.ts:68-141,143-184,261-400`
- OAuth (real): `prevail-cli/src/oauth-flow.ts:81-266,271-317`
- Keychain (real): `prevail-desktop/src-tauri/src/ingestion/keychain.rs:44-107`
- Runners (real): `prevail-cli/src/runners.ts:88,199,314,418,473`
- Skill spec + `${auth.token}`: `prevail-cli/src/connector-skills.ts:28-108,390-397`; `runners.ts:38-43`
- Sync state + schedule: `prevail-cli/src/daemon-sync.ts:42-53,113-117,308-361,381-439`; `schedule.ts:192-200`
- On-disk paths: `prevail-cli/src/path-safety.ts:189-196`; routes `vault.ts:616-619`
- Reference manifests: `apps/community/gmail/manifest.json`, `apps/community/plaid/manifest.json`
- Catalog (1,469; tier-1=195) + curation: `prevail-desktop/src-tauri/resources/connectors/catalog.json`; `prevail-desktop/scripts/curate-catalog.mjs` (PayPal hint `:115`)
- PayPal connection_hint (source of "·MCP"): catalog `name:"PayPal"` → `connection_hint.method:"mcp"`
