# Prevail v0.1.145

Prevail becomes something your other AI tools can actually use, not just talk to: a far bigger MCP surface, auto-council that fires in any domain (including over MCP), and a consistent master-detail layout across Apps and Runtimes.

## New

- **MCP, expanded 5 to 21 tools.** Claude Code, Codex, Gemini and the rest can now read your intents, decisions, recommendations, surfaced next-actions, and learned memory; create and update tasks; log decisions; list and run loops; list and sync apps; connect a new app; and check vault status - not just chat and council.
- **Auto-council everywhere.** Turn on "Auto-council for AI tools" once (Integrations > MCP) and a high-stakes judgment call is automatically escalated to a multi-model council - in the Prevail chat and when any AI tool calls Prevail over MCP, in whatever domain it lands. Council output now shows what each member said, then the verdict.
- **Intent provenance.** Every distilled intent shows which surfaces fed it (Claude Code, Codex, Prevail chat, ...), and the Journal now includes prompts captured from your other tools, not just Prevail chats - each badged by where it came from.
- **Prompt capture controls.** Per-tool on/off switches, a one-click reveal of where each tool's prompts are read from, and a clean `_meta/prompts/` layout.
- **Consistent master-detail layout.** Apps and Runtimes now share one template: a flush list column that collapses to a logo rail, attached to a detail pane on the right. Runtimes shows each runtime's status, version, cost, and per-model verify/test/default/chat; Apps groups Direct, Composio and Nango the same way.

## Improved

- **Privacy page** rebuilt into three clear, equal sections - Bunker Mode, Vault Lock, Incognito - each with a granular per-channel status row.
- **Intents and Journal paginate** so hundreds of entries stay fast.
- **Runtimes** drops the redundant status strip; validity now reads as a checkmark on each runtime, and the list opens by default.

## Fixed

- **Claude Code MCP "Failed to reconnect (-32000)."** A stale project-scoped registration (old binary, a bad vault path) was shadowing the good user-scope server. Detection now reads the config directly (no fragile `claude` spawn), install registers globally at user scope, and stale project entries are purged so the right server runs everywhere.
