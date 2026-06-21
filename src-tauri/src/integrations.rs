// Tauri commands backing the Integrations panel. Thin orchestration: capture
// status/install/sync delegate to the bundled prevail engine (which owns the
// schema, vault resolution, dedup, and OS wiring), and the one-click MCP
// registration drives the target CLI's own `mcp add` so the user never copies
// a config by hand.

/// `prevail capture status --json` - stream counts + per-harness wiring.
#[tauri::command]
pub fn capture_status(vault: String) -> Result<serde_json::Value, String> {
    crate::engine::run_engine_json(&["--vault", &vault, "capture", "status"])
}

/// `prevail capture install --json` - wire push hooks + stage the sync backstop.
#[tauri::command]
pub fn capture_install(vault: String) -> Result<serde_json::Value, String> {
    crate::engine::run_engine_json(&["--vault", &vault, "capture", "install"])
}

/// `prevail capture sync --json` - pull prompts from every CLI's transcripts.
/// Can take a moment on the first run (it scans whole transcript trees); Tauri
/// runs sync commands off the UI thread so the cockpit stays responsive.
#[tauri::command]
pub fn capture_sync(vault: String) -> Result<serde_json::Value, String> {
    crate::engine::run_engine_json(&["--vault", &vault, "capture", "sync"])
}

/// One-click: register Prevail as an MCP server in one client's own config.
/// `client` is claude|codex|gemini|antigravity|cursor. The engine owns the
/// per-client format (TOML/JSON/`claude mcp add`) and registers flag-less so the
/// server follows the saved vault (move-proof). Returns the engine's per-client
/// JSON report.
#[tauri::command]
pub fn mcp_install(client: String) -> Result<serde_json::Value, String> {
    crate::engine::run_engine_json(&["mcp", "install", "--client", &client])
}

/// Where Prevail's MCP server is currently registered, across every known client.
#[tauri::command]
pub fn mcp_install_status() -> Result<serde_json::Value, String> {
    crate::engine::run_engine_json(&["mcp", "status"])
}
