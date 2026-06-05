# Prevail desktop

Native macOS cockpit for AI council deliberation. Tauri 2 + React 19 + Tailwind 4.

The companion to the [Prevail CLI](https://github.com/fru-dev3/prevail) — same vault format, same canonical benchmark, no terminal required.

## What v0.1 ships

- **Vault picker** — pick any folder; child folders with a `state.md` become domains
- **Domain sidebar** — list every domain in the chosen vault
- **Chat panel** — send a prompt to one of your installed CLIs (Claude / Codex / Antigravity / Ollama), stream the reply live
- **Council panel** — fan one question out to every available CLI in parallel, then auto-synthesize a verdict with the chair model you pick
- **Benchmark viewer** — read every scored run from `<vault>/benchmark/runs/`, surface the leaderboard, click any row to drill into per-question prompts / replies / keyword hits / judge rationale

## What v0.1 deliberately does NOT have

- Live MCP server inside the app (use the CLI for that)
- Configure / Tools / Telegram panels
- Auto-distill summaries / scheduled briefings
- Skills, lenses, frameworks, web-access cycling
- Two-machine sync (writes to your own local vault only)
- Auto-update inside the app (manual DMG download for v0.x)

These all stay in the CLI; the desktop is a deliberate MVP that proves the pattern. v0.2+ adds the rest.

## Requirements

- macOS 13+
- One or more of: `claude`, `codex`, `agy`, `ollama` installed and on `$PATH`. The app spawns them as subprocesses; it does not bring its own API keys.
- An existing vault folder, or [the demo vault](https://github.com/fru-dev3/prevail/tree/main/vault-demo).

## Install (end users)

Download the latest `.dmg` from the [releases page](https://github.com/fru-dev3/prevail-desktop/releases) and drag `Prevail.app` to `/Applications`.

The app is **unsigned for v0.1** — on first launch, right-click → **Open**, then confirm. macOS will remember the choice. Signing and notarization come in v0.2.

## Develop

```bash
npm install
npm run tauri:dev      # hot-reload dev mode
npm run tauri:build    # produces a .dmg under src-tauri/target/release/bundle/dmg/
```

## Architecture

- **Frontend:** Vite + React 19 + Tailwind 4 + framer-motion + lucide-react. Single `App.tsx` with all panels.
- **Backend (Rust):** Tauri 2 with `tauri-plugin-shell` (spawn CLIs), `tauri-plugin-dialog` (folder picker), `tauri-plugin-fs` (read state.md / benchmark JSON).
- **No sidecar binary:** v0.1 calls the user's existing `claude` / `codex` / `agy` / `ollama` CLIs directly via PATH. No bundled prevail binary, no MCP, no daemon.
- **Streaming:** Rust spawns the CLI, captures stdout chunks, emits them as Tauri events. The React UI listens via `@tauri-apps/api/event` and updates state per chunk.

See `src-tauri/src/lib.rs` for every Rust command and `src/App.tsx` for the UI.

## License

MIT. © 2026 fru.dev.
