// Webhook bridge — a generic, credential-free inbound surface (A6).
//
// The founder asked to make the "coming soon" gateway surfaces real, and to add
// new ones "similar to OpenClaw / Hermes." Most platform bridges (Discord,
// Slack, Signal, …) need that platform's API client AND the user's runtime
// credentials. The Webhook surface needs NEITHER: it's a loopback HTTP endpoint
// that any system (Zapier, n8n, a cron, a shell script, another of the founder's
// agents) can POST a message to and get the council's reply back. That makes it
// the one surface that is fully functional out of the box, and the foundation
// the credentialed bridges can POST into later.
//
// Shape mirrors telegram_bridge (BridgeStatus counters, keyword routing via
// resolve_domain, run_cli as the single model choke point, record_exchange so
// the conversation shows up in the domain's thread list). Transport mirrors
// webui.rs: a tiny_http server bound to 127.0.0.1 only (remote access is via the
// user's own Tailscale/SSH tunnel — never exposed on all interfaces), gated by a
// bearer secret compared in constant time.
//
//   POST /hook   Authorization: Bearer <secret>
//   body: {"message": "...", "domain": "wealth"?}
//   200: {"reply": "...", "domain": "wealth"}
//
// One bridge per app instance; start replaces a running server, stop drops the
// listener to unblock accept().

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::telegram_bridge::{run_cli, BridgeConfig, BridgeStatus};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WebhookConfig {
    pub port: u16,
    pub secret: String, // bearer token; empty → resolved from the Keychain
    pub cli: String,
    pub model: Option<String>,
    pub domain: Option<String>,
    #[serde(default)]
    pub vault: Option<String>,
    #[serde(default)]
    pub routes: Vec<crate::telegram_bridge::RouteRule>,
}

#[derive(Deserialize)]
struct HookBody {
    message: String,
    #[serde(default)]
    domain: Option<String>,
}

#[derive(Default)]
pub struct WebhookState {
    inner: Mutex<Inner>,
}
#[derive(Default)]
struct Inner {
    running: Arc<AtomicBool>,
    port: u16,
    status: Arc<Mutex<BridgeStatus>>,
    listener: Option<Arc<std::net::TcpListener>>, // dropped on stop to unblock accept
}

// Constant-time comparison so the secret can't be probed via response timing.
// Folds the length difference into the accumulator and iterates over the longer
// input (zero-padding the shorter), so it never early-returns on a length
// mismatch (O42).
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff: u32 = (a.len() ^ b.len()) as u32; // nonzero if the lengths differ
    let n = a.len().max(b.len());
    for i in 0..n {
        let x = *a.get(i).unwrap_or(&0);
        let y = *b.get(i).unwrap_or(&0);
        diff |= (x ^ y) as u32;
    }
    diff == 0
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl WebhookState {
    pub fn status(&self) -> BridgeStatus {
        let i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut s = i.status.lock().unwrap_or_else(|e| e.into_inner()).clone();
        s.running = i.running.load(Ordering::SeqCst);
        s
    }

    pub fn stop(&self) {
        let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        i.running.store(false, Ordering::SeqCst);
        i.listener = None; // drop the listener Arc → accept loop errors out
    }

    pub fn start(&self, cfg: WebhookConfig) -> Result<(), String> {
        self.stop();
        let listener = std::net::TcpListener::bind(("127.0.0.1", cfg.port))
            .map_err(|e| format!("bind 127.0.0.1:{}: {e}", cfg.port))?;
        let server = tiny_http::Server::from_listener(
            listener.try_clone().map_err(|e| e.to_string())?,
            None,
        )
        .map_err(|e| e.to_string())?;

        let running = Arc::new(AtomicBool::new(true));
        let status = Arc::new(Mutex::new(BridgeStatus { running: true, ..Default::default() }));
        {
            let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            i.running = running.clone();
            i.port = cfg.port;
            i.status = status.clone();
            i.listener = Some(Arc::new(listener));
        }

        let cfg = Arc::new(cfg);
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                if !running.load(Ordering::SeqCst) {
                    break;
                }
                handle(req, &cfg, &status);
            }
        });
        Ok(())
    }
}

fn json_response(code: u16, v: &serde_json::Value) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let h = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    tiny_http::Response::from_string(v.to_string()).with_status_code(code).with_header(h)
}

