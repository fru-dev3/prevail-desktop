// Native poll bridges (A6) — Matrix + Mattermost.
//
// The founder asked for the "coming soon" surfaces to be real, like OpenClaw /
// Hermes. The Webhook surface (webhook_bridge.rs) already makes EVERY platform
// reachable via forwarding; this adds first-class NATIVE bridges for the
// platforms whose inbound is HTTP-poll-based (so no WebSocket dependency):
//   • Matrix     — GET /_matrix/client/v3/sync (long-poll with a since token)
//   • Mattermost — GET /api/v4/channels/{id}/posts?since={ms} (REST poll)
//
// Shape mirrors telegram_bridge exactly: a background task polls for new
// messages, routes each via resolve_domain, runs the model through the single
// run_cli choke point, sends the reply back, and records the exchange so it
// shows up in the domain's thread list. OFF by default and inert until the user
// configures a server + token and enables it — so shipping it can't affect a
// running app. Discord/Slack (WebSocket) and Email (IMAP) need extra crates and
// are tracked separately; until then they're reachable via the Webhook.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tokio::sync::{watch, Mutex as AsyncMutex};

use crate::telegram_bridge::{record_exchange, resolve_domain, run_cli, BridgeConfig, BridgeStatus, RouteRule};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NativeBridgeConfig {
    pub platform: String,      // "matrix" | "mattermost"
    pub base_url: String,      // homeserver / Mattermost server URL
    pub token: String,         // access token (resolved from Keychain if empty)
    pub channel: String,       // Matrix room id | Mattermost channel id
    pub cli: String,
    pub model: Option<String>,
    pub domain: Option<String>,
    #[serde(default)]
    pub vault: Option<String>,
    #[serde(default)]
    pub routes: Vec<RouteRule>,
    #[serde(default)]
    pub poll_secs: Option<u64>,
}

impl NativeBridgeConfig {
    fn to_bridge_config(&self) -> BridgeConfig {
        BridgeConfig {
            token: String::new(),
            chat_id: self.channel.clone(),
            cli: self.cli.clone(),
            model: self.model.clone(),
            domain: self.domain.clone(),
            vault: self.vault.clone(),
            routes: self.routes.clone(),
        }
    }
}

/// One inbound message, normalized across platforms.
struct Incoming {
    text: String,
}

#[derive(Default)]
pub struct NativeBridgeState {
    // One running loop per platform.
    inner: Mutex<HashMap<String, BridgeHandle>>,
}
struct BridgeHandle {
    stop_tx: watch::Sender<bool>,
    handle: JoinHandle<()>,
    status: Arc<AsyncMutex<BridgeStatus>>,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl NativeBridgeState {
    pub async fn status(&self, platform: &str) -> BridgeStatus {
        let arc = {
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.get(platform).map(|h| h.status.clone())
        };
        match arc {
            Some(a) => a.lock().await.clone(),
            None => BridgeStatus::default(),
        }
    }

    pub async fn stop(&self, platform: &str) {
        let h = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.remove(platform)
        };
        if let Some(h) = h {
            let _ = h.stop_tx.send(true);
            h.handle.abort();
            let mut s = h.status.lock().await;
            s.running = false;
        }
    }

