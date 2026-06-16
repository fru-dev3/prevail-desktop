// Slack native bridge (A6) — Socket Mode.
//
// Socket Mode avoids needing a public URL (which fits a local desktop app): the
// app opens an OUTBOUND WebSocket. Flow: POST apps.connections.open with the
// app-level token (xapp-) → returns a wss URL → connect → receive `hello`, then
// `events_api` envelopes carrying message events. Each envelope must be ACKed by
// echoing its envelope_id. Replies go via chat.postMessage with the bot token
// (xoxb-). Bot-authored messages are skipped so the council never loops.
//
// Off by default; needs both tokens (app + bot) and a channel id. Routing/model/
// recording reuse the Telegram path. First implementation — verify with real
// tokens before relying on it.

use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tokio::sync::{watch, Mutex as AsyncMutex};
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::telegram_bridge::{record_exchange, resolve_domain, run_cli, BridgeConfig, BridgeStatus, RouteRule};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SlackConfig {
    pub app_token: String, // xapp-… opens the socket (Keychain if empty)
    pub bot_token: String, // xoxb-… posts replies (Keychain if empty)
    pub channel: String,   // only handle + reply in this channel
    pub cli: String,
    pub model: Option<String>,
    pub domain: Option<String>,
    #[serde(default)]
    pub vault: Option<String>,
    #[serde(default)]
    pub routes: Vec<RouteRule>,
}

