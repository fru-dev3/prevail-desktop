# Prevail Desktop — Status & Continuity

**Last updated:** 2026-06-07
**Current shipped version:** v0.4.1 (signed, notarized, stapled, live)

This file is the single resume point for anyone (human or agent) picking the
project back up. It records what is DONE, what is LEFT, and exactly HOW to
continue. For the deep dives it points at the other `docs/` files instead of
duplicating them.

---

## TL;DR

Everything in the Features-v1 plan and the v1 audit's P0/P1 work is **built,
shipped, and verified live**. v0.4.1 is signed + Apple-notarized + Gatekeeper-
passed and serving from prevail.sh + the GitHub release + the in-app auto-update
feed. The only open items are **(a) Composio live-wiring — blocked on Fru's
Composio API key** and **(b) P2 polish — intentionally deferred to contributors**.

Fru is testing v0.4.1 on the Mac mini (Apple M4, arm64, macOS 26.2) and the
MacBook Air (both Apple Silicon → the arm64 DMG runs natively).

---

## What's DONE

### Features v1 (the 12 features from `Features v.1.pdf`) — all 5 phases shipped
- **Phase 1 — Memory & Context + background distillation:** `distill.rs` daemon,
  `_memory.md` / `_distill.json` cursor, Memory & Context settings section,
  memory preamble fed into `send()`/`convene()`.
- **Phase 2 — Config & lifecycle:** autostart, tray + close-to-tray, export/import
  config, reset-to-defaults, enriched About + `tauri-plugin-updater`, uninstall tiers.
- **Phase 3 — Safety / Gateway / MCP pages:** Safety section (approval mode,
  command allowlist, redact-secrets), Gateway (Telegram live, others "coming soon"),
  MCP consume + expose.
- **Phase 4 — Providers:** engine OpenAI-compatible SSE client; OpenRouter gateway
  + direct providers (`CliKind` extended in engine `config.ts`/`cli-bridge.ts`);
  Providers settings section (Keychain `prevail.providers`); ProviderSetup onboarding;
  migrate-from-openclaw/hermes.
- **Phase 5 — WebUI:** in-process `webui.rs` tiny_http server, `src/bridge.ts`
  transport shim (real IPC on desktop, HTTP `/api/invoke` + SSE `/api/events` in
  browser), webview-proxy, deny-by-default allowlist (`WEBUI_ALLOWED`), 127.0.0.1
  bind, random session token, WebLogin gate. Verified in a real browser.

### Audit (`docs/AUDIT-v1.md`) remediation
- **P0 WebUI security:** allowlist, constant-time token compare, /api/emit 403,
  loopback bind.
- **P0 backend/CLI security:** path-traversal guards (`is_safe_domain`,
  `guard_managed_path`), `provider_key_exists` never leaks keys, privacy.ts
  secret redaction, `app_uninstall` never deletes the vault.
- **P1 code health:** CI, tests (engine + Rust crate), governance, the new
  surface/tasks/distill modules each with unit tests.

### Self-learning intent ledger (Fru's core goal)
- `intent_append` → `<vault>/<domain>/_intents.jsonl`, `journal_append` →
  `_journal.md`. Intent saved synchronously on SEND (survives a crash mid-reply);
  raw unstripped reply + model + all prefs captured on completion. Distilled into
  `_memory.md` by the distill daemon.

### Connectors (task #10, UI portion)
- `CONNECTOR_GROUPS` with simple-icons brand marks, grouped by category
  (Finance / Email&Calendar / Files&Notes / Productivity / Developer /
  Health&Fitness / Social), ~35 integrations, Composio hub card "coming soon".
  Toggle selection buttons fixed app-wide.

### Distribution (the part that kept breaking)
- **Self-contained install:** engine ships as a Tauri `externalBin` sidecar
  (`scripts/prepare-sidecar.sh` bun-compiles ~69MB binary each build; inherits
  hardened-runtime JIT entitlements). No external CLI dependency — confirmed
  working on a clean MacBook Air. Fixed the onboarding-hang on fresh machines.
