// Nango — a THIRD parallel connection track (Direct | Composio | Nango), separate
// from both. Nango is a unified-API platform: the user supplies their Nango secret
// key (from app.nango.dev env settings), Prevail lists the integrations configured
// in their Nango project, and connecting an app uses a Nango Connect session (the
// user authorizes in the browser). Nango then keeps the data synced; Prevail reads
// the synced records. Plain REST + Bearer auth, no MCP handshake.

use serde_json::{json, Value};

use crate::ingestion::keychain;

const NANGO_API: &str = "https://api.nango.dev";
const KC_SERVICE: &str = "prevail.ingestion";
const KC_ACCOUNT: &str = "nango";

fn nango_key() -> Result<String, String> {
    let k = keychain::get(KC_SERVICE, KC_ACCOUNT).map_err(|_| "no Nango key saved yet".to_string())?;
    if k.trim().is_empty() { return Err("no Nango key saved yet".into()); }
    Ok(k.trim().to_string())
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

/// Is a Nango key saved.
#[tauri::command]
pub async fn nango_status() -> Result<Value, String> {
    let configured = keychain::get(KC_SERVICE, KC_ACCOUNT).map(|s| !s.trim().is_empty()).unwrap_or(false);
    Ok(json!({ "configured": configured }))
}

/// Save (or clear) the Nango secret key in the Keychain.
#[tauri::command]
pub fn nango_set_key(key: String) -> Result<(), String> {
    let k = key.trim();
    if k.is_empty() { return keychain::del(KC_SERVICE, KC_ACCOUNT); }
    keychain::set(KC_SERVICE, KC_ACCOUNT, k)
}

/// Verify the key by listing integrations. Returns { ok, error? }.
#[tauri::command]
pub async fn nango_verify() -> Result<Value, String> {
    let key = nango_key()?;
    let resp = client()
        .get(format!("{NANGO_API}/integrations"))
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| format!("nango request failed: {e}"))?;
    if resp.status().is_success() {
        Ok(json!({ "ok": true }))
    } else if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        Ok(json!({ "ok": false, "error": "Nango rejected the key (unauthorized)" }))
    } else {
        Ok(json!({ "ok": false, "error": format!("Nango returned HTTP {}", resp.status().as_u16()) }))
    }
}

/// List the integrations configured in the user's Nango project. Returns a
/// normalized list of { unique_key, provider, display_name } from whatever shape
/// Nango returns (data[] or configs[] or a bare array).
#[tauri::command]
pub async fn nango_integrations() -> Result<Value, String> {
    let key = nango_key()?;
    let resp = client()
        .get(format!("{NANGO_API}/integrations"))
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| format!("nango request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Nango returned HTTP {}", resp.status().as_u16()));
    }
    let body: Value = resp.json().await.map_err(|e| format!("nango parse failed: {e}"))?;
    let arr = body.get("data").and_then(|d| d.as_array())
        .or_else(|| body.get("configs").and_then(|d| d.as_array()))
        .or_else(|| body.as_array())
        .cloned()
        .unwrap_or_default();
    let out: Vec<Value> = arr.iter().map(|it| {
        let unique_key = it.get("unique_key").and_then(|v| v.as_str())
            .or_else(|| it.get("provider_config_key").and_then(|v| v.as_str()))
            .or_else(|| it.get("id").and_then(|v| v.as_str()))
            .unwrap_or("").to_string();
        let provider = it.get("provider").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let display = it.get("display_name").and_then(|v| v.as_str())
            .or_else(|| it.get("displayName").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .unwrap_or_else(|| if !provider.is_empty() { provider.clone() } else { unique_key.clone() });
        json!({ "unique_key": unique_key, "provider": provider, "display_name": display })
    }).filter(|v| !v.get("unique_key").and_then(|k| k.as_str()).unwrap_or("").is_empty()).collect();
    Ok(json!({ "integrations": out }))
}

/// The active connections (apps the user has already authorized in Nango).
#[tauri::command]
pub async fn nango_connections() -> Result<Value, String> {
    let key = nango_key()?;
    let resp = client()
        .get(format!("{NANGO_API}/connection"))
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| format!("nango request failed: {e}"))?;
    if !resp.status().is_success() {
        return Ok(json!({ "active": [] }));
    }
    let body: Value = resp.json().await.map_err(|e| format!("nango parse failed: {e}"))?;
    let arr = body.get("connections").and_then(|d| d.as_array())
        .or_else(|| body.get("data").and_then(|d| d.as_array()))
        .or_else(|| body.as_array())
        .cloned()
        .unwrap_or_default();
    let active: Vec<String> = arr.iter().filter_map(|c| {
        c.get("provider_config_key").and_then(|v| v.as_str())
            .or_else(|| c.get("integration_id").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
    }).collect();
    Ok(json!({ "active": active }))
}

/// Start a Nango Connect session for an integration and return the hosted Connect
/// URL the user opens to authorize. POST /connect/sessions -> { data: { token } }.
#[tauri::command]
pub async fn nango_connect(integration: String) -> Result<Value, String> {
    let key = nango_key()?;
    let uniq = integration.trim();
    if uniq.is_empty() { return Err("integration id required".into()); }
    let resp = client()
        .post(format!("{NANGO_API}/connect/sessions"))
        .bearer_auth(&key)
        .json(&json!({
            "end_user": { "id": "prevail-user" },
            "allowed_integrations": [uniq],
        }))
        .send()
        .await
        .map_err(|e| format!("nango connect failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Nango connect returned HTTP {}", resp.status().as_u16()));
    }
    let body: Value = resp.json().await.map_err(|e| format!("nango parse failed: {e}"))?;
    let token = body.pointer("/data/token").and_then(|t| t.as_str())
        .or_else(|| body.get("token").and_then(|t| t.as_str()))
        .ok_or("Nango did not return a session token")?;
    let connect_url = format!("https://connect.nango.dev?session_token={token}");
    Ok(json!({ "ok": true, "connectUrl": connect_url, "token": token }))
}
