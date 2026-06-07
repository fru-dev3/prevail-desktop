# Changelog

All notable changes to Prevail desktop. Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

---

## [0.4.0] — Features v1: self-learning, providers, WebUI

### Added

- **Usage capture + dashboard** — every turn → `<vault>/usage/usage.ndjson`; no-domain landing shows totals + per-day strip + by agent/model/domain.
- **Self-learning intent ledger** — every chat saved as an intent the instant you send (never lost): exact prompt + raw reply + model + all preferences → `<vault>/<domain>/_intents.jsonl`, with auto-journaling.
- **Memory & Context** — background distillation daemon compresses the ledger into per-domain `_memory.md`, fed back into prompts; full settings section.
- **Config & lifecycle** — start-on-boot, system tray + close-to-tray, export/import config, reset-to-defaults, diagnostics, uninstall tiers, and in-app auto-update.
- **Safety** — approval mode, command allowlist, redact-secrets (enforced), file checkpoints.
- **Gateway** — Telegram live + coming-soon platforms; **MCP** — consume servers + expose Prevail as an MCP server.
- **Providers** — OpenRouter gateway: one key, every model (Claude/GPT/Gemini/Grok/DeepSeek/Qwen…); keys in Keychain.
- **WebUI** — serve the same app to a browser via an in-app bridge (no duplicate UI); reach it anywhere over Tailscale/Cloudflare.

## [Unreleased]

---

## [0.1.0] — 2026-06-05 · First release

Initial desktop MVP. Native React UI mirroring the Prevail CLI's highest-value flows. Tauri 2 + React 19 + Tailwind 4. Apple Silicon only, unsigned DMG.

### Added

- **Vault picker** wizard on first launch
- **Domain sidebar** — auto-scans the picked vault for child folders containing `state.md`
- **Chat panel** — pick one of your installed CLIs (Claude / Codex / Antigravity / Ollama), send a prompt, stream the reply
- **Council panel** — fan one question out to every available CLI in parallel, then auto-synthesize a final verdict via a chair model you pick
- **Benchmark viewer** — read every scored run from `<vault>/benchmark/runs/`, surface the leaderboard, click any row to drill into per-question prompt + reply + keyword hits/misses + judge rationale
- **CLI detection** at boot via `which claude/codex/agy/ollama`

### Architecture

- No bundled sidecar binary; the app calls your existing CLIs directly via PATH
- Streaming via Tauri events (Rust spawns CLI, emits stdout chunks, React listens)
- Dark theme only; gold `#C4A35A` accent matching the CLI brand
- Vault path persists in localStorage

### Known limitations (v0.1)

- Apple Silicon only — Intel Mac users need to build from source
- Unsigned DMG — first launch requires right-click → Open
- No tool / configure / MCP / telegram panels
- No auto-distill, briefings, skills, lenses, frameworks
- Writes to one local vault only; no Tailscale sync
- No auto-update; check the [releases page](https://github.com/fru-dev3/prevail-desktop/releases) periodically
