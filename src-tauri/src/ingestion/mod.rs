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
// Tier C (headed Playwright browser automation) RETIRED: the browser lane now
// lives entirely in the prevail-cli engine (connectors browser-learn / browser-
// replay), surfaced by ConnectorRunPanel. One engine-owned browser path.
pub mod tier_d_cli;

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

// ─────────────────────────────────────────────────────────────────────
// Orchestrator state — shared across Tauri commands

/// Container for any state a tier needs to keep between commands
/// (live subprocesses, etc.). Wrapped in Mutex because Tauri commands
/// can be called from multiple threads.
pub struct OrchestratorState {
    pub tier_a: Mutex<tier_a_mcp::McpRegistry>,
    pub tier_b: Mutex<tier_b_composio::ComposioRuntime>,
    pub tier_d: Mutex<tier_d_cli::CliRunner>,
}

impl Default for OrchestratorState {
    fn default() -> Self {
        Self {
            tier_a: Mutex::new(tier_a_mcp::McpRegistry::new()),
            tier_b: Mutex::new(tier_b_composio::ComposioRuntime::new()),
            tier_d: Mutex::new(tier_d_cli::CliRunner::new()),
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
    let d = state.tier_d.lock().map_err(|e| e.to_string())?.status();
    Ok(vec![a, b, d])
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
    crate::bunker::guard_cloud()?; // external MCP servers reach the network
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
    crate::bunker::guard_cloud()?; // Composio is a cloud integration gateway
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
pub fn ingestion_keychain_set(
    service: String,
    account: String,
    secret: String,
) -> Result<(), String> {
    keychain::set(&service, &account, &secret).map_err(|e| e.to_string())
}

// SECURITY: there is intentionally NO `ingestion_keychain_get` Tauri command.
// Exposing a generic "read any Keychain secret by service+account" to the JS
// layer would be a broad exfiltration primitive if the renderer were ever
// compromised. Rust-internal callers use `keychain::get(...)` directly; the
// frontend only ever learns whether a secret EXISTS (see `provider_key_exists`),
// never its value.

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
    // 0700 the app-support tree: it holds decrypted vault imports, this MCP
    // config (which the user fills with integration tokens), and ingestion logs.
    storage::create_private_dir(&root)?;
    let p = root.join("mcp_config.json");
    if !p.exists() {
        let blank = serde_json::json!({
            "mcpServers": {}
        });
        let text = serde_json::to_string_pretty(&blank)
            .map_err(|e| format!("serialize blank: {e}"))?;
        // 0600: the user will paste tokens (GITHUB_TOKEN, etc.) into this file;
        // pre-clamp perms so they're never world-readable even after editing.
        storage::write_private(&p, &text)?;
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

/// Bundled connector catalog — the pre-populated, pattern-tagged list of
/// personal-life apps. Every app carries a connector `pattern`
/// (api/oauth/cli/browser) that maps to an ingestion tier, so the router
/// stays app-agnostic. Returned verbatim as parsed JSON to avoid struct
/// drift as the catalog schema grows; the frontend owns the shape.
#[tauri::command]
pub fn ingestion_connector_catalog(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let resource = app
        .path()
        .resolve(
            "resources/connectors/catalog.json",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve catalog.json: {e}"))?;
    if !resource.exists() {
        return Ok(serde_json::json!({ "version": 0, "domains": [], "apps": [] }));
    }
    let raw =
        std::fs::read_to_string(&resource).map_err(|e| format!("read catalog.json: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse catalog.json: {e}"))
}

/// Bundled brand logos for catalog apps — `{ slug: { hex, path } }`, an SVG
/// path per matched simple-icons brand. Apps reference a slug via `iconSlug`;
/// unmatched apps fall back to a pattern-tinted dot in the UI.
#[tauri::command]
pub fn ingestion_connector_logos(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let resource = app
        .path()
        .resolve(
            "resources/connectors/logos.json",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve logos.json: {e}"))?;
    if !resource.exists() {
        return Ok(serde_json::json!({}));
    }
    let raw = std::fs::read_to_string(&resource).map_err(|e| format!("read logos.json: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse logos.json: {e}"))
}

// ── Tier D — CLI connectors ──────────────────────────────────────────

/// Load the bundled, allowlisted CLI providers. The JS surface can only
/// reference these by id; it never supplies a binary or args itself.
fn load_cli_providers(app: &tauri::AppHandle) -> Result<Vec<tier_d_cli::CliProvider>, String> {
    use tauri::Manager;
    let resource = app
        .path()
        .resolve(
            "resources/connectors/cli_providers.json",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve cli_providers.json: {e}"))?;
    if !resource.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&resource).map_err(|e| format!("read cli_providers.json: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse cli_providers.json: {e}"))
}

#[tauri::command]
pub fn ingestion_cli_providers(app: tauri::AppHandle) -> Result<Vec<tier_d_cli::CliProvider>, String> {
    load_cli_providers(&app)
}

/// Is the provider's CLI installed + on PATH? Runs its read-only version probe.
#[tauri::command]
pub fn ingestion_cli_probe(
    app: tauri::AppHandle,
    state: tauri::State<'_, OrchestratorState>,
    provider_id: String,
) -> Result<bool, String> {
    let providers = load_cli_providers(&app)?;
    let provider = providers
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("unknown CLI provider: {provider_id}"))?;
    let mut runner = state.tier_d.lock().map_err(|e| e.to_string())?;
    Ok(runner.probe(&provider))
}

/// Summary returned to the UI after a successful CLI pull.
#[derive(Serialize, Clone)]
pub struct CliRunSummary {
    pub provider: String,
    pub app: String,
    pub domain: String,
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Run a provider's read-only command and ingest its stdout as an artifact.
#[tauri::command]
pub fn ingestion_cli_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, OrchestratorState>,
    provider_id: String,
) -> Result<CliRunSummary, String> {
    use tauri::Emitter;
    crate::bunker::guard_cloud()?; // a CLI fetch may reach the network

    let providers = load_cli_providers(&app)?;
    let provider = providers
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("unknown CLI provider: {provider_id}"))?;

    let out = {
        let mut runner = state.tier_d.lock().map_err(|e| e.to_string())?;
        runner.run(&provider)?
    };

    // Stage the captured stdout in a temp file, then move it through the
    // single artifact sink (SHA-256 + sidecar) like every other tier.
    let tmp = std::env::temp_dir().join(format!("prevail-cli-{}-{}.out", provider.id, std::process::id()));
    std::fs::write(&tmp, &out.stdout).map_err(|e| format!("stage cli output: {e}"))?;
    let clean = format!("{}-{}.txt", provider.app, provider.id);
    let (dest, meta) = storage::ingest_artifact(&tmp, &provider.domain, "tier_d_cli", &provider.app, &clean)?;

    let _ = app.emit(
        "ingestion:artifact",
        serde_json::json!({
            "tier_id": "tier_d_cli",
            "domain": meta.domain,
            "source": meta.source,
            "path": dest.to_string_lossy(),
            "sha256": meta.sha256,
            "size": meta.size,
            "original": meta.original_name,
            "ts": meta.ts,
        }),
    );

    Ok(CliRunSummary {
        provider: provider.id,
        app: provider.app,
        domain: provider.domain,
        path: dest.to_string_lossy().to_string(),
        bytes: meta.size,
        sha256: meta.sha256,
    })
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
