# Parallel work tracker — feat/apps-fig (both repos)

Single ledger for the parallel, sometimes-orthogonal tracks so nothing is lost as
feedback comes fast. Updated as work moves. Branch: feat/apps-fig (prevail-desktop
+ prevail-cli, changed together). No em dashes anywhere.

Status key: [ ] todo · [~] in progress · [x] done+committed · [B] blocked

---

## TRACK A — Direct connect flow must ACTUALLY work (Images #48, #50) — HIGHEST PRIORITY
The per-app "Direct" connect flow (catalog -> Connect) must do the real connection
per method, with visible progress. This is the north star, demanded concretely.
- [x] A0: regression "can't connect at all" — connectors used a dev-default vault;
  now prefer PREVAIL_VAULT_ROOT. Connected apps show again. (CLI committed)
- [x] A1: "Nothing happens when I click Connect". Catalog Connect no longer runs the
  slow/opaque model-research. It now scaffolds the app instantly with its known
  method (from connection_hint) and opens its AppDetail. Shows an "Adding..." state.
- [x] A2: "Try in chat" removed from the not-yet-connected catalog detail.
- [x] A3: Per-method connection is now REACHABLE + real: after Connect, AppDetail
  shows the actual action for the method - "Log in to <app>" opens a real browser
  (engine_app_browser_login), "Sign in" runs OAuth (engine_app_oauth), Credentials
  fields save API keys (app_secret_set), MCP setup verifies by a real tool call.
  These were already working in AppDetail; Connect now routes there instead of
  showing instruction text. (Follow-up: surface the auth step even more prominently
  on a freshly-added app, and confirm each method end-to-end with the user.)

## TRACK A-fix — VAULT ROOT regression (root cause of empty app list + Composio ENOENT)
- [x] VAULT_ROOT was only set on encrypted-vault unlock; a plaintext vault left it
  None so every no-arg engine call fell back to a dev vault. Now set in
  engine_set_config_vault (boot + change) AND the app setup hook. The Direct app
  list shows real connected apps again, and Composio no longer ENOENTs.

## TRACK B — Composio as a SEPARATE MODE (not an app in the Direct list)
DESIGN LOCKED (user, firm): clicking Apps -> top-level choice "Direct | Composio".
Direct = the per-app master-detail (list left, detail right, Connect spins in place).
Composio = (1) a CONFIG page to set up the key, then (2) a page like Direct listing
Composio's connectors, behaving the same. NEVER mix Composio into the Direct list.
- [x] Removed the wrong "Composio gateway" entry from the Direct sidebar + the
  mcp-remote ComposioDetail. Direct is clean.
- [x] VERIFIED the Composio integration with the user's real key:
    - The ck_ key is a CONSUMER key for the hosted MCP endpoint, NOT a REST key
      (REST returns "Invalid API key"). Header is X-CONSUMER-API-KEY.
    - MCP URL https://connect.composio.dev/mcp speaks Streamable HTTP. Handshake
      works: POST initialize -> mcp-session-id -> notifications/initialized ->
      tools/list. Meta-tools returned: COMPOSIO_SEARCH_TOOLS,
      COMPOSIO_MANAGE_CONNECTIONS (toolkits[].action add/list/remove/rename),
      COMPOSIO_MULTI_EXECUTE_TOOL, COMPOSIO_GET_TOOL_SCHEMAS, etc.
    - So Composio's "connectors" come from MANAGE_CONNECTIONS (list) + SEARCH_TOOLS
      (browse), driven via MCP tools/call with the session + consumer-key header.
