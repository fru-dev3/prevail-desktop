// Tauri commands backing the Integrations panel. Thin orchestration: capture
// status/install/sync delegate to the bundled prevail engine (which owns the
// schema, vault resolution, dedup, and OS wiring), and the one-click MCP
// registration drives the target CLI's own config.
//
// Every command is `async` and runs the (blocking) engine subprocess on a
// blocking thread via spawn_blocking, so a slow or hanging engine call can NEVER
// freeze the webview/UI thread.

async fn engine_json(args: Vec<String>) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        crate::engine::run_engine_json(&refs)
    })
    .await
    .map_err(|e| format!("engine task failed: {e}"))?
}

/// `prevail capture status` - stream counts + per-harness wiring.
#[tauri::command]
pub async fn capture_status(vault: String) -> Result<serde_json::Value, String> {
    engine_json(vec!["--vault".into(), vault, "capture".into(), "status".into()]).await
}

/// `prevail capture install` - wire push hooks + stage the sync backstop.
#[tauri::command]
pub async fn capture_install(vault: String) -> Result<serde_json::Value, String> {
    engine_json(vec!["--vault".into(), vault, "capture".into(), "install".into()]).await
}

/// `prevail capture sync` - pull prompts from every CLI's transcripts.
#[tauri::command]
pub async fn capture_sync(vault: String) -> Result<serde_json::Value, String> {
    engine_json(vec!["--vault".into(), vault, "capture".into(), "sync".into()]).await
}

/// Turn capture on/off for one tool. The flag is honored by both the live hook
/// and the automatic reader, so "off" means the tool stops being captured.
#[tauri::command]
pub async fn capture_set_enabled(vault: String, tool: String, on: bool) -> Result<serde_json::Value, String> {
    let sub = if on { "enable" } else { "disable" };
    engine_json(vec!["--vault".into(), vault, "capture".into(), sub.into(), "--tool".into(), tool]).await
}

/// Register Prevail as an MCP server in one client's own config. `client` is
/// claude|codex|gemini|antigravity|cursor. The engine owns the per-client format
/// and registers flag-less (move-proof, with --unsafe-detach so the parent-check
/// never falsely rejects the launch).
#[tauri::command]
pub async fn mcp_install(client: String) -> Result<serde_json::Value, String> {
    engine_json(vec!["mcp".into(), "install".into(), "--client".into(), client]).await
}

/// Where Prevail's MCP server is currently registered, across every known client.
#[tauri::command]
pub async fn mcp_install_status() -> Result<serde_json::Value, String> {
    engine_json(vec!["mcp".into(), "status".into()]).await
}

/// Mirror the desktop's per-domain auto-council toggle into the engine config
/// (`modes set <domain> --auto auto|off`). The MCP server reads that config, so
/// flipping auto-council in the preview chat also makes `prevail.chat` calls from
/// host LLMs (Codex, Gemini, …) escalate high-stakes questions to the council.
#[tauri::command]
pub async fn set_auto_council(domain: String, on: bool) -> Result<serde_json::Value, String> {
    let mode = if on { "auto" } else { "off" };
    engine_json(vec![
        "modes".into(),
        "set".into(),
        domain,
        "--auto".into(),
        mode.into(),
        "--json".into(),
    ])
    .await
}
