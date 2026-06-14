// Telegram bot send — POST to /sendMessage on the Bot API (in-process reqwest,
// not curl, so the token never lands in argv). The token + chat ID come from the
// frontend. Extracted from lib.rs. (The full inbound gateway lives in
// telegram_bridge.rs; this is just the one-shot outbound send command.)

use serde::Serialize;

use crate::{bunker, ingestion};

#[derive(Serialize)]
pub(crate) struct TelegramResult {
    pub ok: bool,
    pub description: Option<String>,
}

#[tauri::command]
pub(crate) async fn telegram_send(
    _app: tauri::AppHandle,
    token: String,
    chat_id: String,
    text: String,
) -> Result<TelegramResult, String> {
    // Bunker Mode is a hard network kill-switch: every cloud egress path must
    // consult it. This "Test" command POSTs to the Telegram cloud, so it gets
    // the same guard the bridge has — closes the one path that skipped it.
    bunker::guard_cloud()?;
    // Resolve an empty token from the Keychain (the token is stored there, not
    // localStorage) so "Test" works against the saved secret.
    let token = if token.trim().is_empty() {
        ingestion::keychain::get("prevail.providers", "telegram").unwrap_or_default()
    } else {
        token
    };
    if token.trim().is_empty() {
        return Err("no Telegram token configured".into());
    }
    // In-process reqwest, NOT `curl`: the previous shell-plugin curl put the bot
    // token in argv (readable via `ps`) and required `curl` in the shell
    // allowlist (an arbitrary-exfil primitive). reqwest keeps the token
    // in-process and lets us drop curl from the capability allowlist entirely.
    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let body = serde_json::json!({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("telegram request failed: {e}"))?;
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parse response: {e}"))?;
    let ok = v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false);
    let desc = v.get("description").and_then(|x| x.as_str()).map(String::from);
    Ok(TelegramResult { ok, description: desc })
}
