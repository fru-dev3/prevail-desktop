# Prevail Desktop — Features v1: Analysis & Build Plan

Source: `Features v.1.pdf` (reference designs from AionUI + Hermes). This bounces
each requested feature against what Prevail already has, then sequences the build.

Legend — **Have** / **Partial** / **Missing**, and effort **S/M/L/XL**.

---

## Current state (grounding)

- **Settings** already has sections: general, agents, user, vault, appearance,
  defaults, frameworks, skills, tools, ingestion, shortcuts, about. Easy to extend.
- **Tauri plugins**: opener, dialog, fs, shell only. **No updater / autostart /
  tray / single-instance** — those features need new plugins.
- **Models are CLI-based** — Prevail routes to installed CLIs (claude/codex/
  antigravity/ollama) over PATH + per-CLI `MODELS`. There is **no API-key provider
  system**. Bundled engine sidecar (`prevail`) is self-contained.
- **MCP**: *consuming* MCP servers exists (`ingestion_mcp_*`). *Exposing* Prevail
  as an MCP server exists in the CLI engine (`mcp-server`), not in the desktop UI.
- **Gateways**: Telegram bridge is built (`telegram_bridge_*`). No other platforms.
- **Persistence** (per the self-learning audit): raw transcripts auto-save per turn
  to `<vault>/<domain>/_threads/*.md` (domain + agent captured; **model now captured
  too**). Usage ledger at `<vault>/usage/usage.ndjson`. Journals are a manual
  one-line index, not a distillation. No capture of the exact sent prompt, prefs,
  or raw output yet.
- **Release pipeline**: `scripts/release.sh` (sign → notarize → staple → gated
  publish). No in-app auto-update yet.

---

## Feature-by-feature analysis

| # | Feature (PDF) | Status | Gap / approach | Effort |
|---|---|---|---|---|
| 1 | **WebUI** — open the app in a browser; later anywhere via Tailscale/Cloudflare | Missing | Frontend uses Tauri `invoke` (IPC), which a browser can't call. Need: (a) an HTTP+WS server inside the Tauri app that re-exposes the commands as an API, (b) a transport shim in the frontend that picks `invoke` vs `fetch/ws` by environment, (c) auth (the PDF shows username + initial password). Then it's "just a wrapper." Tailscale/Cloudflare is deployment, not code. | XL |
| 2 | **More config** — start on boot, close to tray, hardware accel, LLM/agent timeouts, save-uploads, auto-preview office, notifications, work/log dirs, language | Partial | Timeouts + a few prefs exist. New: `tauri-plugin-autostart` (boot), tray + window-close-to-tray, hardware-accel toggle (WKWebView/window flag), directory pickers, OS notifications. Most others are simple prefs. | M |
| 3 | **Safety page** — approval mode, approval timeout, confirm MCP reloads, command allowlist, redact secrets, private-URL toggles, file checkpoints | Missing | New Settings section. UI is easy; the work is *enforcement*: command allowlist + approval gate around tool/command execution, secret redaction in saved transcripts + model-visible content, file-checkpoint snapshots before edits. Ties into chat/engine paths. | M–L |
| 4 | **Memory & Context** — persistent memory, user profile, budgets, memory provider, context engine/compressor, auto-compression, protected recent | Partial | Engine has ContextScore + some compression notions; nothing surfaced in desktop. **Overlaps the active self-learning goal.** Build on the intent ledger (Phase 0). User profile already has `user.md`. | L |
| 5 | **Gateway (messaging) layout** — Telegram (done) + Discord/Slack/Matrix/WhatsApp/Signal/Email/SMS… as "coming soon" | Partial | Telegram bridge exists — wire it into the new layout; render the rest as disabled "coming soon" cards. Mostly UI + connecting the live Telegram path. | M |
| 6 | **Providers / API keys** — OpenRouter, Anthropic, xAI, Gemini, DeepSeek, Qwen, GLM, Kimi, MiniMax, HuggingFace, OpenCode Zen | Missing | **Architectural.** Today routing is CLI-only. Needs: provider registry + secure key storage (1Password pattern / Keychain), and the engine able to call provider APIs (or via OpenRouter as the universal gateway). **Decision needed:** does the prevail engine call provider APIs, or do we lean on OpenRouter + the existing CLIs? Investigate engine support first. | L–XL |
| 7 | **About page + auto-update + uninstall + diagnostics** | Partial | About section exists (minimal). Add: `tauri-plugin-updater` (background check, notify, install) hooked to our signed release feed; uninstall tiers (GUI only / keep data / everything); Run Diagnosis + Debug Dump; engine/desktop/versions panel. Synergizes with `release.sh`. | M |
| 8 | **Export / import configs** | Missing | Serialize prefs (localStorage) + vault-level config to a JSON bundle; import to restore. Pair with #9. | S–M |
| 9 | **Reset all to defaults** | Missing | Clear prefs to documented defaults with a confirm. | S |
| 10 | **MCP server page** — add MCP servers (consume) + expose Prevail as MCP (serve) | Partial | Consuming exists (`ingestion_mcp_*`) — surface an "add stdio/HTTP server" UI like the screenshot. Exposing exists in the engine (`mcp-server`) — add a toggle/page to run + show connection details. | M |
| 11 | **Improve "Set Up Your AI Provider" onboarding** | Partial | Onboarding/VaultWizard exists. This depends on #6 (providers). Provider cards + key entry + "recommended". | M (after #6) |
| 12 | **Migrate to Prevail from openclaw / hermes** | Missing | Detect `~/.openclaw`, `~/.hermes`; import config, API keys, sessions, skills. Banner + mapping. | M |

