# Prevail Codebase Audit — v0.4.0

I have enough detail in the reports to produce the action plan directly. No need to read the codebase — the audits already carry precise file/line refs.

# Prevail Codebase — Prioritized Action Plan

## 1. Readiness Verdict

**Not ready to open-source as-is; not production-ready for the desktop app.** The CLI engine (v1.6.5) is genuinely close — mature governance, ~20k LOC, 22 test files, clean provider abstraction — and could be public after closing a few enforcement/SSOT gaps. The **desktop app (v0.4.0) is the blocker**: it ships a WebUI bridge that proxies *arbitrary* Tauri commands to remote clients behind a weak localStorage bearer token, exposing API-key exfiltration, arbitrary file read/write, and remote uninstall. That is a remotely-exploitable critical surface that must be closed before any public push. Layered on top: CSP is disabled, zero desktop test coverage, no SECURITY.md/CONTRIBUTING for the app, README claims v0.1 while shipping v0.4, and a CI pipeline that can ship a release with a missing/stale engine sidecar. Fix the P0 security surface first, then the OSS/test infra, then the (large but non-blocking) App.tsx and lib.rs structural debt.

## 2. P0 — Must-fix before open-sourcing (security + correctness)

The WebUI remote attack surface is the headline. Treat the bridge as hostile-by-default.

- [ ] **Whitelist WebUI-proxied commands.** `/api/invoke` forwards *any* cmd to the host with no allowlist — gate to a small read-only/safe set (e.g. `chat_send`, `webui_status`), deny all else at the gate. `src-tauri/src/webui.rs` (lines 174–192).
- [ ] **Remove `provider_key_get` from the WebUI-reachable surface.** Replace with `provider_key_exists(provider) -> bool`; never return key values to any frontend. `src-tauri/src/lib.rs` (lines 339–341).
- [ ] **Remove/guard `write_text_file` & `read_text_file`** (and `read_file`) — no path validation, remotely reachable arbitrary FS read/write. Move config import/export to a native dialog + restricted I/O; never expose generic FS commands to WebUI. `src-tauri/src/lib.rs` (lines 1195, 1557–1562).
- [ ] **Remove/gate `app_uninstall`** behind a native confirmation modal; do not expose destructive ops to remote clients. `src-tauri/src/lib.rs` (lines 1620–1649).
- [ ] **Bind WebUI to `127.0.0.1`, not `0.0.0.0`.** Make Tailscale/SSH-tunnel the first-class remote path; warn in UI when WebUI is enabled. `src-tauri/src/webui.rs` (line 105).
- [ ] **Fix token auth.** Stop storing password/token in localStorage; use HMAC-SHA256 with a random per-session nonce, short-lived tokens, httpOnly+secure+sameSite cookie. Add login rate-limiting. Use **constant-time** token comparison and drop the `?token=` query-param method. `src-tauri/src/webui.rs` (lines 57–60, 145–153).
- [ ] **Enable CSP** (currently `null`). Set a strict policy (`default-src 'self'; …`). Without WebUI hardening + CSP, any XSS = full Tauri command access. `src-tauri/tauri.conf.json` (line 27).
- [ ] **Add path validation to `benchmark_run_detail`** (reads `run_dir`-joined paths with no vault containment check — traversal). Apply the same guard used by `benchmark_delete_question`. `src-tauri/src/lib.rs` (lines 682–693).
- [ ] **Validate `domain` string in all path-building commands** (alphanumeric/dash/underscore, no `..`, max len), or canonicalize + assert under vault root. `src-tauri/src/ingestion/mod.rs` (429, 475, 175), `lib.rs`.
- [ ] **Keychain writes via stdin, not argv** (secrets leak via `ps`/`/proc` during exec). `src-tauri/src/ingestion/keychain.rs` (lines 44–64).
- [ ] **Extend CLI redaction to API-key patterns** (`sk-`, `sk_test_`, `*_API_KEY=`) before LLM send and before `_intents.jsonl` write. `fd-apps-prevail-cli/src/privacy.ts` (lines 225–245).
- [ ] **Scrub env on ingestion subprocess spawns** (tier_a_mcp / tier_b_composio / tier_c_browser) the way the CLI's `scrubbedEnv()` does. `src-tauri/src/ingestion/tier_a_mcp.rs`.

## 3. P1 — Quality / Modularity / Testability

