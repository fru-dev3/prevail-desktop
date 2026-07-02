// WebUI bridge server — serve the SAME frontend bundle to a browser and
// proxy its IPC to the running desktop window. No duplicate UI: the browser
// loads the embedded assets, and every invoke()/event flows over HTTP+SSE to
// the host window, which executes commands via the real Tauri runtime
// (webview-proxy). Reach it remotely via Tailscale/Cloudflare.
//
// Flow:
//   browser  --POST /api/invoke {cmd,args}-->  this server
//   server   --emit "webui:invoke" {id,cmd,args}-->  host window
//   host     runs invoke(cmd,args), then  invoke("webui_resolve",{id,...})
//   server   <--resolve--  unblocks the request, responds {data|error}
//   events:  host forwards Tauri events via invoke("webui_event",{event,payload})
//            -> broadcast to all /api/events SSE clients.

use std::collections::HashMap;
use std::io::Read;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Emitter;

// Deny-by-default allowlist of commands a REMOTE web client may invoke. Only
// the read + chat + thread-persistence surface needed to USE Prevail — never
// secrets (provider_key_*), arbitrary file I/O (read/write_text_file, read_file),
// destructive/admin ops (app_uninstall, webui_start/stop, *_vault_*, ingestion_*,
// telegram_*), or the host→server callbacks (webui_resolve/event).
const WEBUI_ALLOWED: &[&str] = &[
    // vault / domains / skills (read)
    "scan_vault", "engine_domains", "domain_context", "read_domain_prompts", "scan_skills", "skill_create", "read_skill",
    // vault bootstrap — let the browser inherit the desktop's current vault
    // (skip onboarding) and seed the bundled sample if the user asks. These
    // read/return paths only; they don't expose arbitrary file I/O. (B5/B6)
    "bootstrap_vault", "import_sample_vault",
    // chat
    "chat_send", "engine_chat", "abort_sessions", "detect_clis",
    // threads
    "list_threads", "load_thread", "save_thread", "rename_thread", "delete_thread", "save_session",
    // memory / profile (read)
    "read_user_md", "read_memory_md",
    // self-learning ledger
    "intent_append", "intents_read", "journal_append", "usage_append", "usage_summary",
    // usage analytics — domain-scoped roll-up for the per-domain Usage tab (read)
    "usage_summary_domain",
    // demo/production mode — read-only over the web so the browser shows the
    // demo badge. Switching mode (a write) stays desktop-only.
    "engine_appmode_get",
    "decision_append", "decisions_read", "decision_feedback",
    // proactive surface + per-domain tasks/goals (read vault + model + checklist)
    "domain_surface", "tasks_read", "tasks_set", "tasks_add", "read_memory_md",
    // scores (read)
    "engine_score", "engine_score_all", "engine_score_history", "engine_manifest_get",
    // benchmark (read)
    "benchmark_runs", "benchmark_run_detail", "benchmark_questions", "benchmark_matrix",
    // status
    "webui_status",
    // cross-device UI settings (theme/palette) — read + write so the browser
    // both inherits the desktop look and can change it. Not secrets.
    "ui_settings_get", "ui_settings_set",
    // cross-device UI prefs (pins, model picks, per-domain toggles)
    "ui_prefs_get", "ui_prefs_set",
    // Bunker Mode: read-only status for the ribbon/card. bunker_set is
    // deliberately NOT exposed — a remote browser must never be able to
    // disable the local-only trust guarantee.
    "bunker_status",
];

#[derive(Default)]
pub struct WebuiState {
    inner: Mutex<Inner>,
}
#[derive(Default)]
struct Inner {
    running: bool,
    port: u16,
    token: String,
    user: String,
    pass: String,
    next_id: Arc<AtomicU64>,
    pending: Arc<Mutex<HashMap<u64, Sender<InvokeOut>>>>,
    sse: Arc<Mutex<Vec<Sender<String>>>>,
    stop: Option<Arc<std::net::TcpListener>>, // kept to unblock accept on stop
}

#[derive(Clone, Serialize)]
pub struct WebuiStatus {
    pub running: bool,
    pub port: u16,
    pub user: String,
}

#[derive(Clone)]
struct InvokeOut {
    ok: bool,
    data: serde_json::Value,
    error: String,
}

// 32 random bytes from the OS CSPRNG, hex-encoded. Falls back to a SHA256 of
// high-res time only if /dev/urandom is unreadable (extremely unlikely on macOS).
fn random_token() -> String {
    use std::io::Read;
    let mut buf = [0u8; 32];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        if f.read_exact(&mut buf).is_ok() {
            return buf.iter().map(|b| format!("{b:02x}")).collect();
        }
    }
    let mut h = Sha256::new();
    h.update(format!("{:?}", std::time::SystemTime::now()).as_bytes());
    format!("{:x}", h.finalize())
}

