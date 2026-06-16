# A6 — Gateway surfaces: make them real (build spec)

Founder (Monday feedback): "Implement all the other surfaces so they are fully functional, not
just 'coming soon'. What other surfaces should we add similar to OpenClaw / Hermes."

Today only **Telegram** is a live two-way bridge (`telegram_bridge.rs` + the Gateway UI card).
The rest are "coming soon" chips. Each real surface needs: inbound receive → route to the
domain/council → push the reply back. The Telegram bridge is the reference implementation.

## The bridge contract (what every surface implements)
1. **Receive** an inbound message (poll or socket/webhook), with a sender/channel id.
2. **Route** it: match against domain routing keywords → pick the domain → run a CLI/council turn
   (reuse `run_cli` / the council runner, exactly like Telegram).
3. **Send** the reply back to the same channel.
4. **Status**: running/stopped + inbound/outbound counts + last error (TgBridgeStatus shape).
5. **Secret**: bot token / webhook secret in the Keychain (never localStorage), like Telegram.

A `surface_bridge_start/stop/status` command shape generalized from `telegram_*` keeps the UI
uniform (the Gateway card already renders a list; swap per-surface start/stop/status).

## Surfaces, ranked by effort (do in this order)
| Surface | Inbound | Effort | Notes |
|---|---|---|---|
| **Discord** | Gateway WS (or a bot lib) + REST send | M | Bot token; closest to Telegram. Do first. |
| **Slack** | Socket Mode (WS) or Events API webhook + Web API send | M | App token + bot token. |
| **Email (IMAP/SMTP)** | IMAP poll + SMTP send | M | Generic, no platform bot; high utility. |
| **SMS (Twilio)** | Twilio inbound webhook + REST send | S-M | Needs a public webhook URL (or the WebUI tunnel). |
| **Matrix** | client-server sync + send | M | Homeserver + access token. |
| **Mattermost** | WS + REST | M | Self-hosted; token. |
| **Signal** | signal-cli bridge | L | No official bot API; requires signal-cli daemon. Do last. |

## New surfaces worth adding (founder asked "what else, like OpenClaw/Hermes")
- **OpenClaw / Hermes / Paperclip** — the founder's own systems already share `~/.ai/`. Rather than
  a chat bridge, expose Prevail to them via the existing **MCP stdio** server (already shipped,
  MCP-1) — they consume Prevail as a tool. Document that as the integration path (no new bridge).
- **Webhook (generic)** — a catch-all inbound webhook so any system can POST a message and get a
  reply; the simplest "surface" and unblocks Zapier/n8n/custom.

## Build plan (phased; each phase ships one working surface)
- **P0 (shared):** generalize the bridge into `surface_bridge_{start,stop,status}` + a per-surface
  config (kind, secret ref, routes). Refactor Telegram onto it (no behavior change).
- **P1:** Discord (proves the generalization end-to-end).
- **P2:** Email (IMAP/SMTP) — broad utility, no platform lock-in.
- **P3:** Slack, Twilio SMS, generic Webhook.
- **P4:** Matrix, Mattermost. **P5:** Signal (signal-cli).
Each phase: engine bridge + Keychain secret + the Gateway card wired + a status indicator.

## Why not all-at-once
Each is a real integration needing that platform's API + the user's credentials at runtime. They
can't be "fully functional" as a single blind change. P0+P1 is the right first PR; the rest follow
one working surface at a time.
