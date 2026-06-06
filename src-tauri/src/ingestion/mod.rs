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
    /// Post-login automation steps executed by the Playwright sidecar.
    #[serde(default)]
    pub actions: Vec<PostLoginAction>,
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
///
/// `actions` is the post-login automation sequence executed by the
/// Playwright runner once the success check passes. Empty / absent
/// means "stop after login, let the user click around manually."
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct PortalRecipe {
    pub id: String,
    pub label: String,
    pub domain_hint: String,
    pub start_url: String,
    pub success_url_contains: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub actions: Vec<PostLoginAction>,
}

/// One step the Playwright runner executes after login completes.
/// Kept intentionally narrow — extend with new variants only when a
/// real portal needs them. Each variant maps to a Playwright primitive.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PostLoginAction {
    /// page.goto(url) — change to a known statements page directly.
    Goto { url: String, #[serde(default)] wait_until: Option<String> },
    /// page.click(selector) — fire the click as if the user did it.
    Click { selector: String, #[serde(default)] timeout_sec: Option<u64> },
    /// page.waitForSelector(selector) — pause until an element appears.
    WaitFor { selector: String, #[serde(default)] timeout_sec: Option<u64> },
    /// page.selectOption(selector, value) — pick from a <select>.
    SelectOption { selector: String, value: String },
    /// Click every link matching the selector. Each click triggers a
    /// download event, which the runner already routes through the
    /// storage sandbox. Useful for "download all statements".
    DownloadAllLinks { selector: String, #[serde(default)] max: Option<usize> },
    /// Pause N seconds — sometimes portals lazy-load after navigation.
    Sleep { seconds: u64 },
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

/// User-recipe overlay path. Persistent across upgrades since the
/// app bundle never touches Application Support.
fn user_recipes_path() -> Result<std::path::PathBuf, String> {
    Ok(storage::app_support_root()?.join("recipes_user.json"))
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
    let mut bundled: Vec<PortalRecipe> = if resource.exists() {
        let raw = std::fs::read_to_string(&resource).map_err(|e| format!("read recipes.json: {e}"))?;
        serde_json::from_str(&raw).map_err(|e| format!("parse recipes.json: {e}"))?
    } else {
        Vec::new()
    };
    // Merge user overlay — user entries win on `id` collision so
    // someone overriding "fidelity" with a custom URL gets their
    // version, not the bundled one.
    let user_path = user_recipes_path()?;
    if user_path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&user_path) {
            if let Ok(user_recipes) = serde_json::from_str::<Vec<PortalRecipe>>(&raw) {
                let user_ids: std::collections::HashSet<_> =
                    user_recipes.iter().map(|r| r.id.clone()).collect();
                bundled.retain(|r| !user_ids.contains(&r.id));
                bundled.extend(user_recipes);
            }
        }
    }
    bundled.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(bundled)
}

/// Upsert a user recipe into recipes_user.json. Overwrites by id.
#[tauri::command]
pub fn ingestion_recipe_save(recipe: PortalRecipe) -> Result<(), String> {
    let path = user_recipes_path()?;
    let mut existing: Vec<PortalRecipe> = if path.exists() {
        let raw = std::fs::read_to_string(&path).map_err(|e| format!("read user recipes: {e}"))?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        Vec::new()
    };
    existing.retain(|r| r.id != recipe.id);
    existing.push(recipe);
    existing.sort_by(|a, b| a.label.cmp(&b.label));
    let text = serde_json::to_string_pretty(&existing).map_err(|e| format!("serialize: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    std::fs::write(&path, text).map_err(|e| format!("write user recipes: {e}"))?;
    Ok(())
}

/// Per-domain quick stats — number of imports, total size. Used by
/// the sidebar to show a tiny "3 imports" badge per domain.
#[derive(serde::Serialize, Clone, Debug)]
pub struct DomainStats {
    pub domain: String,
    pub imports: usize,
    pub bytes: u64,
}

#[tauri::command]
pub fn ingestion_domain_stats(domain: String) -> Result<DomainStats, String> {
    let dir = match storage::imports_dir(&domain) {
        Ok(d) => d,
        Err(_) => return Ok(DomainStats { domain, imports: 0, bytes: 0 }),
    };
    let mut imports = 0usize;
    let mut bytes = 0u64;
    if dir.exists() {
        for entry in std::fs::read_dir(&dir).map_err(|e| format!("read imports: {e}"))?.flatten() {
            let name = match entry.file_name().to_str() {
                Some(n) => n.to_string(),
                None => continue,
            };
            if name.ends_with(".meta.json") { continue; }
            imports += 1;
            if let Ok(md) = entry.metadata() {
                bytes += md.len();
            }
        }
    }
    Ok(DomainStats { domain, imports, bytes })
}

/// Append a single JSON-line audit record describing an ingest event.
/// Independent of `ingest_artifact` so callers can audit non-file
/// events (e.g. a tier failing to start).
fn append_audit_log(record: &serde_json::Value) -> Result<(), String> {
    use std::io::Write;
    let path = storage::app_support_root()?.join("ingestion.log");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open audit log: {e}"))?;
    let line = serde_json::to_string(record).map_err(|e| format!("serialize: {e}"))?;
    writeln!(f, "{line}").map_err(|e| format!("write audit: {e}"))?;
    Ok(())
}

/// Delete artifacts (and their .meta.json sidecars) older than the
/// cutoff. Skips files modified within the window. Returns the count
/// removed. Every deletion is appended to the audit log.
#[tauri::command]
pub fn ingestion_vacuum_imports(domain: String, older_than_days: u64) -> Result<usize, String> {
    let dir = storage::imports_dir(&domain)?;
    if !dir.exists() {
        return Ok(0);
    }
    let now = std::time::SystemTime::now();
    let cutoff = now
        .checked_sub(std::time::Duration::from_secs(older_than_days * 24 * 60 * 60))
        .ok_or_else(|| "invalid cutoff".to_string())?;
    let mut removed = 0usize;
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("read dir: {e}"))?.flatten() {
        let p = entry.path();
        // Skip sidecars on this pass; they get deleted alongside their
        // owning artifact below.
        let name = match p.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name.ends_with(".meta.json") {
            continue;
        }
        let mtime = match entry.metadata().and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };
        if mtime > cutoff {
            continue;
        }
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("bin");
        let sidecar = p.with_extension(format!("{ext}.meta.json"));
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(&sidecar);
        removed += 1;
        let _ = append_audit_log(&serde_json::json!({
            "type": "vacuum",
            "domain": domain,
            "path": p.to_string_lossy(),
            "older_than_days": older_than_days,
            "ts": now
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        }));
    }
    Ok(removed)
}

#[tauri::command]
pub fn ingestion_audit_tail(limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    let path = storage::app_support_root()?.join("ingestion.log");
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read audit: {e}"))?;
    let cap = limit.unwrap_or(200);
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(cap);
    let out = lines[start..]
        .iter()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .collect();
    Ok(out)
}

/// Used by storage::ingest_artifact via re-export so storage doesn't
/// need to know about the audit log structure. Keeps the inversion:
/// storage owns the path, the engine owns the audit shape.
pub(crate) fn audit_ingest_event(
    tier_id: &str,
    source: &str,
    domain: &str,
    sha256: &str,
    size: u64,
    path: &str,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    append_audit_log(&serde_json::json!({
        "type": "ingest",
        "tier_id": tier_id,
        "source": source,
        "domain": domain,
        "sha256": sha256,
        "size": size,
        "path": path,
        "ts": now,
    }))
}
