# Prevail Desktop

A local-first **life-OS** for macOS — a native cockpit that runs AI per
life-domain (wealth, health, tax, career…), grounded in a local markdown vault.
Tauri 2 + React 19 + Tailwind 4, with a bundled engine (the
[Prevail CLI](https://github.com/fru-dev3/prevail)) — same vault format, no
terminal required.

> **Local-first.** Your vault, chats, and the durable *intent ledger* stay on
> your machine. Nothing leaves unless you turn on an integration.

## What it does (v0.4)

- **Domains** — each folder with `soul.md`/`state.md` becomes a life-domain; chat
  is grounded in that domain's real state and history.
- **Self-learning** — every chat is captured as an *intent* the moment you send
  (raw transcript, never lost), distilled into per-domain memory (`_memory.md`)
  that's fed back into future chats. See `docs/` for the model.
- **Any model** — installed CLIs (Claude / Codex / Antigravity / Ollama) **or**
  bring-your-own via the **OpenRouter** gateway (one key, 200+ models). Switch
  models per turn; context carries across.
- **Council** — fan one question to multiple models in parallel; a chair model
  synthesizes a verdict.
- **Memory & Context, Safety, Gateway (Telegram), MCP (consume + expose),
  Providers, Remote (WebUI)** — all in Settings.
- **Usage dashboard**, benchmark viewer, in-app **auto-update**, start-on-boot,
  tray, export/import config.
- **Remote (WebUI)** — serve the *same* UI to a browser (no duplicate UI);
  off by default, loopback-bound, allowlisted. Reach it via Tailscale.

## Requirements
- macOS 13+ (Apple Silicon).
- Optional: `claude` / `codex` / `agy` / `ollama` on `$PATH`, and/or an OpenRouter
  key (Settings → Providers). The bundled engine handles the rest.
- A vault folder, or load the bundled sample on first launch.

## Install
Download the signed, **notarized** `.dmg` from
[prevail.sh](https://prevail.sh) or the
[releases page](https://github.com/fru-dev3/prevail-desktop/releases) and drag
`Prevail.app` to `/Applications`. (Notarized — no Gatekeeper "damaged" warning.)

## Develop
```bash
npm install
npm run tauri dev     # hot-reload
npm run tauri build   # signed .dmg under src-tauri/target/release/bundle/dmg/
```
The engine **sidecar** is built from the sibling `fd-apps-prevail-cli` repo by
`scripts/prepare-sidecar.sh` (wired into `beforeBuildCommand`). See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture
- **Frontend:** Vite + React 19 + Tailwind 4. Talks to the backend only through
  `src/bridge.ts` (Tauri IPC on desktop, HTTP/SSE in the browser).
- **Backend (Rust):** Tauri 2 — engine seam (`engine.rs`), distillation daemon
  (`distill.rs`), Telegram bridge, WebUI bridge (`webui.rs`), ingestion/MCP.
- **Bundled engine:** the `prevail` CLI ships as a Tauri `externalBin` sidecar —
  the install is fully self-contained.

## Security
See [SECURITY.md](SECURITY.md). Vault is **not** encrypted at rest; secrets live
in the Keychain; the WebUI is loopback-only + allowlisted when enabled.

## License
MIT. © 2026 example.com.
