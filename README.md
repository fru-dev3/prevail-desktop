<div align="center">

<img src=".github/media/icon.png" alt="Prevail" width="84" />

# Prevail

### Your private AI that learns you — and gets sharper every time you use it.

A local-first **life-OS** for macOS. A native cockpit that runs AI per
life-domain — **wealth, health, tax, career** — grounded in a markdown vault on
*your* machine. Any model. No terminal. Nothing leaves unless you say so.

<p>
  <a href="https://github.com/fru-dev3/prevail-desktop/releases/latest/download/Prevail-mac-arm64.dmg"><img src="https://img.shields.io/badge/Download-Prevail%20for%20macOS-1f6f5c?style=for-the-badge&logo=apple&logoColor=white" alt="Download Prevail for macOS" /></a>
</p>

<p>
  <a href="https://github.com/fru-dev3/prevail-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/fru-dev3/prevail-desktop?label=latest&color=1f6f5c" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/macOS-13%2B%20·%20Apple%20Silicon-111111?logo=apple&logoColor=white" alt="macOS 13+ Apple Silicon" />
  <img src="https://img.shields.io/badge/signed%20%26%20notarized-✓-1f6f5c" alt="Signed & notarized" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-555" alt="GPL-3.0" />
</p>

<img src=".github/media/home.png" alt="Prevail — a domain-grounded AI cockpit" width="900" />

</div>

## Install

**One line** — downloads, installs to `/Applications`, and launches:

```bash
curl -fsSL https://github.com/fru-dev3/prevail-desktop/releases/latest/download/Prevail-mac-arm64.dmg -o /tmp/Prevail.dmg && \
VOL="$(hdiutil attach -nobrowse -noautoopen /tmp/Prevail.dmg | grep -o '/Volumes/.*' | head -1)" && \
cp -R "$VOL/Prevail.app" /Applications/ && hdiutil detach "$VOL" >/dev/null && \
xattr -dr com.apple.quarantine /Applications/Prevail.app 2>/dev/null; open -a Prevail
```

Prefer to click? **[⤓ Download the `.dmg`](https://github.com/fru-dev3/prevail-desktop/releases/latest/download/Prevail-mac-arm64.dmg)** and drag `Prevail.app` to Applications. Signed & **notarized** — no Gatekeeper warning. _Requires macOS 13+ (Apple Silicon)._

&nbsp;·&nbsp; [prevail.sh](https://prevail.sh) &nbsp;·&nbsp; [all releases](https://github.com/fru-dev3/prevail-desktop/releases)

## Why Prevail

- **It's yours.** Your vault, chats, and the durable *intent ledger* stay on your machine. Local-first by default — nothing leaves until you turn on an integration.
- **It learns you.** Every message is captured as an *intent* the instant you send it (raw, never lost), then distilled into per-domain memory that's fed back into future chats. The more you use it, the sharper it gets.
- **Grounded, not generic.** Each life-domain answers from *its own* real state and history — not a blank slate every time.
- **Any model, one cockpit.** Installed CLIs (Claude · Codex · Antigravity · Ollama) **or** bring-your-own via the **OpenRouter** gateway — one key, 200+ models. Switch per turn; context carries across.
- **Council.** Fan one question to multiple models in parallel; a chair model synthesizes a single verdict.
- **Private by default.** Zero telemetry unless you explicitly opt in. Secrets live in the macOS Keychain.

## Key features

- **Demo-first** — launches into a pre-populated sample household (11 domains, realistic data). Explore freely, then switch to your own vault in one click.
- **Starter packs** — ready-made domain sets (Family · High-Income · Freelancer · Creator · Small Business · Student).
- **Self-learning memory** — raw intent ledger → distilled per-domain `_memory.md`, always reusable.
- **Council & benchmarks** — multi-model deliberation plus a built-in benchmark viewer.
- **Gateway (Telegram), MCP** (consume *and* expose), **Providers**, and a **Remote WebUI** — the *same* UI in a browser, loopback-bound + allowlisted, off by default.
- **Quality of life** — usage dashboard, in-app auto-update, start-on-boot, tray, export/import config.

## Screenshots

<div align="center">

| Domain-grounded chat | Every model, one cockpit |
| :---: | :---: |
| <img src=".github/media/home.png" alt="Home — what should we work on" width="430" /> | <img src=".github/media/models.png" alt="Models — installed CLIs and API providers" width="430" /> |

</div>

## Develop

```bash
npm install
npm run tauri dev     # hot-reload
npm run tauri build   # signed .dmg under src-tauri/target/release/bundle/dmg/
```

The engine **sidecar** is built from the sibling [`prevail-cli`](https://github.com/fru-dev3/prevail-cli) repo by `scripts/prepare-sidecar.sh` (wired into `beforeBuildCommand`), so the install is fully self-contained. **Stack:** Tauri 2 · React 19 · Tailwind 4; the frontend talks to the Rust backend only through `src/bridge.ts`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security & privacy

Secrets live in the Keychain; the WebUI is loopback-only + allowlisted when enabled. Telemetry is **off by default** — if you opt in, only an anonymous UUID and a fixed allowlist of event names are sent (never your name, paths, or vault content), and every event is mirrored to a local log you can read. See [SECURITY.md](SECURITY.md).

## License

[GPL-3.0-only](./LICENSE) · © 2026 example.com. Free to use, study, share, and modify; redistributed forks stay open under the same license.
