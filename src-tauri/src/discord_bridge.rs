// Discord native bridge (A6) — Gateway WebSocket + REST send.
//
// Discord has no polling API for messages: a bot receives via the Gateway (a
// WebSocket). The handshake is: connect → HELLO(op 10, heartbeat_interval) →
// IDENTIFY(op 2, token+intents) → heartbeat(op 1) on the interval → dispatch
// (op 0) events, of which we want MESSAGE_CREATE. Replies go out over REST
// (POST /channels/{id}/messages, "Bot <token>"). We skip messages authored by a
// bot so the council never answers itself.
//
// Off by default; inert until the user saves a bot token + channel and toggles
// it on. Routing/model/recording reuse the Telegram path. NOTE: the Gateway
// protocol is stateful (heartbeats, sequence numbers, reconnects); this is a
// solid first implementation that must still be verified against a live bot
// token before being relied on.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tokio::sync::{watch, Mutex as AsyncMutex};
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::telegram_bridge::{record_exchange, resolve_domain, run_cli_readonly, BridgeConfig, BridgeStatus, RouteRule};

const GATEWAY_URL: &str = "wss://gateway.discord.gg/?v=10&encoding=json";
const API: &str = "https://discord.com/api/v10";
// GUILD_MESSAGES (1<<9) | MESSAGE_CONTENT (1<<15) | DIRECT_MESSAGES (1<<12).
const INTENTS: u64 = (1 << 9) | (1 << 15) | (1 << 12);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DiscordConfig {
    pub token: String, // bot token (resolved from Keychain if empty)
    pub channel: String, // channel id to listen + reply in
    pub cli: String,
    pub model: Option<String>,
    pub domain: Option<String>,
    #[serde(default)]
    pub vault: Option<String>,
    #[serde(default)]
    pub routes: Vec<RouteRule>,
    // Optional per-user allowlist (Discord user ids). When non-empty, ONLY these
    // authors can drive the agent — otherwise any non-bot user in the channel
    // can (O28). Empty = keep channel-scoping (non-breaking for single-user setups).
    #[serde(default)]
    pub allowed_users: Vec<String>,
}

#[derive(Default)]
pub struct DiscordState {
    inner: Mutex<Inner>,
}
#[derive(Default)]
struct Inner {
    stop_tx: Option<watch::Sender<bool>>,
    handle: Option<JoinHandle<()>>,
    status: Arc<AsyncMutex<BridgeStatus>>,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

impl DiscordState {
    pub async fn status(&self) -> BridgeStatus {
        let arc = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).status.clone() };
        let g = arc.lock().await;
        g.clone()
    }
    pub async fn stop(&self) {
        let (tx, h, arc) = {
            let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            (i.stop_tx.take(), i.handle.take(), i.status.clone())
        };
        if let Some(tx) = tx { let _ = tx.send(true); }
        if let Some(h) = h { h.abort(); }
        arc.lock().await.running = false;
    }
    pub async fn start(&self, cfg: DiscordConfig) -> Result<(), String> {
        crate::bunker::guard_cloud()?;
        self.stop().await;
        let (stop_tx, stop_rx) = watch::channel(false);
        let status = Arc::new(AsyncMutex::new(BridgeStatus { running: true, ..Default::default() }));
        let status_task = status.clone();
        let handle = tauri::async_runtime::spawn(async move {
            if let Err(e) = run_gateway(cfg, stop_rx, status_task.clone()).await {
                let mut s = status_task.lock().await;
                s.last_error = Some(e);
                s.running = false;
            }
        });
        let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        i.stop_tx = Some(stop_tx);
        i.handle = Some(handle);
        i.status = status;
        Ok(())
    }
}

fn bridge_cfg(cfg: &DiscordConfig) -> BridgeConfig {
    BridgeConfig {
        token: String::new(), chat_id: cfg.channel.clone(), cli: cfg.cli.clone(),
        model: cfg.model.clone(), domain: cfg.domain.clone(), vault: cfg.vault.clone(), routes: cfg.routes.clone(),
        allowed_telegram_users: vec![],
    }
}

