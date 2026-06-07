# Changelog

All notable changes to Prevail desktop. Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

---

## [Unreleased]

### Added

- **Usage capture** — every completed chat turn (engine and native paths) appends a record to `<vault>/usage/usage.ndjson` with timestamp, domain, thread, CLI, model, token counts, and cost
- **Usage dashboard** — the no-domain landing now shows totals (turns / tokens / cost), a per-day activity strip, and breakdowns by agent, model, and domain, read back via the `usage_summary` command

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