// Constant-time string comparison (avoids timing oracles on the token).
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

#[derive(Deserialize)]
struct InvokeReq {
    cmd: String,
    #[serde(default)]
    args: serde_json::Value,
}

impl WebuiState {
    pub fn status(&self) -> WebuiStatus {
        let i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        WebuiStatus { running: i.running, port: i.port, user: i.user.clone() }
    }

    pub fn stop(&self) {
        let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        i.running = false;
        i.stop = None; // dropping the listener Arc lets the accept loop error out
    }

    // Resolve a pending browser invoke with the host window's result.
    fn resolve(&self, id: u64, out: InvokeOut) {
        let pending = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).pending.clone() };
        let tx = pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        if let Some(tx) = tx {
            let _ = tx.send(out);
        }
    }

    // Broadcast a host event to every connected SSE client.
    pub fn broadcast(&self, event: &str, payload: &serde_json::Value) {
        let sse = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).sse.clone() };
        let frame = format!(
            "data: {}\n\n",
            serde_json::json!({ "event": event, "payload": payload })
        );
        let mut clients = sse.lock().unwrap_or_else(|e| e.into_inner());
        clients.retain(|tx| tx.send(frame.clone()).is_ok());
    }

    pub fn start(&self, app: tauri::AppHandle, port: u16, user: String, pass: String) -> Result<(), String> {
        self.stop();
        // Random per-session token (NOT derived from the password). Login
        // exchanges user/pass for this token; it never leaves the device except
        // to the authenticated client.
        let token = random_token();
        // Bind to loopback only. Remote access is via Tailscale/SSH tunnel —
        // never expose the bridge on all interfaces.
        let listener = std::net::TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("bind 127.0.0.1:{port}: {e}"))?;
        let server = tiny_http::Server::from_listener(listener.try_clone().map_err(|e| e.to_string())?, None)
            .map_err(|e| e.to_string())?;
        {
            let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            i.running = true;
            i.port = port;
            i.token = token.clone();
            i.user = user.clone();
            i.pass = pass.clone();
            i.stop = Some(Arc::new(listener));
        }
        let next_id = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).next_id.clone() };
        let pending = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).pending.clone() };
        let sse = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).sse.clone() };

        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                handle(&app, req, &token, &user, &pass, &next_id, &pending, &sse);
            }
        });
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
fn handle(
    app: &tauri::AppHandle,
    mut req: tiny_http::Request,
    token: &str,
    user: &str,
    pass: &str,
    next_id: &Arc<AtomicU64>,
    pending: &Arc<Mutex<HashMap<u64, Sender<InvokeOut>>>>,
    sse: &Arc<Mutex<Vec<Sender<String>>>>,
) {
    let method = req.method().clone();
    let url = req.url().to_string();
    let path = url.split('?').next().unwrap_or("/").to_string();

    let authed = || -> bool {
        // Header bearer OR ?token= query (for EventSource which can't set headers).
        // Constant-time comparison against the random session token.
        if let Some(h) = req.headers().iter().find(|h| h.field.equiv("Authorization")) {
            if ct_eq(h.value.as_str(), token) { return true; }
        }
        url.split('?').nth(1).map(|q| q.split('&').filter_map(|kv| kv.strip_prefix("token=")).any(|t| ct_eq(t, token))).unwrap_or(false)
    };

    // ── Login ──
    if path == "/api/login" && method == tiny_http::Method::Post {
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let creds: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
        // Constant-time on both fields so login can't be probed via timing.
        let ok = ct_eq(creds.get("user").and_then(|v| v.as_str()).unwrap_or(""), user)
            && ct_eq(creds.get("pass").and_then(|v| v.as_str()).unwrap_or(""), pass);
        let (code, payload) = if ok {
            (200, serde_json::json!({ "token": token }))
        } else {
            (401, serde_json::json!({ "error": "invalid credentials" }))
        };
        let _ = req.respond(json_response(code, &payload));
        return;
    }

    // Everything below requires auth.
    if path.starts_with("/api/") && !authed() {
        let _ = req.respond(json_response(401, &serde_json::json!({ "error": "unauthorized" })));
        return;
    }

    // ── Invoke proxy ──
    if path == "/api/invoke" && method == tiny_http::Method::Post {
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let parsed: Result<InvokeReq, _> = serde_json::from_str(&body);
        let r = match parsed {
            Ok(r) => r,
            Err(e) => { let _ = req.respond(json_response(400, &serde_json::json!({ "error": format!("bad request: {e}") }))); return; }
        };
        // Deny-by-default: only allowlisted commands may be proxied from the web.
        if !WEBUI_ALLOWED.contains(&r.cmd.as_str()) {
            let _ = req.respond(json_response(403, &serde_json::json!({ "error": format!("command '{}' is not permitted over the WebUI", r.cmd) })));
            return;
        }
        let id = next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx): (Sender<InvokeOut>, Receiver<InvokeOut>) = channel();
        pending.lock().unwrap_or_else(|e| e.into_inner()).insert(id, tx);
        let _ = app.emit_to("main", "webui:invoke", serde_json::json!({ "id": id, "cmd": r.cmd, "args": r.args }));
        let out = rx.recv_timeout(Duration::from_secs(310)).unwrap_or(InvokeOut { ok: false, data: serde_json::Value::Null, error: "host timeout".into() });
        pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        let payload = if out.ok { serde_json::json!({ "data": out.data }) } else { serde_json::json!({ "error": out.error }) };
        let _ = req.respond(json_response(200, &payload));
        return;
    }

    // ── Emit (browser → host) ── disabled: a remote client must not be able to
    // fire arbitrary Tauri events into the host. The web app drives everything
    // through allowlisted /api/invoke instead.
    if path == "/api/emit" {
        let _ = req.respond(json_response(403, &serde_json::json!({ "error": "emit is not permitted over the WebUI" })));
        return;
    }

    // ── SSE events ──
    if path == "/api/events" {
        let (tx, rx) = channel::<String>();
        sse.lock().unwrap_or_else(|e| e.into_inner()).push(tx);
        let reader = SseReader { rx, buf: Vec::new() };
        let response = tiny_http::Response::empty(200)
            .with_header(header("Content-Type", "text/event-stream"))
            .with_header(header("Cache-Control", "no-cache"))
            .with_header(header("Connection", "keep-alive"))
            .with_data(reader, None);
        let _ = req.respond(response);
        return;
    }


    // ── Static assets (the embedded frontend bundle) ──
    let asset_path = if path == "/" { "index.html".to_string() } else { path.trim_start_matches('/').to_string() };
    match app.asset_resolver().get(format!("/{asset_path}")) {
        Some(asset) => {
            let resp = tiny_http::Response::from_data(asset.bytes).with_header(header("Content-Type", &asset.mime_type));
            let _ = req.respond(resp);
        }
        None => {
            // SPA fallback → index.html.
            if let Some(idx) = app.asset_resolver().get("/index.html".into()) {
                let _ = req.respond(tiny_http::Response::from_data(idx.bytes).with_header(header("Content-Type", "text/html")));
            } else {
                let _ = req.respond(json_response(404, &serde_json::json!({ "error": "not found" })));
            }
        }
    }
}

