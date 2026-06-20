// Composio managed gateway — the SEPARATE "Apps Composio" track (distinct from the
// per-app "Direct" connectors). The user's key is a CONSUMER key for the hosted MCP
// endpoint, so REST APIs reject it; everything goes through Streamable HTTP MCP to
// connect.composio.dev/mcp with the X-CONSUMER-API-KEY header:
//   POST initialize -> mcp-session-id header -> notifications/initialized -> tools/call
// The connector management is exposed as meta-tools (COMPOSIO_MANAGE_CONNECTIONS,
// COMPOSIO_SEARCH_TOOLS), so connecting an app returns an auth link the user opens.

use serde_json::{json, Value};

use crate::ingestion::keychain;

const COMPOSIO_MCP_URL: &str = "https://connect.composio.dev/mcp";
const KC_SERVICE: &str = "prevail.ingestion";
const KC_ACCOUNT: &str = "composio";

fn composio_key() -> Result<String, String> {
    let k = keychain::get(KC_SERVICE, KC_ACCOUNT).map_err(|_| "no Composio key saved yet".to_string())?;
    if k.trim().is_empty() { return Err("no Composio key saved yet".into()); }
    Ok(k.trim().to_string())
}

// Pull the JSON-RPC object out of an SSE body (`event: message\ndata: {...}`), or
// parse the whole body when the server answered with plain JSON.
fn parse_sse_jsonrpc(body: &str) -> Option<Value> {
    for line in body.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("data:") {
            if let Ok(v) = serde_json::from_str::<Value>(rest.trim()) {
                if v.get("jsonrpc").is_some() { return Some(v); }
            }
        }
    }
    serde_json::from_str::<Value>(body).ok()
}

// Recursively find the first http(s) URL in a value (the auth link Composio returns
// under a field whose name varies by toolkit).
fn find_url(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if s.starts_with("http://") || s.starts_with("https://") => Some(s.clone()),
        Value::Array(a) => a.iter().find_map(find_url),
        Value::Object(o) => o.values().find_map(find_url),
        _ => None,
    }
}

async fn open_session(client: &reqwest::Client, key: &str) -> Result<String, String> {
    let init = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"prevail","version":"1.0"}}});
    let resp = client
        .post(COMPOSIO_MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("X-CONSUMER-API-KEY", key)
        .json(&init)
        .send()
        .await
        .map_err(|e| format!("composio init failed: {e}"))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("composio rejected the key (unauthorized)".into());
    }
    let sid = resp
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or("composio did not return a session id")?;
    let _ = resp.text().await; // drain the initialize body
    let _ = client
        .post(COMPOSIO_MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("X-CONSUMER-API-KEY", key)
        .header("mcp-session-id", &sid)
        .json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
        .send()
        .await;
    Ok(sid)
}

async fn call_tool(client: &reqwest::Client, key: &str, sid: &str, tool: &str, args: Value) -> Result<Value, String> {
    let req = json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":tool,"arguments":args}});
    let resp = client
        .post(COMPOSIO_MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("X-CONSUMER-API-KEY", key)
        .header("mcp-session-id", sid)
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("composio call failed: {e}"))?;
    let body = resp.text().await.map_err(|e| format!("composio body failed: {e}"))?;
    parse_sse_jsonrpc(&body).ok_or_else(|| "composio returned an unparseable response".to_string())
}

/// Is a Composio key saved.
#[tauri::command]
pub async fn composio_status() -> Result<Value, String> {
    let configured = keychain::get(KC_SERVICE, KC_ACCOUNT).map(|s| !s.trim().is_empty()).unwrap_or(false);
    Ok(json!({ "configured": configured }))
}

/// Save (or clear) the Composio consumer key in the Keychain.
#[tauri::command]
pub fn composio_set_key(key: String) -> Result<(), String> {
    let k = key.trim();
    if k.is_empty() { return keychain::del(KC_SERVICE, KC_ACCOUNT); }
    keychain::set(KC_SERVICE, KC_ACCOUNT, k)
}

/// Verify the saved key actually connects to the Composio MCP endpoint.
#[tauri::command]
pub async fn composio_verify() -> Result<Value, String> {
    let key = composio_key()?;
    let client = reqwest::Client::new();
    match open_session(&client, &key).await {
        Ok(_) => Ok(json!({ "ok": true })),
        Err(e) => Ok(json!({ "ok": false, "error": e })),
    }
}

/// Connect an app via Composio: MANAGE_CONNECTIONS `add` returns an auth link the
/// user opens to authorize that toolkit in Composio. Returns { ok, authUrl?, raw }.
#[tauri::command]
pub async fn composio_connect_app(toolkit: String) -> Result<Value, String> {
    let key = composio_key()?;
    let slug = toolkit.trim().to_lowercase().replace(' ', "_");
    if slug.is_empty() { return Err("toolkit name required".into()); }
    let client = reqwest::Client::new();
    let sid = open_session(&client, &key).await?;
    let v = call_tool(&client, &key, &sid, "COMPOSIO_MANAGE_CONNECTIONS", json!({ "toolkits": [{ "name": slug, "action": "add" }] })).await?;
    let is_error = v.pointer("/result/isError").and_then(|b| b.as_bool()).unwrap_or(false);
    let text = v.pointer("/result/content/0/text").and_then(|t| t.as_str()).unwrap_or("");
    let inner: Value = serde_json::from_str(text).unwrap_or_else(|_| json!({ "text": text }));
    let auth = find_url(&inner);
    Ok(json!({ "ok": !is_error, "authUrl": auth, "raw": inner }))
}
