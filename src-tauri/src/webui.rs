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
use tauri::{Emitter, Manager};

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

fn hash_token(user: &str, pass: &str) -> String {
    let mut h = Sha256::new();
    h.update(format!("prevail-webui:{user}:{pass}").as_bytes());
    format!("{:x}", h.finalize())
}

#[derive(Deserialize)]
struct InvokeReq {
    cmd: String,
    #[serde(default)]
    args: serde_json::Value,
}

impl WebuiState {
    pub fn status(&self) -> WebuiStatus {
        let i = self.inner.lock().unwrap();
        WebuiStatus { running: i.running, port: i.port, user: i.user.clone() }
    }

    pub fn stop(&self) {
        let mut i = self.inner.lock().unwrap();
        i.running = false;
        i.stop = None; // dropping the listener Arc lets the accept loop error out
    }

    // Resolve a pending browser invoke with the host window's result.
    pub fn resolve(&self, id: u64, out: InvokeOut) {
        let pending = { self.inner.lock().unwrap().pending.clone() };
        let tx = pending.lock().unwrap().remove(&id);
        if let Some(tx) = tx {
            let _ = tx.send(out);
        }
    }

    // Broadcast a host event to every connected SSE client.
    pub fn broadcast(&self, event: &str, payload: &serde_json::Value) {
        let sse = { self.inner.lock().unwrap().sse.clone() };
        let frame = format!(
            "data: {}\n\n",
            serde_json::json!({ "event": event, "payload": payload })
        );
        let mut clients = sse.lock().unwrap();
        clients.retain(|tx| tx.send(frame.clone()).is_ok());
    }

    pub fn start(&self, app: tauri::AppHandle, port: u16, user: String, pass: String) -> Result<(), String> {
        self.stop();
        let token = hash_token(&user, &pass);
        let listener = std::net::TcpListener::bind(("0.0.0.0", port)).map_err(|e| format!("bind :{port}: {e}"))?;
        let server = tiny_http::Server::from_listener(listener.try_clone().map_err(|e| e.to_string())?, None)
            .map_err(|e| e.to_string())?;
        {
            let mut i = self.inner.lock().unwrap();
            i.running = true;
            i.port = port;
            i.token = token.clone();
            i.user = user.clone();
            i.pass = pass.clone();
            i.stop = Some(Arc::new(listener));
        }
        let next_id = { self.inner.lock().unwrap().next_id.clone() };
        let pending = { self.inner.lock().unwrap().pending.clone() };
        let sse = { self.inner.lock().unwrap().sse.clone() };

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
        let hdr = req.headers().iter().find(|h| h.field.equiv("Authorization")).map(|h| h.value.as_str().to_string());
        if hdr.as_deref() == Some(token) { return true; }
        url.split('?').nth(1).map(|q| q.split('&').any(|kv| kv == format!("token={token}"))).unwrap_or(false)
    };

    // ── Login ──
    if path == "/api/login" && method == tiny_http::Method::Post {
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let creds: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
        let ok = creds.get("user").and_then(|v| v.as_str()) == Some(user)
            && creds.get("pass").and_then(|v| v.as_str()) == Some(pass);
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
        let id = next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx): (Sender<InvokeOut>, Receiver<InvokeOut>) = channel();
        pending.lock().unwrap().insert(id, tx);
        let _ = app.emit_to("main", "webui:invoke", serde_json::json!({ "id": id, "cmd": r.cmd, "args": r.args }));
        let out = rx.recv_timeout(Duration::from_secs(310)).unwrap_or(InvokeOut { ok: false, data: serde_json::Value::Null, error: "host timeout".into() });
        pending.lock().unwrap().remove(&id);
        let payload = if out.ok { serde_json::json!({ "data": out.data }) } else { serde_json::json!({ "error": out.error }) };
        let _ = req.respond(json_response(200, &payload));
        return;
    }

    // ── Emit (browser → host) ──
    if path == "/api/emit" && method == tiny_http::Method::Post {
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
        if let Some(ev) = v.get("event").and_then(|e| e.as_str()) {
            let _ = app.emit(ev, v.get("payload").cloned().unwrap_or(serde_json::Value::Null));
        }
        let _ = req.respond(json_response(200, &serde_json::json!({ "ok": true })));
        return;
    }

    // ── SSE events ──
    if path == "/api/events" {
        let (tx, rx) = channel::<String>();
        sse.lock().unwrap().push(tx);
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