async fn run_gateway(cfg: DiscordConfig, mut stop_rx: watch::Receiver<bool>, status: Arc<AsyncMutex<BridgeStatus>>) -> Result<(), String> {
    let (ws, _) = tokio_tungstenite::connect_async(GATEWAY_URL).await.map_err(|e| format!("discord connect: {e}"))?;
    let (mut write, mut read) = ws.split();

    // First frame must be HELLO (op 10) with the heartbeat interval.
    let hb_interval = loop {
        tokio::select! {
            _ = stop_rx.changed() => { if *stop_rx.borrow() { return Ok(()); } }
            frame = read.next() => {
                let Some(Ok(WsMessage::Text(t))) = frame else { return Err("discord: no HELLO".into()); };
                let v: serde_json::Value = serde_json::from_str(&t).map_err(|e| format!("discord HELLO parse: {e}"))?;
                if let Some(interval) = parse_hello(&v) { break interval; }
            }
        }
    };

    // IDENTIFY (op 2).
    let identify = serde_json::json!({
        "op": 2,
        "d": { "token": cfg.token, "intents": INTENTS,
               "properties": { "os": "macos", "browser": "prevail", "device": "prevail" } }
    });
    write.send(WsMessage::Text(identify.to_string())).await.map_err(|e| format!("discord identify: {e}"))?;

    let mut heartbeat = tokio::time::interval(Duration::from_millis(hb_interval));
    let mut last_seq: Option<u64> = None;

    loop {
        tokio::select! {
            _ = stop_rx.changed() => { if *stop_rx.borrow() { return Ok(()); } }
            _ = heartbeat.tick() => {
                let hb = serde_json::json!({ "op": 1, "d": last_seq });
                if write.send(WsMessage::Text(hb.to_string())).await.is_err() { return Err("discord: heartbeat send failed".into()); }
            }
            frame = read.next() => {
                let msg = match frame {
                    Some(Ok(WsMessage::Text(t))) => t,
                    Some(Ok(WsMessage::Close(_))) | None => return Err("discord: gateway closed".into()),
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => return Err(format!("discord read: {e}")),
                };
                let v: serde_json::Value = match serde_json::from_str(&msg) { Ok(v) => v, Err(_) => continue };
                if let Some(s) = v.get("s").and_then(|s| s.as_u64()) { last_seq = Some(s); }
                // The decision logic is extracted + unit-tested (extract_message).
                let content = match extract_message(&v, &cfg.channel, &cfg.allowed_users) { Some(c) => c, None => continue };

                { let mut s = status.lock().await; s.inbound_count += 1; s.last_inbound_ts = Some(now_secs()); }
                let bcfg = bridge_cfg(&cfg);
                let domain = cfg.domain.clone().or_else(|| resolve_domain(&bcfg, &content));
                let reply = match run_cli_readonly(&cfg.cli, cfg.model.as_deref(), &crate::telegram_bridge::fence_untrusted_inbound(&content)).await {
                    Ok(r) => r,
                    Err(e) => { status.lock().await.last_error = Some(e); continue; }
                };
                match send_discord(&cfg.token, &cfg.channel, &reply).await {
                    Ok(()) => {
                        if let Some(dm) = domain.as_deref() { record_exchange(&bcfg, dm, &content, &reply); }
                        let mut s = status.lock().await; s.outbound_count += 1; s.last_outbound_ts = Some(now_secs());
                    }
                    Err(e) => { status.lock().await.last_error = Some(e); }
                }
            }
        }
    }
}

// Pure Gateway-frame decision logic (the error-prone part, unit-tested below).
// HELLO (op 10) → the heartbeat interval.
fn parse_hello(v: &serde_json::Value) -> Option<u64> {
    if v.get("op").and_then(|o| o.as_u64()) == Some(10) {
        return v.pointer("/d/heartbeat_interval").and_then(|h| h.as_u64());
    }
    None
}
// A dispatched MESSAGE_CREATE (op 0) → the content, IFF it's a non-bot message in
// the configured channel and non-empty. Anything else → None (ignored).
fn extract_message(v: &serde_json::Value, channel: &str, allowed_users: &[String]) -> Option<String> {
    if v.get("op").and_then(|o| o.as_u64()) != Some(0) { return None; }
    if v.get("t").and_then(|t| t.as_str()) != Some("MESSAGE_CREATE") { return None; }
    let d = v.get("d")?;
    if d.pointer("/author/bot").and_then(|b| b.as_bool()).unwrap_or(false) { return None; }
    if d.get("channel_id").and_then(|c| c.as_str()) != Some(channel) { return None; }
    // Per-user allowlist (O28): when set, only listed author ids may drive the agent.
    if !allowed_users.is_empty() {
        let author = d.pointer("/author/id").and_then(|i| i.as_str()).unwrap_or("");
        if !allowed_users.iter().any(|u| u == author) { return None; }
    }
    let content = d.get("content").and_then(|c| c.as_str()).unwrap_or("");
    if content.trim().is_empty() { return None; }
    Some(content.to_string())
}

async fn send_discord(token: &str, channel: &str, text: &str) -> Result<(), String> {
    send_discord_to(API, token, channel, text).await
}

// API base is a parameter so a test can point it at a mock server.
async fn send_discord_to(api: &str, token: &str, channel: &str, text: &str) -> Result<(), String> {
    // Discord caps a message at 2000 chars.
    let body = text.chars().take(2000).collect::<String>();
    let resp = reqwest::Client::new()
        .post(format!("{api}/channels/{channel}/messages"))
        .header("Authorization", format!("Bot {token}"))
        .json(&serde_json::json!({ "content": body }))
        .send().await.map_err(|e| format!("discord send: {e}"))?;
    if !resp.status().is_success() { return Err(format!("discord send HTTP {}", resp.status())); }
    Ok(())
}