fn header(k: &str, v: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}
fn json_response(code: u16, v: &serde_json::Value) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_string(v.to_string()).with_status_code(code).with_header(header("Content-Type", "application/json"))
}

// Blocking SSE body: tiny_http calls read() repeatedly; we pull formatted
// frames from the channel. A periodic keepalive keeps proxies from closing.
struct SseReader {
    rx: Receiver<String>,
    buf: Vec<u8>,
}
impl Read for SseReader {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if self.buf.is_empty() {
            match self.rx.recv_timeout(Duration::from_secs(20)) {
                Ok(frame) => self.buf.extend_from_slice(frame.as_bytes()),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => self.buf.extend_from_slice(b": keepalive\n\n"),
                Err(_) => return Ok(0), // sender dropped → close
            }
        }
        let n = out.len().min(self.buf.len());
        out[..n].copy_from_slice(&self.buf[..n]);
        self.buf.drain(..n);
        Ok(n)
    }
}

// ── Tauri commands ──

#[tauri::command]
pub fn webui_start(app: tauri::AppHandle, state: tauri::State<'_, WebuiState>, port: u16, user: String, pass: String) -> Result<WebuiStatus, String> {
    state.start(app, port, user, pass)?;
    Ok(state.status())
}
#[tauri::command]
pub fn webui_stop(state: tauri::State<'_, WebuiState>) -> Result<WebuiStatus, String> {
    state.stop();
    Ok(state.status())
}
#[tauri::command]
pub fn webui_status(state: tauri::State<'_, WebuiState>) -> WebuiStatus {
    state.status()
}
// Host window → server: deliver the result of a proxied invoke.
#[tauri::command]
pub fn webui_resolve(state: tauri::State<'_, WebuiState>, id: u64, ok: bool, #[allow(unused)] data: Option<serde_json::Value>, error: Option<String>) {
    state.resolve(id, InvokeOut { ok, data: data.unwrap_or(serde_json::Value::Null), error: error.unwrap_or_default() });
}
// Host window → server: forward a Tauri event to web clients.
#[tauri::command]
pub fn webui_event(state: tauri::State<'_, WebuiState>, event: String, payload: serde_json::Value) {
    state.broadcast(&event, &payload);
}
