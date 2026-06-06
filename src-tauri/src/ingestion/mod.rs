// Ingestion orchestrator
//
// Triple-tier data collection layer for life-domain artifacts:
//   Tier A — Raw MCP / native OAuth subprocesses
//   Tier B — Composio managed gateway runtime
//   Tier C — Headed Playwright browser automation
//
// Each tier is a pluggable `IngestionTier` implementation registered
// with the orchestrator at startup. Tiers run independently so a
// failure in one doesn't tear the others down.
//
// All artifacts land in the storage sandbox (see `storage.rs`).
// Public Tauri commands are exposed via the public functions at the
// bottom of this file and wired into `lib.rs::invoke_handler!`.

pub mod storage;
pub mod keychain;
pub mod tier_a_mcp;
pub mod tier_b_composio;
pub mod tier_c_browser;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

// ─────────────────────────────────────────────────────────────────────
// Shared types

/// What a tier reports back when asked for its status.
#[derive(Debug, Clone, Serialize)]
pub struct TierStatus {
    /// Stable id, e.g. "tier_a_mcp", "tier_b_composio", "tier_c_browser".
    pub id: String,
    /// Human label for the settings UI.
    pub label: String,
    /// One-line readiness summary.
    pub state: String,
    /// True when this tier has work it can do right now (config loaded,
    /// API key present, etc.). False when inert/idle.
    pub active: bool,
    /// Number of in-flight subprocesses or active sessions.
    pub running: usize,
    /// Last error message, if any. Cleared on successful run.
    pub last_error: Option<String>,
}

/// What a tier emits when it produces a downloaded artifact.
#[derive(Debug, Clone, Serialize)]
pub struct IngestedArtifact {
    /// Final on-disk path after sandboxing.
    pub path: String,
    /// "tier_a_mcp" / "tier_b_composio" / "tier_c_browser"
    pub tier_id: String,
    /// Free-form subsource: MCP server name, Composio app, portal slug.
    pub source: String,
    /// Domain the artifact belongs to.
    pub domain: String,
    /// Unix seconds.
    pub ts: u64,
    /// SHA-256 of file contents.
    pub sha256: String,
    /// Original size in bytes.
    pub size: u64,
}

/// Request payload for kicking off a Tier C portal run.
#[derive(Debug, Clone, Deserialize)]
pub struct BrowserRunRequest {
    pub domain: String,
    pub portal: String,        // e.g. "fidelity", "td-ameritrade"
    pub start_url: String,
    /// Seconds to wait for human MFA/login completion before aborting.
    #[serde(default = "default_mfa_timeout")]
    pub mfa_timeout_sec: u64,
    /// CSS selector or URL substring confirming login complete.
    pub success_selector: Option<String>,
    pub success_url_contains: Option<String>,
}

fn default_mfa_timeout() -> u64 { 90 }

// ─────────────────────────────────────────────────────────────────────
// Orchestrator state — shared across Tauri commands

/// Container for any state a tier needs to keep between commands
/// (live subprocesses, etc.). Wrapped in Mutex because Tauri commands
/// can be called from multiple threads.
pub struct OrchestratorState {
    pub tier_a: Mutex<tier_a_mcp::McpRegistry>,
    pub tier_b: Mutex<tier_b_composio::ComposioRuntime>,
    pub tier_c: Mutex<tier_c_browser::BrowserRunner>,
}

impl Default for OrchestratorState {
    fn default() -> Self {
        Self {
            tier_a: Mutex::new(tier_a_mcp::McpRegistry::new()),
            tier_b: Mutex::new(tier_b_composio::ComposioRuntime::new()),
            tier_c: Mutex::new(tier_c_browser::BrowserRunner::new()),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// Tauri commands — re-exported via lib.rs

#[tauri::command]
pub fn ingestion_status(
    state: tauri::State<'_, OrchestratorState>,
) -> Result<Vec<TierStatus>, String> {
    let a = state.tier_a.lock().map_err(|e| e.to_string())?.status();
    let b = state.tier_b.lock().map_err(|e| e.to_string())?.status();
    let c = state.tier_c.lock().map_err(|e| e.to_string())?.status();
    Ok(vec![a, b, c])
}

#[tauri::command]
pub fn ingestion_mcp_list(
    state: tauri::State<'_, OrchestratorState>,
) -> Result<Vec<tier_a_mcp::McpServerInfo>, String> {
    state
        .tier_a
        .lock()
        .map_err(|e| e.to_string())?
        .list()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ingestion_mcp_start(
    state: tauri::State<'_, OrchestratorState>,
    name: String,
) -> Result<(), String> {
    let mut reg = state.tier_a.lock().map_err(|e| e.to_string())?;
    reg.start(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ingestion_mcp_stop(
    state: tauri::State<'_, OrchestratorState>,
    name: String,
) -> Result<(), String> {
    let mut reg = state.tier_a.lock().map_err(|e| e.to_string())?;
    reg.stop(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ingestion_composio_set_key(
    state: tauri::State<'_, OrchestratorState>,
    key: String,
) -> Result<(), String> {
    let mut rt = state.tier_b.lock().map_err(|e| e.to_string())?;
    rt.set_key(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ingestion_composio_start(
    state: tauri::State<'_, OrchestratorState>,
) -> Result<(), String> {
    let mut rt = state.tier_b.lock().map_err(|e| e.to_string())?;
    rt.start().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ingestion_composio_stop(
    state: tauri::State<'_, OrchestratorState>,
) -> Result<(), String> {
    let mut rt = state.tier_b.lock().map_err(|e| e.to_string())?;
    rt.stop().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ingestion_browser_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, OrchestratorState>,
    req: BrowserRunRequest,
) -> Result<(), String> {
    let mut br = state.tier_c.lock().map_err(|e| e.to_string())?;
    br.run(app, req).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ingestion_keychain_set(
    service: String,
    account: String,
    secret: String,
) -> Result<(), String> {
    keychain::set(&service, &account, &secret).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ingestion_keychain_get(
    service: String,
    account: String,
) -> Result<String, String> {
    keychain::get(&service, &account).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ingestion_keychain_del(
    service: String,
    account: String,
) -> Result<(), String> {
    keychain::del(&service, &account).map_err(|e| e.to_string())
}
