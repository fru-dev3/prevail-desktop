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

use crate::telegram_bridge::{record_exchange, resolve_domain, run_cli, BridgeConfig, BridgeStatus, RouteRule};

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
                if v.get("op").and_then(|o| o.as_u64()) == Some(10) {
                    break v.pointer("/d/heartbeat_interval").and_then(|h| h.as_u64()).unwrap_or(41250);
                }
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
                if v.get("op").and_then(|o| o.as_u64()) != Some(0) { continue; }
                if v.get("t").and_then(|t| t.as_str()) != Some("MESSAGE_CREATE") { continue; }
                let d = match v.get("d") { Some(d) => d, None => continue };
                // Ignore our own / other bots' messages and other channels.
                if d.pointer("/author/bot").and_then(|b| b.as_bool()).unwrap_or(false) { continue; }
                if d.get("channel_id").and_then(|c| c.as_str()) != Some(cfg.channel.as_str()) { continue; }
                let content = d.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string();
                if content.trim().is_empty() { continue; }

                { let mut s = status.lock().await; s.inbound_count += 1; s.last_inbound_ts = Some(now_secs()); }
                let bcfg = bridge_cfg(&cfg);
                let domain = cfg.domain.clone().or_else(|| resolve_domain(&bcfg, &content));
                let reply = match run_cli(&cfg.cli, cfg.model.as_deref(), &content).await {
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

async fn send_discord(token: &str, channel: &str, text: &str) -> Result<(), String> {
    // Discord caps a message at 2000 chars.
    let body = text.chars().take(2000).collect::<String>();
    let resp = reqwest::Client::new()
        .post(format!("{API}/channels/{channel}/messages"))
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
        let c = DiscordConfig { token: "secret".into(), channel: "123".into(), cli: "claude".into(), model: None, domain: None, vault: None, routes: vec![] };
        assert!(bridge_cfg(&c).token.is_empty());
        assert_eq!(bridge_cfg(&c).chat_id, "123");
    }
}
