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
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.status.clone()
        };
        let s = status_arc.lock().await;
        s.clone()
    }

    pub async fn stop(&self) {
        let (stop_tx_opt, handle_opt, status_arc) = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
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
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
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

                                    // T1: keep the "typing…" indicator alive
                                    // while the model works (Telegram clears it
                                    // after ~5s, so refresh every 4s until done).
                                    let typing_token = cfg.token.clone();
                                    let typing_chat = cfg.chat_id.clone();
                                    let typing_task = tokio::spawn(async move {
                                        loop {
                                            let _ = send_chat_action(&typing_token, &typing_chat, "typing").await;
                                            tokio::time::sleep(Duration::from_secs(4)).await;
                                        }
                                    });
                                    // Dispatch to the CLI and reply.
                                    let cli_result = run_cli(&cfg.cli, cfg.model.as_deref(), &text).await;
                                    typing_task.abort();
                                    match cli_result {
                                        Ok(reply) => {
                                            let reply = if reply.trim().is_empty() {
                                                "(no output)".to_string()
                                            } else {
                                                reply
                                            };
                                            // Telegram caps message length at 4096 chars. Chunk the
                                            // RAW reply (so HTML tags never split across a boundary),
                                            // then format each chunk. T2: send as HTML; on a parse
                                            // error fall back to plain text so a reply is never lost.
                                            for chunk in chunk_text(&reply, 3500) {
                                                let html = format_for_telegram(&chunk);
                                                let sent = match send_message(&cfg.token, &cfg.chat_id, &html, true).await {
                                                    Ok(()) => Ok(()),
                                                    Err(_) => send_message(&cfg.token, &cfg.chat_id, &chunk, false).await,
                                                };
                                                match sent {
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

        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
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

/// Send a chat message. When `html` is true the text is sent with
/// `parse_mode=HTML` so the small subset of tags we emit (<b> <i> <code> <pre>)
/// renders as formatting instead of literal markup (T2).
async fn send_message(token: &str, chat_id: &str, text: &str, html: bool) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{token}/sendMessage");
    let body = if html {
        format!(
            "{{\"chat_id\":\"{}\",\"text\":{},\"parse_mode\":\"HTML\"}}",
            chat_id,
            serde_json::to_string(text).map_err(|e| e.to_string())?,
        )
    } else {
        format!(
            "{{\"chat_id\":\"{}\",\"text\":{}}}",
            chat_id,
            serde_json::to_string(text).map_err(|e| e.to_string())?,
        )
    };
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

/// Show the "typing…" indicator in the chat (T1). Best-effort — failures are
/// ignored by the caller since it's only cosmetic.
async fn send_chat_action(token: &str, chat_id: &str, action: &str) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{token}/sendChatAction");
    let body = format!("{{\"chat_id\":\"{chat_id}\",\"action\":\"{action}\"}}");
    let out = TokioCommand::new("curl")
        .args(["-fsS", "-X", "POST", "-H", "Content-Type: application/json", "-d", &body, &url])
        .output()
        .await
        .map_err(|e| format!("curl spawn: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Apply inline markdown → HTML on a single already-trimmed line body:
/// `**bold**`/`__bold__` → <b>, `` `code` `` → <code>. The input is HTML-escaped
/// first so any stray `<`/`>`/`&` render literally and never break the parse.
fn inline_md_to_html(line: &str) -> String {
    let esc = escape_html(line);
    // Inline code first so bold markers inside backticks aren't transformed.
    let coded = wrap_pairs(&esc, '`', "<code>", "</code>");
    // Bold: ** … ** then __ … __.
    let b1 = wrap_delim(&coded, "**", "<b>", "</b>");
    wrap_delim(&b1, "__", "<b>", "</b>")
}

/// Replace matched pairs of a single delimiter char with open/close tags.
fn wrap_pairs(s: &str, delim: char, open: &str, close: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut open_now = true;
    // Only transform fully-paired delimiters; leave a lone trailing one literal.
    let pair_floor = {
        let count = s.matches(delim).count();
        count - (count % 2)
    };
    let mut seen = 0;
    for ch in s.chars() {
        if ch == delim && seen < pair_floor {
            out.push_str(if open_now { open } else { close });
            open_now = !open_now;
            seen += 1;
        } else {
            out.push(ch);
        }
    }
    out
}

/// Replace matched pairs of a multi-char delimiter (e.g. "**") with tags.
fn wrap_delim(s: &str, delim: &str, open: &str, close: &str) -> String {
    let n = s.matches(delim).count();
    let pairs = n / 2;
    if pairs == 0 {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    let mut replaced = 0;
    let mut open_now = true;
    while replaced < pairs * 2 {
        if let Some(idx) = rest.find(delim) {
            out.push_str(&rest[..idx]);
            out.push_str(if open_now { open } else { close });
            open_now = !open_now;
            replaced += 1;
            rest = &rest[idx + delim.len()..];
        } else {
            break;
        }
    }
    out.push_str(rest);
    out
}

/// Convert a model's GitHub-flavored markdown into the subset of HTML that
/// Telegram's `parse_mode=HTML` supports (T2). Handles fenced code blocks,
/// inline code, bold, headings (→ bold), and bullet normalization. Anything
/// else is HTML-escaped so it renders literally rather than as raw markup.
fn format_for_telegram(md: &str) -> String {
    let mut out = String::new();
    let mut in_code = false;
    for line in md.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            if in_code {
                out.push_str("</pre>\n");
                in_code = false;
            } else {
                out.push_str("<pre>");
                in_code = true;
            }
            continue;
        }
        if in_code {
            out.push_str(&escape_html(line));
            out.push('\n');
            continue;
        }
        if trimmed.starts_with('#') {
            let heading = trimmed.trim_start_matches('#').trim_start();
            out.push_str(&format!("<b>{}</b>\n", inline_md_to_html(heading)));
        } else if let Some(rest) = trimmed.strip_prefix("- ").or_else(|| trimmed.strip_prefix("* ")) {
            out.push_str(&format!("• {}\n", inline_md_to_html(rest)));
        } else {
            out.push_str(&inline_md_to_html(line));
            out.push('\n');
        }
    }
    if in_code {
        out.push_str("</pre>");
    }
    out.trim_end().to_string()
}

pub(crate) async fn run_cli(cli: &str, model: Option<&str>, prompt: &str) -> Result<String, String> {
    // Single guarded choke point: every model spawn that flows through run_cli
    // (Telegram bridge, distillation, surface generation) is subject to Bunker
    // Mode. Local providers pass; cloud providers are refused while Bunker is on.
    crate::bunker::guard_cli(cli)?;
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
            // agy's -p/--print takes the prompt as a VALUE; `--print=<value>`
            // is safe for prompts that start with "--".
            v.push(format!("--print={prompt}"));
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
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
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
    crate::bunker::guard_cloud()?; // the Telegram bridge polls the Telegram cloud API
    // Audit #7: the bot token is a secret and must live in the Keychain, not
    // localStorage. The frontend stores it via provider_key_set("telegram") and
    // passes an empty token; resolve it here so the secret never persists in the
    // renderer. A non-empty token (legacy/immediate) is still accepted.
    let mut cfg = cfg;
    if cfg.token.trim().is_empty() {
        cfg.token = crate::ingestion::keychain::get("prevail.providers", "telegram")
            .map_err(|_| "no Telegram token configured".to_string())?;
        if cfg.token.trim().is_empty() {
            return Err("no Telegram token configured".into());
        }
    }
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

#[cfg(test)]
mod tg_format_tests {
    use super::*;

    #[test]
    fn converts_bold_and_inline_code() {
        let out = format_for_telegram("Use **bold** and `code` here");
        assert_eq!(out, "Use <b>bold</b> and <code>code</code> here");
    }

    #[test]
    fn headings_and_bullets() {
        let out = format_for_telegram("# Title\n- one\n- two");
        assert_eq!(out, "<b>Title</b>\n• one\n• two");
    }

    #[test]
    fn escapes_html_and_fences_code_blocks() {
        let out = format_for_telegram("a < b & c\n```\nx<y\n```");
        assert_eq!(out, "a &lt; b &amp; c\n<pre>x&lt;y\n</pre>");
    }

    #[test]
    fn lone_marker_left_literal() {
        // An unpaired ** must not produce an unbalanced <b>.
        let out = format_for_telegram("2 ** 3 = 8");
        assert_eq!(out, "2 ** 3 = 8");
    }
}