**Structural debt (the two god-objects):**
- [ ] **Decompose App.tsx (12.4k lines).** Split the 2,090-line `ChatPanel` (lines 4911–7000, 41 hooks) into `useChatStreaming()`, `useDomainSettings()`, `useComposerInput()` + presentational components. Unify the duplicated `chat:chunk` vs `engine-chat:line` stream paths (lines 5568–5730) into one `ChatStreamHandler`. `src/App.tsx`.
- [ ] **Centralize localStorage keys.** 20+ ad-hoc keys → typed `localStorageKeys.ts` + `useLocalStorage<T>` hook. `src/App.tsx` (929–5051).
- [ ] **Type the Tauri invoke seam.** Generate TS types (ts-rs) → typed `CommandMap` so arg typos fail at compile time. `src/bridge.ts`, `App.tsx`.
- [ ] **Add error boundaries / AsyncDataLoader hook** — silent `.catch(()=>setNull)` leaves "loading…" forever; users can't tell "empty" from "failed." `src/App.tsx` (3504–5246).
- [ ] **Harden bridge.ts auth lifecycle** — clear token on 401, add SSE heartbeat/timeout + reconnect notification. `src/bridge.ts` (12–70).
- [ ] **Split lib.rs (3,035-line god module)** into `vault.rs`, `chat.rs`, `benchmark.rs`, `threads.rs`, `usage.rs`. `src-tauri/src/lib.rs`.

**Correctness (Rust):**
- [ ] **Replace `.lock().unwrap()`** across distill/webui/telegram_bridge with poisoned-lock-tolerant handling — a panicked thread currently kills the daemon. `src-tauri/src/{distill,webui,telegram_bridge}.rs`.
- [ ] **Guard distill cursor read/write** (flock or Mutex) to prevent concurrent daemon + `distill_run_once` racing the cursor. `src-tauri/src/distill.rs` (154–167).

