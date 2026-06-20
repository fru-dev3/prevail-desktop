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
- [ ] A1: "Nothing happens when I click Connect" on a catalog app. Diagnose + fix so
  clicking Connect immediately shows the in-pane flow + auto-research progress.
- [ ] A2: Hide "Try in chat" on a NOT-yet-connected (catalog) app. Only show it once
  connected (it already exists on the connected AppDetail as "Open in chat").
- [ ] A3: Per-method connection must really work, with the user seeing each step:
    - api    -> ask for + securely save the API key, then verify.
    - mcp    -> obtain/drive the right MCP auth.
    - oauth  -> drive the sign-in (engine_app_oauth exists).
    - browser-> spin up the browser, user logs in, session saved
               (engine_app_browser_login exists).
  The connect RESULT step currently only shows instruction TEXT; wire the real
  per-method action buttons (reuse the engine commands the connected AppDetail uses).

## TRACK B — Composio as a SEPARATE MODE (not an app in the Direct list)
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
