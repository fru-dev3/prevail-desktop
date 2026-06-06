# Prevail ingestion engine

Triple-tier data collection layer that feeds the chat panels with
real artifacts from MCP servers, the Composio gateway, and headed
browser automation. Every artifact lands in a single sandbox under
`~/Library/Application Support/Prevail/domains/<domain>/imports/`.

## Module map

| File | Responsibility | Touches |
|---|---|---|
| `mod.rs` | Orchestrator state, shared types, public Tauri commands | other tiers |
| `storage.rs` | Canonical paths, SHA-256 hashing, `.meta.json` sidecar | filesystem |
| `keychain.rs` | macOS Keychain wrapper via `/usr/bin/security` | system CLI |
| `tier_a_mcp.rs` | MCP subprocess registry | `mcp_config.json` |
| `tier_b_composio.rs` | Composio gateway runtime | Keychain + npx |
| `tier_c_browser.rs` | Playwright runner supervisor | resources/automation/ |

Each tier owns its own state behind a `Mutex` field on
`OrchestratorState`, which is registered into Tauri with `.manage()`
in `lib.rs::run()`. Tier state is **never** shared across module
boundaries — if a future feature needs the MCP registry, it goes
through `state.tier_a.lock()`.

## Hard rules for future contributors

1. **Storage layout is owned by `storage.rs`** — never construct
   `~/Library/Application Support/Prevail/...` paths in other files.
   Add a helper to `storage.rs` and call it.
2. **All artifacts go through `storage::ingest_artifact`** — that's
   the only function that writes into `domains/<d>/imports/`. The
   SHA-256 + sidecar are non-optional.
3. **Keychain access is one module** — anywhere you need a secret,
   use `keychain::get/set/del` with `service = "prevail.ingestion"`
   and a unique account name. No raw `security` invocations.
4. **Tier failure is local** — a tier returning `Err` from a Tauri
   command must not corrupt the other tiers' state. Use the tier's
   own `last_error` field.
5. **Tier C runs Node via `node`** — we do not embed Playwright in
   the binary. The user installs it once; we resolve the bundled
   `playwright_runner.js` via `app.path().resolve(...)`.
6. **The runner protocol is JSON-lines on stdio** — one event per
   line, both directions. Don't sneak in extra channels.

## Adding a new tier

1. Create `tier_x_<name>.rs` with a public state struct.
2. Add a `Mutex<TierXState>` field to `OrchestratorState`.
3. Expose `status()` returning `TierStatus` with a stable `id` like
   `"tier_x_<name>"`.
4. Add Tauri commands at the bottom of `mod.rs` (lock the new
   field, delegate). Wire them into `lib.rs::invoke_handler!`.
5. Add a `IngestionTierCard` branch in `App.tsx::IngestionTierCard`
   for the per-tier UI block. Reuse the existing shell — the
   header / status pill / error display are generic.
6. If artifacts come out, route them through
   `storage::ingest_artifact` and re-emit
   `"ingestion:artifact"` so the UI's recent panel picks them up.

## Event surface

- `ingestion:browser` — stdout/stderr lines from the Playwright
  sidecar. Payload: `{ stream?: "stderr", line, domain?, portal? }`.
- `ingestion:artifact` — fired once per `storage::ingest_artifact`
  call. Payload: `{ tier_id, domain, source, path, sha256, size,
  original, ts }`.

## Storage paths

```
~/Library/Application Support/Prevail/
├── mcp_config.json
├── automation/
│   └── profiles/
│       └── <domain>/<portal>/         # persistent Chromium profile
└── domains/
    └── <domain>/
        └── imports/
            ├── <ts>_statement.pdf
            └── <ts>_statement.pdf.meta.json
```

The `vault/` directory (separately configured by the user) is
**not** touched by ingestion. Imports live under Application
Support so the vault stays under the user's exclusive control.

## Tests

`cargo test -p prevail-desktop` exercises:
- `storage::slugify` edge cases (Unicode, separators, no extension).
- `storage::imports_dir` rejects `..` and path-segment escapes.
- SHA-256 contract for a known input.

The Playwright runner is not unit-tested — its surface is the
JSON-line protocol, which is exercised by `tier_c_browser.rs` only
parsing `{"type":"downloaded", path}`. Add integration tests by
running `node playwright_runner.js` with stdin redirected from a
fixture JSON, then asserting the stdout lines.