**CLI engine SSOT + enforcement:**
- [ ] **Single-source `CliKind`** — define in `cli-bridge.ts`, re-export from `config.ts` (today it's redeclared, defeating the stated guarantee). `cli-bridge.ts:66`, `config.ts:13`.
- [ ] **Enforce privacy.localOnly at all entry points** — `chat-json.ts pickCli`, `score.ts`, `council-runner.ts` don't honor it; a local-only domain can still route to cloud. Wrap via `enforcedRunChatTurn`. `fd-apps-prevail-cli/src/privacy.ts`, `cli-bridge.ts`, `chat-json.ts`, `score.ts`, `council-runner.ts`.
- [ ] **OpenRouter: add integration tests + council/score/error-classification awareness** (added recently, untested; council assumes subprocess health checks). `cli-bridge.ts` (798–813, 939–1000), `council-runner.ts`.
- [ ] **Budget guard: make tracking non-optional** (or `runTrackedChatTurn` wrapper) — chat-json and council currently skip cost accounting entirely. `cli-bridge.ts` (635–697).

**Testability / OSS-blocking infra (desktop):**
- [ ] **Add desktop CI** (`test.yml`): `tsc --noEmit`, biome lint, `cargo test`/clippy, build smoke. Today only `release.yml` exists. Start with smoke tests for cli-bridge + config I/O.
- [ ] **Make the release pipeline build the engine sidecar in CI** — `tauri-action` doesn't run `prepare-sidecar.sh`; a tag without local `release.sh` ships a missing/stale 72MB sidecar.
- [ ] **Write desktop governance docs:** `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (Tauri/macOS threat model), `.github/ISSUE_TEMPLATE/*`, `PULL_REQUEST_TEMPLATE.md` (adapt from CLI).
- [ ] **Fix README/version drift** — README claims "unsigned for v0.1" / "no sidecar" while shipping v0.4.0 signed + sidecar. Rewrite the "what ships" section. Add `repository`/`homepage` to package.json.

## 4. P2 — Nice-to-haves

- [ ] webui invoke timeout: cap pending entries (~100), evict/prune orphans, log late resolves; consider configurable timeout. `webui.rs:187`.
- [ ] Graceful daemon shutdown (checkpoint flag) instead of `task.abort()` mid-flight. `distill.rs`, `telegram_bridge.rs`.
- [ ] Engine `:done` event should carry `had_stderr`/`last_stderr_line` so frontend can detect code-0-with-errors. `engine.rs` (248–257).
- [ ] Input length caps on `rename_thread`/`create_domain`/`journal_append` to prevent OOM. `lib.rs`.
- [ ] Uninstall: do deletions in Rust (drop bash) or write script to a restricted temp path; validate `$HOME`. `lib.rs` (1620–1648).
- [ ] Move uninstall/`curl` capability off unconstrained `shell:allow-execute`; prefer `reqwest`. `gen/schemas/capabilities.json`.
- [ ] Migration registry with version tracking (replace `migrateModelPrefs` every-launch loop). `App.tsx` (342–357).
- [ ] Markdown perf: memoize `MessageContent` by id+content-hash (O(n²) re-parse during streaming). `App.tsx` (55–72, 6790–6950).
- [ ] Domain metadata registry (consolidate icon/blurb/color/quickActions). `App.tsx`.
- [ ] Remove dead props/state in `DomainHome` (Icon, Tab/setTab, `void X` suppressions). `App.tsx` (3483–3654).
- [ ] Reduce App-root state sprawl via `useReducer`; remove unused `onboardOpen`. `App.tsx` (1495–1745).
- [ ] Extract shared thread (de)serialization between `save_session`/`save_thread`; standardize newline round-trip. `lib.rs`.
- [ ] CLI: `TurnError` type for attribution; session.ts WAL + JSONL-canonical + `rebuild-fts` command; shared `cli-args.ts` parser; council chair validation/WARN; manifest forward-migration; ollama/openrouter probe-error hints.
- [ ] Regenerate desktop `package-lock.json` (0.3.0 → 0.4.0); fix CHANGELOG v0.4 date. `package-lock.json`, `CHANGELOG.md`.
- [ ] Add `npm audit`/`cargo audit` to CI.

## 5. OSS Infra Checklist

- [ ] Desktop `SECURITY.md` (Keychain, subprocess env scoping, vault-only I/O, MCP auth, WebUI threat model) — **gated on P0 fixes landing first**.
- [ ] Desktop `CONTRIBUTING.md` (prereqs: Node 20+, Rust, Xcode CLT; `tauri:dev`/`tauri:build`; sidecar build from CLI repo) + `CODE_OF_CONDUCT.md`.
- [ ] `.github/` issue + PR templates; `test.yml` (typecheck/lint/test/build) alongside `release.yml`.
- [ ] biome config for desktop (`src/**/*.ts`, `src-tauri/src/**/*.rs`); clippy/rustfmt in CI.
- [ ] README rewrite (kill v0.1 claims; document sidecar, signing, WebUI, OpenRouter, vault schema-v1 compat).
- [ ] package.json `repository`/`homepage`; keep `private:true`; regenerate lockfile.
- [ ] CLI side is largely done (LICENSE, CONTRIBUTING, CoC, SECURITY, CHANGELOG, test.yml) — only the SSOT/privacy/OpenRouter P1 items remain.

## 6. Recommended Sequence (riskiest first)

1. **Lock down the WebUI bridge** (all of §2's webui/lib.rs items + CSP + 127.0.0.1 bind + token rework). This is the single largest risk and gates everything public. Decision: ship v0.4 publicly with WebUI **disabled/feature-flagged** if token rework can't land fast — that converts several P0s to non-reachable immediately.
2. **Close remaining P0 backend/CLI security** (path/domain validation, keychain stdin, env scrub, API-key redaction).
3. **Stand up desktop CI** (typecheck/lint/test/build) + **fix the sidecar-in-CI release gap** — so subsequent refactors are guarded and releases are reproducible.
4. **Write governance docs + fix README/version drift** — the minimum to accept outside contributors honestly.
5. **CLI engine P1s** (CliKind SSOT, privacy enforcement, OpenRouter tests, budget tracking) — small, high-leverage, makes the CLI publishable cleanly.
6. **Rust correctness** (lock poisoning, distill cursor race) — fix before broad daemon changes.
7. **Structural refactors** (App.tsx decomposition, lib.rs split, localStorage/invoke typing, error boundaries) — large but non-blocking; do behind the new tests, ideally as the first "good first issues" for contributors.
8. **P2 polish** opportunistically.

Key files: `src-tauri/src/webui.rs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/src/ingestion/keychain.rs`, `src/App.tsx`, `src/bridge.ts`, `fd-apps-prevail-cli/src/{privacy,cli-bridge,config,chat-json,council-runner}.ts`.