fn handle(mut req: tiny_http::Request, cfg: &WebhookConfig, status: &Arc<Mutex<BridgeStatus>>) {
    let path = req.url().split('?').next().unwrap_or("/").to_string();
    let is_post = *req.method() == tiny_http::Method::Post;

    // Health check (no secret) so a caller can confirm the surface is up.
    if path == "/health" {
        let _ = req.respond(json_response(200, &serde_json::json!({ "ok": true })));
        return;
    }
    if path != "/hook" || !is_post {
        let _ = req.respond(json_response(404, &serde_json::json!({ "error": "POST /hook" })));
        return;
    }

    // Bearer auth — constant-time against the configured secret.
    let authed = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Authorization"))
        .map(|h| {
            let v = h.value.as_str();
            let tok = v.strip_prefix("Bearer ").unwrap_or(v);
            ct_eq(tok, &cfg.secret)
        })
        .unwrap_or(false);
    if !authed {
        let _ = req.respond(json_response(401, &serde_json::json!({ "error": "unauthorized" })));
        return;
    }

    let mut body = String::new();
    let _ = req.as_reader().read_to_string(&mut body);
    let parsed: Result<HookBody, _> = serde_json::from_str(&body);
    let hook = match parsed {
        Ok(h) if !h.message.trim().is_empty() => h,
        _ => {
            let _ = req.respond(json_response(400, &serde_json::json!({ "error": "body must be {\"message\": \"...\"}" })));
            return;
        }
    };

    // Route: explicit body domain wins, else keyword routing, else default.
    let domain = hook
        .domain
        .filter(|d| !d.trim().is_empty())
        .or_else(|| {
            // Route via the same keyword logic the Telegram bridge uses.
            let probe = BridgeConfig {
                token: String::new(),
                chat_id: String::new(),
                cli: cfg.cli.clone(),
                model: cfg.model.clone(),
                domain: cfg.domain.clone(),
                vault: cfg.vault.clone(),
                routes: cfg.routes.clone(),
            };
            crate::telegram_bridge::resolve_domain(&probe, &hook.message)
        });

    // Build the same one-shot BridgeConfig the Telegram path uses so routing /
    // recording behave identically, then run the model on a blocking bridge.
    let bcfg = BridgeConfig {
        token: String::new(),
        chat_id: String::new(),
        cli: cfg.cli.clone(),
        model: cfg.model.clone(),
        domain: domain.clone(),
        vault: cfg.vault.clone(),
        routes: cfg.routes.clone(),
    };
    {
        let mut s = status.lock().unwrap_or_else(|e| e.into_inner());
        s.inbound_count += 1;
        s.last_inbound_ts = Some(now_secs());
    }
    let result = tauri::async_runtime::block_on(run_cli(&cfg.cli, cfg.model.as_deref(), &hook.message));
    match result {
        Ok(reply) => {
            if let Some(d) = domain.as_deref() {
                crate::telegram_bridge::record_exchange(&bcfg, d, &hook.message, &reply);
            }
            {
                let mut s = status.lock().unwrap_or_else(|e| e.into_inner());
                s.outbound_count += 1;
                s.last_outbound_ts = Some(now_secs());
            }
            let _ = req.respond(json_response(200, &serde_json::json!({ "reply": reply, "domain": domain })));
        }
        Err(e) => {
            {
                let mut s = status.lock().unwrap_or_else(|e| e.into_inner());
                s.last_error = Some(e.clone());
            }
            let _ = req.respond(json_response(502, &serde_json::json!({ "error": e })));
        }
    }
}

// ── Tauri commands ──

#[tauri::command]
pub async fn webhook_bridge_start(
    state: tauri::State<'_, WebhookState>,
    cfg: WebhookConfig,
) -> Result<BridgeStatus, String> {
    let mut cfg = cfg;
    // The secret is a credential → resolve from the Keychain when not inlined.
    if cfg.secret.trim().is_empty() {
        cfg.secret = crate::ingestion::keychain::get("prevail.providers", "webhook")
            .map_err(|_| "no webhook secret configured".to_string())?;
        if cfg.secret.trim().is_empty() {
            return Err("no webhook secret configured".into());
        }
    }
    state.start(cfg)?;
    Ok(state.status())
}

#[tauri::command]
pub async fn webhook_bridge_stop(state: tauri::State<'_, WebhookState>) -> Result<BridgeStatus, String> {
    state.stop();
    Ok(state.status())
}

#[tauri::command]
pub async fn webhook_bridge_status(state: tauri::State<'_, WebhookState>) -> Result<BridgeStatus, String> {
    Ok(state.status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ct_eq_matches_only_equal_strings() {
        assert!(ct_eq("abc", "abc"));
        assert!(!ct_eq("abc", "abd"));
        assert!(!ct_eq("abc", "abcd"));
        assert!(!ct_eq("", "x"));
    }

    #[test]
    fn hook_body_parses_message_and_optional_domain() {
        let h: HookBody = serde_json::from_str(r#"{"message":"hi","domain":"wealth"}"#).unwrap();
        assert_eq!(h.message, "hi");
        assert_eq!(h.domain.as_deref(), Some("wealth"));
        let h2: HookBody = serde_json::from_str(r#"{"message":"hi"}"#).unwrap();
        assert!(h2.domain.is_none());
    }
}
