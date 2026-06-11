# Changelog

All notable changes to Prevail desktop. Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

---

## [0.7.2] — 2026-06-10 · pack import flow + demo-first launch

### Added

- **Starter pack import triggers vault setup in demo mode.** Clicking Import on any starter pack while in demo mode now prompts you to set up your own vault — you pick a folder, the vault is initialized, and the pack is imported there in one flow. Importing has always been a signal of intent to keep something; now the UX matches that.

### Changed

- **Always starts in demo mode.** A fresh launch always enters demo, regardless of prior app state, unless you have previously switched to production with a real vault. This ensures every session begins with a consistent, working experience.
- **`home` domain renamed to `homestead`.** The domain slug and display name for the household/property domain is now `homestead` everywhere: sample vault, starter packs, generators, and rubrics.
- **Demo vault rebuilt with consistent Jordan Smith household.** The bundled sample vault now contains exactly 11 domains (chief, career, wealth, tax, health, fitness, insurance, homestead, travel, calendar, learning) all grounded in a single Jordan Smith persona — 29-year-old Senior Branch Manager, Frontera Bank, Austin TX. Net worth $133,980. Every domain has realistic data files, multi-turn chat threads, and cross-domain open items.
- **All 7 starter packs now include `chief`, `fitness`, and `career`.** These domains were missing from every pack; they are now present so any imported pack gives a complete foundation.

### Fixed

- Domains imported via a starter pack in demo mode no longer silently disappear on relaunch (they are now always imported into a real production vault).

---

## [0.7.0] — 2026-06-09 · demo-first onboarding

### Changed

- **Demo mode is the real default.** A fresh launch lands straight in a populated demo vault, with the "Demo Mode" ribbon and the config page to switch to production. From there you import domain templates (health, tax, wealth, insurance, and more) so production starts with the domains already scaffolded.

### Fixed

- **Demo vault now lives in app storage** (`~/.prevail/demo-vault`) instead of being dumped into `~/Documents`. The re-seed is **marker-guarded** — it only ever refreshes a folder Prevail owns and tagged as demo, so it can never delete a real folder a user happened to put at that path. (Closes a destructive `remove_dir_all` on the old `~/Documents/Prevail Sample Vault` path.)

## [0.6.0] — 2026-06-09 · usage v2, embedded vault, demo mode, encryption

### Added

- **Usage analytics, unified on the engine** — the desktop now delegates all token/cost accounting to the engine (one ledger, one pricing table). A per-domain **Usage tab** and a global stats view show queries, tokens, cost, over-time, by provider, and by model. Old desktop ledger migrated automatically.
- **Embedded vault** — an app-owned vault location (`~/.prevail/vault`) plus a non-destructive "Move vault into the app" migration; new installs can default here.
- **Demo / Production mode** — fresh installs auto-enter a populated **demo** vault (no setup wizard); a Settings banner switches to **production** when ready. Seeded demo content (usage + sample threads) so it isn't empty.
- **Starter packs** — importable persona bundles (`prevail.pack/v1`): Small Business Owner, Family, Student, High-Income, Freelancer, Creator — import a role's starter domains in one click (existing domains kept).
- **App lock (passcode)** — optional Argon2id passcode gate for opening the app.
- **Vault encryption at rest (opt-in)** — AES-256-GCM envelope encryption with a scrypt-derived key and a one-time **recovery code**. Encrypt/decrypt from Settings → Safety; the engine self-verifies and auto-rolls-back if anything is unreadable. Reads + writes across every vault module are transparently en/decrypted, path-aware so external files are never touched. *(Touch ID unlock + final live verification pending.)*

### Changed / Fixed

- **Bunker Mode** now visibly locks "Web access" off while active.
- Settings: **"About me" → "Pro Profile"**; one-line self-learning homepage hook.
- **Council**: a domain can be dragged onto the composer as context again.
- **Cross-platform sync** — theme/palette and the desktop's vault are inherited by the WebUI (the web view no longer starts blank).
- **Security**: removed the bundled benchmark sample data that leaked local paths + personal-scenario prompts into the shipped app.

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