---

## Phase 0 — Self-learning capture (active goal; foundation for #4) — BUILT

Everything memory/context depends on never losing intent. Done + verified:

- [x] Capture **model** per turn in threads/sessions (was `null`).
- [x] Save the **user's intent immediately on send** — `intent_append` fires
  synchronously before the async model call, so a turn survives a crash mid-reply.
- [x] Append-only **intent ledger** `<vault>/<domain>/_intents.jsonl` (vault root for
  General): on send — exact prompt sent, message, cli, model, and **all preferences**
  (framework, lens, localOnly, web, serendipity, auto, council, skills, attachments,
  primed context); on completion — the **raw, unstripped reply** paired by session.
  Engine + native paths. Rebuild-from-scratch source of truth.
- [x] **Auto-journal**: `journal_append` writes a distilled line per completed turn
  (date · model · intent snippet), newest-first — no longer manual-only.
- [x] Verified: `intent_ledger_and_journal_roundtrip` Rust test (8 tests pass), tsc + build green.
- [ ] Next (optional): LLM-based richer journal distillation + background pass
  (user wants to weigh on-demand vs. daemon); surface the ledger in a Memory/Context UI (#4).

## Phase 1 — Config & lifecycle (quick wins, low risk)

- #2 More config: autostart, close-to-tray, hardware-accel, directories, notifications.
- #8 Export/import config · #9 Reset to defaults.
- #7 About polish + diagnostics, then **auto-update** (updater plugin → our signed feed).

## Phase 2 — Settings depth

- #3 Safety page (+ enforcement) · #4 Memory & Context UI (on Phase 0 ledger)
- #5 Gateway layout (Telegram live + coming-soon) · #10 MCP page (consume + expose)

## Phase 3 — Providers (architectural)

- #6 Providers/API keys (investigate engine support / OpenRouter-as-gateway first)
- #11 Improve provider onboarding (depends on #6) · #12 Migrate from openclaw/hermes

## Phase 4 — WebUI

- #1 HTTP/WS bridge + transport shim + auth; then Tailscale/Cloudflare exposure.

---

## Key decisions to make first

1. **Providers (#6):** engine-native API calls vs. OpenRouter-as-universal-gateway
   vs. keep CLI-routing + add only OpenRouter. Biggest fork; gates #11.
2. **Journal distillation (#4 / Phase 0):** on-demand vs. background daemon, and
   which model distills (local/cheap vs. the chat model).
3. **WebUI (#1):** in-process Rust HTTP server vs. a thin companion; auth model.
4. **Auto-update (#7):** host an update manifest (GitHub releases feed) — reuses the
   signing/notarization we already set up.