- **Signed + notarized:** Developer ID Application: Fru Nde (TXN399AHT5). Both
  the `.app` and the DMG are notarized + stapled. Fixes the "is damaged"
  Gatekeeper error. See `docs/RELEASE.md` + the `tauri-mac-sign-notarize` skill.

---

## How to cut a release (the working path)

```
bash scripts/release.sh          # full: build → notarize app+dmg → Gatekeeper GATE → publish
SKIP_BUILD=1 bash scripts/release.sh   # reuse last build, re-publish only
```

What it does: reads version from `src-tauri/tauri.conf.json`, pulls Apple creds
from 1Password item `o4smftszeclcwy54c6tofu4kny`, exports the updater key from
`~/.prevail/updater.key`, builds, notarizes + staples app & DMG, HARD-GATES on a
quarantined Gatekeeper + bundled-engine test, then publishes to the site
(`public/Prevail-mac-arm64.dmg` + stamps `src/version.ts`), the GitHub release,
and the `latest.json` auto-update feed.

**Prerequisites / gotchas (learned the hard way):**
- **1Password must be unlocked in a way the shell can see it.** The CLI-only
  `op signin` session does NOT carry across fresh shells. Enable the 1Password
  **desktop app CLI integration** (Touch ID per call, works from any shell).
- **Eject stale DMG mounts before building.** A leftover read-write image
  (`rw.*.Prevail_*.dmg` attached as `/dev/diskN`) jams `bundle_dmg.sh` with
  "error running bundle_dmg.sh". Check `hdiutil info | grep -i prevail`, then
  `hdiutil detach /dev/diskN -force` and `rm` the `rw.*.dmg` temp.
- **Transient `git push` failures** (`curl 55 ... bad record mac`) abort the
  script after the build. The build artifacts are fine — just re-push the site
  and finish the GitHub release step manually (or `SKIP_BUILD=1` re-run).
- **arm64-only.** The DMG is Apple Silicon. No Intel/universal build yet.
- CI `.github/workflows/release.yml` is NOT updated for the sidecar — local
  `release.sh` is the working path.

**Release endpoints (all verified live for v0.4.1):**
- Site: https://prevail.sh/Prevail-mac-arm64.dmg (stable URL, saves as
  `Prevail-<version>-arm64.dmg`)
- Release: https://github.com/fru-dev3/prevail-desktop/releases/tag/v0.4.1
- Updater feed: `…/releases/latest/download/latest.json`

---

## What's LEFT

### Task #10 — Composio live-wiring (BLOCKED on Fru)
The connector cards are built and look right. Making them actually authenticate
and pull data needs **Fru's Composio API key**. When provided: wire the
"the c"-style hub (Composio) to authenticate into each service, flip cards from
"coming soon" to live, and feed synced data into the per-domain vault as raw
material the distiller picks up.

Also in this bucket (not blocked, just not started): auto-distill into reusable
skills; scheduled-notification reminders from `_tasks.md` `@YYYY-MM-DD` due dates.

### Task #11 — P2 polish (DEFERRED on purpose)
Per the audit, defer to contributors — cleanup, not features, and risky right
after a release:
- Decompose the ~12.5k-line `src/App.tsx` and the large `lib.rs` into modules.
- Markdown render memoization.
- Lower-severity P0s consciously deferred: keychain-write-via-stdin, ingestion
  subprocess env-scrub.

---

## Map of the repos (under `~/Documents/fru/fd-apps/`)
- `fd-apps-prevail-cli` — Bun + TS engine (single binary; business logic SSOT).
- `fd-apps-prevail-desktop` — **this repo** (Tauri 2 + React 19 + Tailwind 4).
- `fd-apps-prevail-tui` — Bun/OpenTUI thin subprocess client of the engine.
- `fd-apps-prevail-site` — Vite + React landing page → Netlify (prevail.sh).
- `fd-apps-prevail-docs` — Astro docs site.

## Companion docs
- `docs/AUDIT-v1.md` — the 73-finding audit (WebUI was the headline P0).
- `docs/RESEARCH-landscape.md` — competitive research + verdict.
- `docs/PLAN-v1-unified.md` — the unified build plan.
- `docs/FEATURES-v1-PLAN.md` — the 12-feature checklist (all phases done).
- `docs/RELEASE.md` — release/signing reference.