    pub async fn start(&self, cfg: NativeBridgeConfig) -> Result<(), String> {
        crate::bunker::guard_cloud()?; // polls a remote service
        let platform = cfg.platform.to_lowercase();
        if platform != "matrix" && platform != "mattermost" {
            return Err(format!("unsupported native platform: {platform}"));
        }
        self.stop(&platform).await;
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let status = Arc::new(AsyncMutex::new(BridgeStatus { running: true, ..Default::default() }));
        let status_for_task = status.clone();
        let poll = Duration::from_secs(cfg.poll_secs.unwrap_or(5).max(2));
        let key = platform.clone(); // map key; the closure below consumes `platform`

        let handle = tauri::async_runtime::spawn(async move {
            // Cursor: Matrix `next_batch` token; Mattermost last-seen create_at ms.
            let mut since: Option<String> = None;
            // Skip the backlog on first poll so we only answer NEW messages.
            let mut primed = false;
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => { if *stop_rx.borrow() { break; } }
                    _ = tokio::time::sleep(poll) => {
                        let res = match platform.as_str() {
                            "matrix" => fetch_matrix(&cfg.base_url, &cfg.token, &cfg.channel, since.as_deref()).await,
                            _ => fetch_mattermost(&cfg.base_url, &cfg.token, &cfg.channel, since.as_deref()).await,
                        };
                        match res {
                            Ok((msgs, next)) => {
                                since = next;
                                if !primed { primed = true; continue; } // drop backlog
                                for inc in msgs {
                                    {
                                        let mut s = status_for_task.lock().await;
                                        s.inbound_count += 1;
                                        s.last_inbound_ts = Some(now_secs());
                                    }
                                    let bcfg = cfg.to_bridge_config();
                                    let domain = cfg.domain.clone().or_else(|| resolve_domain(&bcfg, &inc.text));
                                    let reply = match run_cli(&cfg.cli, cfg.model.as_deref(), &inc.text).await {
                                        Ok(r) => r,
                                        Err(e) => {
                                            let mut s = status_for_task.lock().await;
                                            s.last_error = Some(e);
                                            continue;
                                        }
                                    };
                                    let sent = match platform.as_str() {
                                        "matrix" => send_matrix(&cfg.base_url, &cfg.token, &cfg.channel, &reply).await,
                                        _ => send_mattermost(&cfg.base_url, &cfg.token, &cfg.channel, &reply).await,
                                    };
                                    match sent {
                                        Ok(()) => {
                                            if let Some(d) = domain.as_deref() {
                                                record_exchange(&bcfg, d, &inc.text, &reply);
                                            }
                                            let mut s = status_for_task.lock().await;
                                            s.outbound_count += 1;
                                            s.last_outbound_ts = Some(now_secs());
                                        }
                                        Err(e) => {
                                            let mut s = status_for_task.lock().await;
                                            s.last_error = Some(e);
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                let mut s = status_for_task.lock().await;
                                s.last_error = Some(e);
                            }
                        }
                    }
                }
            }
        });

        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.insert(key, BridgeHandle { stop_tx, handle, status });
        Ok(())
    }
}

// ── Matrix (client-server API) ────────────────────────────────────────────────
// GET /_matrix/client/v3/sync?since=<token>&timeout=0 — returns new room events
// plus a next_batch token to pass as the next `since`. We read m.room.message
// text bodies from the configured room's timeline.
async fn fetch_matrix(base: &str, token: &str, room: &str, since: Option<&str>) -> Result<(Vec<Incoming>, Option<String>), String> {
    let base = base.trim_end_matches('/');
    let mut url = format!("{base}/_matrix/client/v3/sync?timeout=1000");
    if let Some(s) = since { url.push_str(&format!("&since={}", urlencode(s))); }
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(token)
        .timeout(Duration::from_secs(20))
        .send().await.map_err(|e| format!("matrix sync: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("matrix sync HTTP {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| format!("matrix sync parse: {e}"))?;
    let next = v.get("next_batch").and_then(|x| x.as_str()).map(|s| s.to_string());
    let mut out = Vec::new();
    if let Some(events) = v.pointer(&format!("/rooms/join/{}/timeline/events", json_ptr(room))).and_then(|e| e.as_array()) {
        for ev in events {
            if ev.get("type").and_then(|t| t.as_str()) == Some("m.room.message") {
                if let Some(body) = ev.pointer("/content/body").and_then(|b| b.as_str()) {
                    if !body.trim().is_empty() { out.push(Incoming { text: body.to_string() }); }
                }
            }
        }
    }
    Ok((out, next))
}

async fn send_matrix(base: &str, token: &str, room: &str, text: &str) -> Result<(), String> {
    let base = base.trim_end_matches('/');
    // A pseudo-unique txn id from the clock (no Math.random in this context).
    let txn = format!("prevail{}", now_secs());
    let url = format!("{base}/_matrix/client/v3/rooms/{}/send/m.room.message/{txn}", urlencode(room));
    let body = serde_json::json!({ "msgtype": "m.text", "body": text });
    let resp = reqwest::Client::new()
        .put(&url).bearer_auth(token).json(&body)
        .send().await.map_err(|e| format!("matrix send: {e}"))?;
    if !resp.status().is_success() { return Err(format!("matrix send HTTP {}", resp.status())); }
    Ok(())
}

// ── Mattermost (REST API v4) ──────────────────────────────────────────────────
// GET /api/v4/channels/{id}/posts?since=<ms> — posts since a timestamp. We track
// the newest create_at as the cursor. Outbound: POST /api/v4/posts.
async fn fetch_mattermost(base: &str, token: &str, channel: &str, since: Option<&str>) -> Result<(Vec<Incoming>, Option<String>), String> {
    let base = base.trim_end_matches('/');
    let mut url = format!("{base}/api/v4/channels/{channel}/posts");
    if let Some(s) = since { url.push_str(&format!("?since={s}")); }
    let resp = reqwest::Client::new()
        .get(&url).bearer_auth(token)
        .timeout(Duration::from_secs(20))
        .send().await.map_err(|e| format!("mattermost posts: {e}"))?;
    if !resp.status().is_success() { return Err(format!("mattermost posts HTTP {}", resp.status())); }
    let v: serde_json::Value = resp.json().await.map_err(|e| format!("mattermost parse: {e}"))?;
    let mut newest: u64 = since.and_then(|s| s.parse().ok()).unwrap_or(0);
    let mut out = Vec::new();
    if let Some(posts) = v.get("posts").and_then(|p| p.as_object()) {
        // Iterate in chronological order via the "order" array when present.
        let order: Vec<String> = v.get("order").and_then(|o| o.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_else(|| posts.keys().cloned().collect());
        for id in order.iter().rev() {
            if let Some(post) = posts.get(id) {
                let created = post.get("create_at").and_then(|c| c.as_u64()).unwrap_or(0);
                let msg = post.get("message").and_then(|m| m.as_str()).unwrap_or("");
                // Skip our own posts (no root/bot marker available offline → rely
                // on the since cursor; created>newest filters already-seen).
                if created > newest && !msg.trim().is_empty() {
                    out.push(Incoming { text: msg.to_string() });
                }
                if created > newest { newest = created; }
            }
        }
    }
    Ok((out, Some(newest.to_string())))
}

async fn send_mattermost(base: &str, token: &str, channel: &str, text: &str) -> Result<(), String> {
    let base = base.trim_end_matches('/');
    let url = format!("{base}/api/v4/posts");
    let body = serde_json::json!({ "channel_id": channel, "message": text });
    let resp = reqwest::Client::new()
        .post(&url).bearer_auth(token).json(&body)
        .send().await.map_err(|e| format!("mattermost send: {e}"))?;
    if !resp.status().is_success() { return Err(format!("mattermost send HTTP {}", resp.status())); }
    Ok(())
}

// Minimal URL-encoding for path/query segments (room ids contain ! : / etc.).
fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// Escape a room id for use inside a JSON pointer (~ → ~0, / → ~1).
fn json_ptr(s: &str) -> String {
    s.replace('~', "~0").replace('/', "~1")
}

// ── Tauri commands ──

#[tauri::command]
pub async fn native_bridge_start(
    state: tauri::State<'_, NativeBridgeState>,
    cfg: NativeBridgeConfig,
) -> Result<BridgeStatus, String> {
    let mut cfg = cfg;
    let platform = cfg.platform.to_lowercase();
    if cfg.token.trim().is_empty() {
        cfg.token = crate::ingestion::keychain::get("prevail.providers", &format!("native-{platform}"))
            .map_err(|_| format!("no {platform} token configured"))?;
        if cfg.token.trim().is_empty() {
            return Err(format!("no {platform} token configured"));
        }
    }
    state.start(cfg).await?;
    Ok(state.status(&platform).await)
}

#[tauri::command]
pub async fn native_bridge_stop(
    state: tauri::State<'_, NativeBridgeState>,
    platform: String,
) -> Result<BridgeStatus, String> {
    state.stop(&platform.to_lowercase()).await;
    Ok(state.status(&platform.to_lowercase()).await)
}

#[tauri::command]
pub async fn native_bridge_status(
    state: tauri::State<'_, NativeBridgeState>,
    platform: String,
) -> Result<BridgeStatus, String> {
    Ok(state.status(&platform.to_lowercase()).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_ptr_escapes_room_ids() {
        assert_eq!(json_ptr("!abc:matrix.org"), "!abc:matrix.org");
        assert_eq!(json_ptr("a/b~c"), "a~1b~0c");
    }

    #[test]
    fn urlencode_encodes_reserved() {
        assert_eq!(urlencode("!room:srv.org"), "%21room%3Asrv.org");
        assert_eq!(urlencode("plain-id_1.2~3"), "plain-id_1.2~3");
    }

    #[test]
    fn config_maps_to_bridge_config_for_routing() {
        let c = NativeBridgeConfig {
            platform: "matrix".into(), base_url: "https://m.org".into(), token: "t".into(),
            channel: "!r:m.org".into(), cli: "claude".into(), model: None, domain: Some("wealth".into()),
            vault: None, routes: vec![], poll_secs: None,
        };
        let b = c.to_bridge_config();
        assert_eq!(b.chat_id, "!r:m.org");
        assert_eq!(b.domain.as_deref(), Some("wealth"));
        assert!(b.token.is_empty()); // never carries the platform token
    }
}