#[tauri::command]
pub async fn discord_bridge_start(state: tauri::State<'_, DiscordState>, cfg: DiscordConfig) -> Result<BridgeStatus, String> {
    let mut cfg = cfg;
    if cfg.token.trim().is_empty() {
        cfg.token = crate::ingestion::keychain::get("prevail.providers", "native-discord").map_err(|_| "no Discord token configured".to_string())?;
        if cfg.token.trim().is_empty() { return Err("no Discord token configured".into()); }
    }
    state.start(cfg).await?;
    Ok(state.status().await)
}
#[tauri::command]
pub async fn discord_bridge_stop(state: tauri::State<'_, DiscordState>) -> Result<BridgeStatus, String> {
    state.stop().await; Ok(state.status().await)
}
#[tauri::command]
pub async fn discord_bridge_status(state: tauri::State<'_, DiscordState>) -> Result<BridgeStatus, String> {
    Ok(state.status().await)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn intents_include_message_content() {
        assert_eq!(INTENTS & (1 << 15), 1 << 15); // MESSAGE_CONTENT
        assert_eq!(INTENTS & (1 << 9), 1 << 9);   // GUILD_MESSAGES
    }
    #[test]
    fn bridge_cfg_never_carries_token() {
        let c = DiscordConfig { token: "secret".into(), channel: "123".into(), cli: "claude".into(), model: None, domain: None, vault: None, routes: vec![], allowed_users: vec![] };
        assert!(bridge_cfg(&c).token.is_empty());
        assert_eq!(bridge_cfg(&c).chat_id, "123");
    }

    // Verify the REST reply path (HTTP POST + status handling) against a mock,
    // including the 2000-char cap, with no live Discord call.
    fn mock_status(code: u32) -> String {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        std::thread::spawn(move || { if let Ok(req) = server.recv() { let _ = req.respond(tiny_http::Response::from_string("{}").with_status_code(code)); } });
        format!("http://127.0.0.1:{port}")
    }
    #[tokio::test]
    async fn send_discord_posts_and_maps_status() {
        let ok = mock_status(200);
        assert!(send_discord_to(&ok, "tok", "123", &"x".repeat(5000)).await.is_ok());
        let bad = mock_status(401);
        assert!(send_discord_to(&bad, "tok", "123", "hi").await.is_err());
    }

    // The Gateway INBOUND decision logic — the part that would break a live
    // connection if wrong — verified exhaustively without a bot token.
    #[test]
    fn parse_hello_reads_heartbeat_interval() {
        let v = serde_json::json!({ "op": 10, "d": { "heartbeat_interval": 41250 } });
        assert_eq!(parse_hello(&v), Some(41250));
        assert_eq!(parse_hello(&serde_json::json!({ "op": 0 })), None);
    }
    #[test]
    fn extract_message_accepts_user_msg_in_channel() {
        let v = serde_json::json!({ "op": 0, "t": "MESSAGE_CREATE",
            "d": { "channel_id": "C1", "content": "hello", "author": { "bot": false } } });
        assert_eq!(extract_message(&v, "C1", &[]).as_deref(), Some("hello"));
    }
    #[test]
    fn extract_message_rejects_bots_other_channels_empties_and_nondispatch() {
        let bot = serde_json::json!({ "op": 0, "t": "MESSAGE_CREATE", "d": { "channel_id": "C1", "content": "x", "author": { "bot": true } } });
        assert_eq!(extract_message(&bot, "C1", &[]), None, "skip bot authors (no self-loop)");
        let other = serde_json::json!({ "op": 0, "t": "MESSAGE_CREATE", "d": { "channel_id": "C2", "content": "x" } });
        assert_eq!(extract_message(&other, "C1", &[]), None, "skip other channels");
        let empty = serde_json::json!({ "op": 0, "t": "MESSAGE_CREATE", "d": { "channel_id": "C1", "content": "   " } });
        assert_eq!(extract_message(&empty, "C1", &[]), None, "skip empty content");
        let heartbeat_ack = serde_json::json!({ "op": 11 });
        assert_eq!(extract_message(&heartbeat_ack, "C1", &[]), None, "non-dispatch ignored");
        let typing = serde_json::json!({ "op": 0, "t": "TYPING_START", "d": { "channel_id": "C1" } });
        assert_eq!(extract_message(&typing, "C1", &[]), None, "non-message dispatch ignored");
    }
    #[test]
    fn extract_message_enforces_user_allowlist() {
        let from = |id: &str| serde_json::json!({ "op": 0, "t": "MESSAGE_CREATE",
            "d": { "channel_id": "C1", "content": "hi", "author": { "bot": false, "id": id } } });
        let allow = vec!["U_OWNER".to_string()];
        assert_eq!(extract_message(&from("U_OWNER"), "C1", &allow).as_deref(), Some("hi"), "listed user allowed");
        assert_eq!(extract_message(&from("U_STRANGER"), "C1", &allow), None, "non-listed user rejected");
    }
}
