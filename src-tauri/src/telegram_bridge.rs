// Telegram bridge — bidirectional chat
//
// Mirrors the OpenClaw / Hermes pattern: a background tokio task
// long-polls `getUpdates`. Each inbound message from the configured
// chat_id is dispatched to a CLI (claude / codex / agy / ollama) as
// a one-shot prompt. Stdout is captured and pushed back to the same
// chat via `sendMessage`.
//
// One bridge per app instance. start_bridge replaces any running
// task; stop_bridge cancels it. State is held behind a Mutex on
// BridgeState which is .manage()d on the Tauri builder.
//
// Webhooks aren't an option here — a local Mac app has no public URL.
// Long-polling (timeout=30) keeps the request open until Telegram has
// updates or the timeout fires, so the loop is responsive without
// thrashing the network.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::async_runtime::JoinHandle;
use tokio::process::Command as TokioCommand;
use tokio::sync::{watch, Mutex as AsyncMutex};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgeConfig {
    pub token: String,
    pub chat_id: String,
    pub cli: String,           // claude | codex | antigravity | ollama
    pub model: Option<String>, // optional override
    pub domain: Option<String>, // optional — currently unused but reserved
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct BridgeStatus {
    pub running: bool,
    pub last_update_id: i64,
    pub last_inbound_ts: Option<u64>,
    pub last_outbound_ts: Option<u64>,
    pub last_error: Option<String>,
    pub inbound_count: u64,
    pub outbound_count: u64,
}

pub struct BridgeState {
    inner: Mutex<Inner>,
}

struct Inner {
    handle: Option<JoinHandle<()>>,
    stop_tx: Option<watch::Sender<bool>>,
    status: Arc<AsyncMutex<BridgeStatus>>,
}

impl BridgeState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                handle: None,
                stop_tx: None,
                status: Arc::new(AsyncMutex::new(BridgeStatus::default())),
            }),
        }
    }

    pub async fn status(&self) -> BridgeStatus {
        let status_arc = {
            let inner = self.inner.lock().unwrap();
            inner.status.clone()
        };
        let s = status_arc.lock().await;
        s.clone()
    }

    pub async fn stop(&self) {
        let (stop_tx_opt, handle_opt, status_arc) = {
            let mut inner = self.inner.lock().unwrap();
            (inner.stop_tx.take(), inner.handle.take(), inner.status.clone())
        };
        if let Some(tx) = stop_tx_opt {
            let _ = tx.send(true);
        }
        if let Some(h) = handle_opt {
            h.abort();
        }
        let mut s = status_arc.lock().await;
        s.running = false;
    }

    pub async fn start(&self, app: tauri::AppHandle, cfg: BridgeConfig) {
        // Replace any running loop with a fresh one.
        self.stop().await;
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let status_arc = {
            let inner = self.inner.lock().unwrap();
            inner.status.clone()
        };
        {
            let mut s = status_arc.lock().await;
            *s = BridgeStatus::default();
            s.running = true;
        }
        let status_for_task = status_arc.clone();

        let handle = tauri::async_runtime::spawn(async move {
            use tauri::Emitter;
            let mut last_update_id: i64 = 0;
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() { break; }
                    }
                    res = fetch_updates(&cfg.token, last_update_id + 1) => {
                        match res {
                            Ok(updates) => {
                                for upd in updates {
                                    last_update_id = upd.update_id;
                                    {
                                        let mut s = status_for_task.lock().await;
                                        s.last_update_id = last_update_id;
                                    }
                                    let msg = match upd.message {
                                        Some(m) => m,
                                        None => continue,
                                    };
                                    // Only honor messages from the configured chat_id.
                                    // Prevents the bot from blabbing back to a stranger
                                    // who added it to a different chat.
                                    if msg.chat.id.to_string() != cfg.chat_id {
                                        continue;
                                    }
                                    let text = msg.text.unwrap_or_default();
                                    if text.trim().is_empty() {
                                        continue;
                                    }
                                    {
                                        let mut s = status_for_task.lock().await;
                                        s.inbound_count += 1;
                                        s.last_inbound_ts = Some(now_secs());
                                        s.last_error = None;
                                    }
                                    let _ = app.emit(
                                        "tg:message_in",
                                        serde_json::json!({
                                            "from": msg.from.as_ref().and_then(|u| u.username.clone()),
                                            "text": text,
                                        }),
                                    );

                                    // Dispatch to the CLI and reply.
                                    match run_cli(&cfg.cli, cfg.model.as_deref(), &text).await {
                                        Ok(reply) => {
                                            let reply = if reply.trim().is_empty() {
                                                "(no output)".to_string()
                                            } else {
                                                reply
                                            };
                                            // Telegram caps message length at 4096 chars.
                                            for chunk in chunk_text(&reply, 4000) {
                                                match send_message(&cfg.token, &cfg.chat_id, &chunk).await {
                                                    Ok(_) => {
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
                                            let _ = app.emit(
                                                "tg:message_out",
                                                serde_json::json!({ "text": reply }),
                                            );
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
                                // Back off a bit before retrying so we don't
                                // hammer a flapping endpoint.
                                tokio::time::sleep(Duration::from_secs(5)).await;
                            }
                        }
                    }
                }
            }
            let mut s = status_for_task.lock().await;
            s.running = false;
        });

        let mut inner = self.inner.lock().unwrap();
        inner.handle = Some(handle);
        inner.stop_tx = Some(stop_tx);
    }
}

// ─────────────────────────────────────────────────────────────────────
// Telegram API shapes — only the fields we touch.

#[derive(Deserialize)]
struct UpdatesResponse {
    ok: bool,
    #[serde(default)]
    result: Vec<TgUpdate>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct TgUpdate {
    update_id: i64,
    #[serde(default)]
    message: Option<TgMessage>,
}

#[derive(Deserialize)]
struct TgMessage {
    chat: TgChat,
    #[serde(default)]
    from: Option<TgUser>,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize)]
struct TgChat {
    id: i64,
}

#[derive(Deserialize)]
struct TgUser {
    #[serde(default)]
    username: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────
// HTTP helpers using `curl` so we don't need reqwest.

async fn fetch_updates(token: &str, offset: i64) -> Result<Vec<TgUpdate>, String> {
    let url = format!(
        "https://api.telegram.org/bot{token}/getUpdates?offset={offset}&timeout=25"
    );
    let out = TokioCommand::new("curl")
        .args(["-fsS", "--max-time", "60", &url])
        .output()
        .await
        .map_err(|e| format!("curl spawn: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "curl getUpdates: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let body = String::from_utf8_lossy(&out.stdout).to_string();
    let parsed: UpdatesResponse =
        serde_json::from_str(&body).map_err(|e| format!("parse getUpdates: {e}"))?;
    if !parsed.ok {
        return Err(parsed.description.unwrap_or_else(|| "telegram not ok".into()));
    }
    Ok(parsed.result)
}

async fn send_message(token: &str, chat_id: &str, text: &str) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{token}/sendMessage");
    let body = format!(
        "{{\"chat_id\":\"{}\",\"text\":{}}}",
        chat_id,
        serde_json::to_string(text).map_err(|e| e.to_string())?,
    );
    let out = TokioCommand::new("curl")
        .args([
            "-fsS",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-d",
            &body,
            &url,
        ])
        .output()
        .await
        .map_err(|e| format!("curl spawn: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "sendMessage: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

async fn run_cli(cli: &str, model: Option<&str>, prompt: &str) -> Result<String, String> {
    let (bin, args) = match cli {
        "claude" => {
            let mut v = vec!["--dangerously-skip-permissions".to_string()];
            if let Some(m) = model {
                v.push("--model".into());
                v.push(m.to_string());
            }
            v.push("-p".into());
            v.push("--".into()); // end options — prompt may start with "--"
            v.push(prompt.to_string());
            ("claude", v)
        }
        "codex" => {
            let mut v = vec!["exec".to_string(), "--skip-git-repo-check".to_string()];
            if let Some(m) = model {
                v.push("--model".into());
                v.push(m.to_string());
            }
            v.push("--".into()); // end options — prompt may start with "--"
            v.push(prompt.to_string());
            ("codex", v)
        }
        "antigravity" => {
            let mut v = vec!["--dangerously-skip-permissions".to_string()];
            if let Some(m) = model {
                v.push("--model".into());
                v.push(m.to_string());
            }
            v.push("-p".into());
            v.push("--".into()); // end options — prompt may start with "--"
            v.push(prompt.to_string());
            ("agy", v)
        }
        "ollama" => {
            let m = model.unwrap_or("llama3.2");
            ("ollama", vec!["run".into(), m.to_string(), "--".into(), prompt.to_string()])
        }
        _ => return Err(format!("unknown cli: {cli}")),
    };

    let bin_abs = crate::resolve_bin_abs(bin);
    let (combined_path, user, logname) = crate::build_cli_env();

    let out = TokioCommand::new(&bin_abs)
        .args(&args)
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        .stdin(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| format!("spawn {bin}: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if !out.status.success() && stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(stderr.lines().last().unwrap_or("(no output)").to_string());
    }
    Ok(stdout)
}

// ─────────────────────────────────────────────────────────────────────
// Misc helpers.

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Split `text` into chunks no longer than `max` chars. Naïve — we
/// just cut at the boundary. Telegram messages cap at 4096 chars; we
/// leave headroom for Markdown wrapping.
fn chunk_text(text: &str, max: usize) -> Vec<String> {
    if text.len() <= max {
        return vec![text.to_string()];
    }
    let mut out = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let end = (i + max).min(chars.len());
        out.push(chars[i..end].iter().collect());
        i = end;
    }
    out
}

// ─────────────────────────────────────────────────────────────────────
// Tauri commands.

#[tauri::command]
pub async fn telegram_bridge_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, BridgeState>,
    cfg: BridgeConfig,
) -> Result<(), String> {
    state.start(app, cfg).await;
    Ok(())
}

#[tauri::command]
pub async fn telegram_bridge_stop(
    state: tauri::State<'_, BridgeState>,
) -> Result<(), String> {
    state.stop().await;
    Ok(())
}

#[tauri::command]
pub async fn telegram_bridge_status(
    state: tauri::State<'_, BridgeState>,
) -> Result<BridgeStatus, String> {
    Ok(state.status().await)
}