#[derive(Default)]
pub struct SlackState {
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

impl SlackState {
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
    pub async fn start(&self, cfg: SlackConfig) -> Result<(), String> {
        crate::bunker::guard_cloud()?;
        self.stop().await;
        let (stop_tx, stop_rx) = watch::channel(false);
        let status = Arc::new(AsyncMutex::new(BridgeStatus { running: true, ..Default::default() }));
        let status_task = status.clone();
        let handle = tauri::async_runtime::spawn(async move {
            if let Err(e) = run_socket(cfg, stop_rx, status_task.clone()).await {
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

fn bridge_cfg(cfg: &SlackConfig) -> BridgeConfig {
    BridgeConfig {
        token: String::new(), chat_id: cfg.channel.clone(), cli: cfg.cli.clone(),
        model: cfg.model.clone(), domain: cfg.domain.clone(), vault: cfg.vault.clone(), routes: cfg.routes.clone(),
    }
}

async fn open_socket_url(app_token: &str) -> Result<String, String> {
    let resp = reqwest::Client::new()
        .post("https://slack.com/api/apps.connections.open")
        .bearer_auth(app_token)
        .send().await.map_err(|e| format!("slack open: {e}"))?;
    let v: serde_json::Value = resp.json().await.map_err(|e| format!("slack open parse: {e}"))?;
    if v.get("ok").and_then(|o| o.as_bool()) != Some(true) {
        return Err(format!("slack apps.connections.open: {}", v.get("error").and_then(|e| e.as_str()).unwrap_or("not ok")));
    }
    v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()).ok_or_else(|| "slack: no socket url".into())
}

async fn run_socket(cfg: SlackConfig, mut stop_rx: watch::Receiver<bool>, status: Arc<AsyncMutex<BridgeStatus>>) -> Result<(), String> {
    let url = open_socket_url(&cfg.app_token).await?;
    let (ws, _) = tokio_tungstenite::connect_async(&url).await.map_err(|e| format!("slack connect: {e}"))?;
    let (mut write, mut read) = ws.split();

    loop {
        tokio::select! {
            _ = stop_rx.changed() => { if *stop_rx.borrow() { return Ok(()); } }
            frame = read.next() => {
                let msg = match frame {
                    Some(Ok(WsMessage::Text(t))) => t,
                    Some(Ok(WsMessage::Ping(p))) => { let _ = write.send(WsMessage::Pong(p)).await; continue; }
                    Some(Ok(WsMessage::Close(_))) | None => return Err("slack: socket closed".into()),
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => return Err(format!("slack read: {e}")),
                };
                let v: serde_json::Value = match serde_json::from_str(&msg) { Ok(v) => v, Err(_) => continue };
                let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if kind == "hello" || kind == "disconnect" { continue; }
                // ACK every envelope immediately (Slack requires it within seconds).
                if let Some(env) = v.get("envelope_id").and_then(|e| e.as_str()) {
                    let _ = write.send(WsMessage::Text(serde_json::json!({ "envelope_id": env }).to_string())).await;
                }
                if kind != "events_api" { continue; }
                let event = match v.pointer("/payload/event") { Some(e) => e, None => continue };
                if event.get("type").and_then(|t| t.as_str()) != Some("message") { continue; }
                // Skip bot messages, edits, and other channels.
                if event.get("bot_id").is_some() || event.get("subtype").is_some() { continue; }
                if event.get("channel").and_then(|c| c.as_str()) != Some(cfg.channel.as_str()) { continue; }
                let text = event.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
                if text.trim().is_empty() { continue; }

                { let mut s = status.lock().await; s.inbound_count += 1; s.last_inbound_ts = Some(now_secs()); }
                let bcfg = bridge_cfg(&cfg);
                let domain = cfg.domain.clone().or_else(|| resolve_domain(&bcfg, &text));
                let reply = match run_cli(&cfg.cli, cfg.model.as_deref(), &text).await {
                    Ok(r) => r,
                    Err(e) => { status.lock().await.last_error = Some(e); continue; }
                };
                match post_message(&cfg.bot_token, &cfg.channel, &reply).await {
                    Ok(()) => {
                        if let Some(dm) = domain.as_deref() { record_exchange(&bcfg, dm, &text, &reply); }
                        let mut s = status.lock().await; s.outbound_count += 1; s.last_outbound_ts = Some(now_secs());
                    }
                    Err(e) => { status.lock().await.last_error = Some(e); }
                }
            }
        }
    }
}

async fn post_message(bot_token: &str, channel: &str, text: &str) -> Result<(), String> {
    post_message_to("https://slack.com/api/chat.postMessage", bot_token, channel, text).await
}

// URL is a parameter so a test can point it at a mock server.
async fn post_message_to(url: &str, bot_token: &str, channel: &str, text: &str) -> Result<(), String> {
    let resp = reqwest::Client::new()
        .post(url)
        .bearer_auth(bot_token)
        .json(&serde_json::json!({ "channel": channel, "text": text }))
        .send().await.map_err(|e| format!("slack post: {e}"))?;
    let v: serde_json::Value = resp.json().await.map_err(|e| format!("slack post parse: {e}"))?;
    if v.get("ok").and_then(|o| o.as_bool()) != Some(true) {
        return Err(format!("slack chat.postMessage: {}", v.get("error").and_then(|e| e.as_str()).unwrap_or("not ok")));
    }
    Ok(())
}

#[tauri::command]
pub async fn slack_bridge_start(state: tauri::State<'_, SlackState>, cfg: SlackConfig) -> Result<BridgeStatus, String> {
    let mut cfg = cfg;
    if cfg.app_token.trim().is_empty() {
        cfg.app_token = crate::ingestion::keychain::get("prevail.providers", "native-slack-app").unwrap_or_default();
    }
    if cfg.bot_token.trim().is_empty() {
        cfg.bot_token = crate::ingestion::keychain::get("prevail.providers", "native-slack").unwrap_or_default();
    }
    if cfg.app_token.trim().is_empty() || cfg.bot_token.trim().is_empty() {
        return Err("Slack needs both an app-level token (xapp-) and a bot token (xoxb-)".into());
    }
    state.start(cfg).await?;
    Ok(state.status().await)
}
#[tauri::command]
pub async fn slack_bridge_stop(state: tauri::State<'_, SlackState>) -> Result<BridgeStatus, String> {
    state.stop().await; Ok(state.status().await)
}
#[tauri::command]
pub async fn slack_bridge_status(state: tauri::State<'_, SlackState>) -> Result<BridgeStatus, String> {
    Ok(state.status().await)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bridge_cfg_drops_tokens() {
        let c = SlackConfig { app_token: "xapp".into(), bot_token: "xoxb".into(), channel: "C1".into(), cli: "claude".into(), model: None, domain: Some("career".into()), vault: None, routes: vec![] };
        let b = bridge_cfg(&c);
        assert!(b.token.is_empty());
        assert_eq!(b.chat_id, "C1");
        assert_eq!(b.domain.as_deref(), Some("career"));
    }

    fn mock(body: &str) -> String {
        let body = body.to_string();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        std::thread::spawn(move || { if let Ok(req) = server.recv() { let _ = req.respond(tiny_http::Response::from_string(body)); } });
        format!("http://127.0.0.1:{port}")
    }
    // Slack returns 200 with {ok:false} on failure, so status alone isn't enough —
    // verify post_message reads the `ok` field (round-trip against a mock).
    #[tokio::test]
    async fn post_message_honors_the_ok_field() {
        let good = mock(r#"{"ok":true}"#);
        assert!(post_message_to(&good, "xoxb", "C1", "hi").await.is_ok());
        let bad = mock(r#"{"ok":false,"error":"channel_not_found"}"#);
        let e = post_message_to(&bad, "xoxb", "C1", "hi").await.unwrap_err();
        assert!(e.contains("channel_not_found"));
    }
}