- [ ] B1: top-level Direct | Composio mode toggle in the Apps area.
- [ ] B2: Composio CONFIG page: paste/store the X-CONSUMER-API-KEY (Keychain
  service prevail.ingestion / account composio - already holds the user's key).
- [ ] B3: Composio CONNECTORS page: list connected accounts (MANAGE_CONNECTIONS
  list) + search/browse (SEARCH_TOOLS); connect via Composio (MANAGE_CONNECTIONS
  add -> returns an auth link to open). Behaves like the Direct master-detail.
- [ ] B4: agent wiring: register connect.composio.dev/mcp (HTTP, X-CONSUMER-API-KEY
  header) for the agent so it can execute Composio tools.

## TRACK B-OLD (superseded, remove leftovers)
Complete separation: top-level "Direct | Composio". Composio = paste API key ->
list the accounts/apps connected in Composio -> interact through Composio.
- [x] B5: name for the native path decided: "Direct".
- [x] B4: Composio API key stored in macOS Keychain (service prevail.ingestion,
  account composio) where the app reads it. Also push to 1Password (see TRACK C).
- [ ] B1: top-level Direct | Composio toggle in the Apps area.
- [ ] B2: Composio mode UI: key form (prefilled if Keychain has it) -> list connected
  accounts via the Composio API -> show them -> agent can use them.
- [ ] B3: rework the earlier mcp-remote/OAuth approach to the KEY-based model.
  Composio creds (from the user):
    - MCP URL: https://connect.composio.dev/mcp
    - header: X-CONSUMER-API-KEY (the ck_... key)
    - CLI: curl -fsSL https://composio.dev/install | bash ; composio login ; composio search/execute
  Existing infra to reuse: src-tauri/src/ingestion/tier_b_composio.rs (key in
  Keychain + npx @composio/mcp), ingestion_composio_set_key/start/stop.
- [ ] B6: remove the half-built "Composio gateway" entry from the Direct sidebar and
  the agent .mcp.json mcp-remote wiring (superseded by the key-based mode).

## TRACK E — Composio MCP + CLI choice (user, new)
- [ ] Within Composio, offer two connection means: MCP and CLI, with CLI the
  DEFAULT. The user clicks and authenticates through the chosen one.
  Composio CLI: curl -fsSL https://composio.dev/install | bash ; composio login
  (browser OAuth) ; composio search / execute / add <toolkit>. Plan: detect/install
  the composio binary, drive `composio login`, then manage connectors via the CLI.
  Neither composio nor nango CLI is installed on the machine yet.

## TRACK F — Nango as a THIRD mode (Direct | Composio | Nango) (user, new)
Exploring multiple integration platforms to pick the best. Nango is a parallel
track to Composio: its own auth, its own connectors, scheduled sync into a domain.
Model (from nango.dev/docs):
  - Secret key NANGO_SECRET_KEY (from app.nango.dev env settings). Bearer auth.
  - Base API https://api.nango.dev. Verify/list: GET /integrations.
  - Connect a user: POST /connect/sessions {end_user, allowed_integrations} ->
    { data: { token } } -> open the Connect UI with the session token.
  - Connections: GET /connection. Synced records: GET /records?model=... with
    Connection-Id + Provider-Config-Key headers. 800+ APIs. There is a Nango CLI.
- [ ] F1: 3-way toggle Direct | Composio | Nango.
- [ ] F2: Nango config (enter + verify the secret key in Keychain) + integrations
  list + connect via Connect session. NEED the user's Nango secret key to test.
- [ ] F3: Nango scheduled sync of records into the domain/vault.

## TRACK C — Secrets to 1Password
- [B] C1: store Composio key + MCP URL in 1Password. BLOCKED: `op` CLI is installed
  but not signed in (needs the user's interactive unlock / Touch ID). Done in
  Keychain meanwhile. One-liner ready for the user to run once unlocked.

## TRACK D — Shipped this session (done + committed, in the v0.1.143 local builds)
- [x] Apps single source of truth: <vault>/data/apps (migrated out of ~/.prevail/apps).
- [x] Reveal-in-Finder via the opener plugin (apps + domains).
- [x] Catalog merged into the connectors sidebar; bottom catalog bar removed.
- [x] Browser-login derives a URL so it never dead-ends.
- [x] Loops: per-loop running indicators, Stop run / per-loop Stop, notifications.
- [x] Rich catalog detail + in-pane connect + (Try in chat — to be hidden, see A2).
- [x] Catalog search: dedupe + match name/category/tags.
- [x] Pin/favorite apps into a "My list" sidebar section.
- [x] Settings banner pinned (only the nav scrolls).

## Notes / decisions
- Two repos always change together (prevail-desktop + prevail-cli).
- Local test builds: build, install to /Applications, relaunch (avoids App
  Translocation + wrong-vault daemons).
