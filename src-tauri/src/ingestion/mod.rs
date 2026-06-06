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

#[tauri::command]
pub fn ingestion_mcp_config_path() -> Result<String, String> {
    Ok(storage::app_support_root()?
        .join("mcp_config.json")
        .to_string_lossy()
        .to_string())
}

/// Create a blank `mcp_config.json` with the right schema if it
/// doesn't already exist. Returns the path either way.
#[tauri::command]
pub fn ingestion_mcp_config_init() -> Result<String, String> {
    let root = storage::app_support_root()?;
    std::fs::create_dir_all(&root).map_err(|e| format!("mkdir app support: {e}"))?;
    let p = root.join("mcp_config.json");
    if !p.exists() {
        let blank = serde_json::json!({
            "mcpServers": {}
        });
        let text = serde_json::to_string_pretty(&blank)
            .map_err(|e| format!("serialize blank: {e}"))?;
        std::fs::write(&p, text).map_err(|e| format!("write blank config: {e}"))?;
    }
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn ingestion_mcp_reload(
    state: tauri::State<'_, OrchestratorState>,
) -> Result<(), String> {
    let mut reg = state.tier_a.lock().map_err(|e| e.to_string())?;
    reg.reload();
    Ok(())
}

/// Portal recipes for Tier C — a starter library so users don't have
/// to type URLs from scratch. Loaded from the bundled resources.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct PortalRecipe {
    pub id: String,
    pub label: String,
    pub domain_hint: String,
    pub start_url: String,
    pub success_url_contains: Option<String>,
    pub notes: Option<String>,
}

/// A single artifact entry as surfaced to the UI.
#[derive(serde::Serialize, Clone, Debug)]
pub struct ArtifactEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub mtime: u64,
    pub meta: Option<storage::ArtifactMeta>,
}

/// List artifacts that have landed in a domain's imports/ folder.
/// Returns newest-first. Reads the sidecar `<file>.meta.json` if it
/// exists; otherwise returns the entry with `meta = None` (handles
/// files dropped in by the user directly).
#[tauri::command]
pub fn ingestion_list_artifacts(domain: String) -> Result<Vec<ArtifactEntry>, String> {
    let dir = match storage::imports_dir(&domain) {
        Ok(d) => d,
        Err(_) => return Ok(vec![]),
    };
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut entries: Vec<ArtifactEntry> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("read imports: {e}"))?.flatten() {
        let p = entry.path();
        let name = match p.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Skip the sidecar files themselves; only show artifacts.
        if name.ends_with(".meta.json") {
            continue;
        }
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = md.len();
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        // Sidecar path: <name>.<ext>.meta.json
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("bin");
        let meta_path = p.with_extension(format!("{ext}.meta.json"));
        let meta = std::fs::read_to_string(&meta_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<storage::ArtifactMeta>(&raw).ok());

        entries.push(ArtifactEntry {
            path: p.to_string_lossy().to_string(),
            name,
            size,
            mtime,
            meta,
        });
    }
    entries.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    Ok(entries)
}

#[tauri::command]
pub fn ingestion_mcp_stderr(
    state: tauri::State<'_, OrchestratorState>,
    name: String,
) -> Result<String, String> {
    let mut reg = state.tier_a.lock().map_err(|e| e.to_string())?;
    reg.drain_stderr(&name)
}

#[tauri::command]
pub fn ingestion_browser_recipes(app: tauri::AppHandle) -> Result<Vec<PortalRecipe>, String> {
    use tauri::Manager;
    let resource = app
        .path()
        .resolve(
            "resources/automation/recipes.json",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve recipes.json: {e}"))?;
    if !resource.exists() {
        return Ok(vec![]);
    }
    let raw = std::fs::read_to_string(&resource).map_err(|e| format!("read recipes.json: {e}"))?;
    let parsed: Vec<PortalRecipe> = serde_json::from_str(&raw)
        .map_err(|e| format!("parse recipes.json: {e}"))?;
    Ok(parsed)
}
