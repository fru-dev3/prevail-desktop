// engine.rs — the ENGINE-CLIENT SEAM.
//
// This is the SINGLE place the desktop talks to the `prevail` CLI engine.
// Everything else in the app should go through the typed Tauri commands
// exported here (engine_domains / engine_score / engine_manifest_get)
// rather than shelling out to `prevail` ad-hoc.
//
// Two layers:
//   1. Generic plumbing — locate the binary, run it with `--json`, parse
//      stdout into serde_json::Value (run_engine_json), plus a streaming
//      NDJSON variant that mirrors lib.rs chat_send's spawn/stream/emit
//      pattern (run_engine_stream).
//   2. Typed structs mirroring the contract schemas in
//      fd-apps-prevail-cli/docs/schemas/ so the React side gets a stable,
//      typed shape regardless of how the CLI evolves.
//
// The CLI subcommands proxied here (`domains`, `score`, `manifest get`)
// may not exist yet — the seam just shells out, so this compiles and the
// commands fail gracefully at runtime until the CLI catches up.

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Emitter;

// ─────────────────────────────────────────────────────────────────────
// Binary resolution — mirror lib.rs resolve_prevail_bin() /
// resolve_bin_abs() style: check ~/.local/bin, /opt/homebrew/bin,
// /usr/local/bin, then fall back to the bare name (PATH resolution).

pub(crate) fn resolve_prevail_bin() -> String {
    // 1. Bundled engine sidecar — the app ships its own `prevail` engine
    //    (Tauri `externalBin`) so a fresh download is fully self-contained
    //    and never depends on a separately-installed CLI. Tauri places the
    //    sidecar next to the app's main executable (Contents/MacOS/prevail,
    //    target-triple stripped at bundle time).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = dir.join("prevail");
            if sidecar.exists() {
                return sidecar.to_string_lossy().to_string();
            }
        }
    }
    // 2. A developer-installed CLI on common paths (covers `tauri dev`,
    //    where there's no bundled sidecar next to the debug binary).
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.local/bin/prevail"),
        format!("{home}/.bun/bin/prevail"),
        format!("/opt/homebrew/bin/prevail"),
        format!("/usr/local/bin/prevail"),
        format!("/usr/bin/prevail"),
    ];
    for c in &candidates {
        if Path::new(c).exists() {
            return c.clone();
        }
    }
    // 3. Fall back to the bare name; tokio/std will resolve via PATH.
    "prevail".to_string()
}

// ─────────────────────────────────────────────────────────────────────
// Generic helpers

/// Spawn `prevail <args> --json`, capture stdout, parse it as JSON.
///
/// Always appends `--json` so the CLI emits machine-readable output.
/// Uses the same enriched env (PATH/USER/LOGNAME) as lib.rs chat_send so
/// Finder-launched GUI apps can still find node-shebang binaries and so
/// claude-backed audits can read their Keychain entry.
pub fn run_engine_json(args: &[&str]) -> Result<serde_json::Value, String> {
    use std::process::Command;

    let bin = resolve_prevail_bin();
    let (combined_path, user, logname) = crate::build_cli_env();

    let mut full: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    full.push("--json".to_string());

    let out = Command::new(&bin)
        .args(&full)
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("spawn {bin} failed: {e}"))?;

    if !out.status.success() {
        let code = out.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stderr = stderr.trim();
        return Err(format!("prevail exited {code}: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stdout = stdout.trim();
    if stdout.is_empty() {
        return Err("prevail produced no output".to_string());
    }
    serde_json::from_str::<serde_json::Value>(stdout)
        .map_err(|e| format!("failed to parse prevail JSON: {e}"))
}

/// Like `run_engine_json`, but writes `stdin_body` to the child's stdin
/// before reading stdout. Used by the engine commands whose contract reads
/// a JSON document from stdin (`onboard recommend`, `onboard apply`,
/// `manifest set`). Same enriched env as `run_engine_json`.
pub fn run_engine_json_stdin(
    args: &[&str],
    stdin_body: &str,
) -> Result<serde_json::Value, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let bin = resolve_prevail_bin();
    let (combined_path, user, logname) = crate::build_cli_env();

    let mut full: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    full.push("--json".to_string());

    let mut child = Command::new(&bin)
        .args(&full)
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn {bin} failed: {e}"))?;

    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open prevail stdin".to_string())?;
        stdin
            .write_all(stdin_body.as_bytes())
            .map_err(|e| format!("failed to write prevail stdin: {e}"))?;
        // stdin dropped here -> EOF for the child.
    }

    let out = child
        .wait_with_output()
        .map_err(|e| format!("wait {bin} failed: {e}"))?;

    if !out.status.success() {
        let code = out.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stderr = stderr.trim();
        return Err(format!("prevail exited {code}: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stdout = stdout.trim();
    if stdout.is_empty() {
        return Err("prevail produced no output".to_string());
    }
    serde_json::from_str::<serde_json::Value>(stdout)
        .map_err(|e| format!("failed to parse prevail JSON: {e}"))
}

/// Streaming NDJSON variant. Spawns `prevail <args> --json`, reads stdout
/// line-by-line, and emits each parsed JSON line back to the frontend as
/// a Tauri event so the UI can render progress live. Mirrors the
/// spawn/stream/emit pattern in lib.rs chat_send.
///
/// Each stdout line that parses as JSON is emitted on `<event_prefix>:line`
/// as `{ "session": <session>, "data": <parsed value> }`. Non-JSON lines
/// are forwarded raw under the same event with a string `data`. When the
/// child exits, `<event_prefix>:done` fires with `{ "session", "code" }`.
///
/// Provided as part of the seam for streaming engine commands (e.g. a
/// future `prevail score --stream`). Not yet wired to a Tauri command.
#[allow(dead_code)]
pub async fn run_engine_stream(
    app: tauri::AppHandle,
    session: String,
    args: Vec<String>,
    event_prefix: &'static str,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command as TokioCommand;

    let bin = resolve_prevail_bin();
    let (combined_path, user, logname) = crate::build_cli_env();

    let mut full = args;
    full.push("--json".to_string());

    let mut child = TokioCommand::new(&bin)
        .args(&full)
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn {bin} failed: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let session_done = session.clone();

    let line_event = format!("{event_prefix}:line");
    let done_event = format!("{event_prefix}:done");

    if let Some(s) = stdout {
        let app2 = app.clone();
        let session2 = session.clone();
        let line_event2 = line_event.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let parsed: serde_json::Value = serde_json::from_str(&line)
                    .unwrap_or_else(|_| serde_json::Value::String(line.clone()));
                let _ = app2.emit(
                    &line_event2,
                    serde_json::json!({
                        "session": session2,
                        "data": parsed,
                    }),
                );
            }
        });
    }
    if let Some(s) = stderr {
        let app2 = app.clone();
        let session2 = session.clone();
        let line_event2 = line_event.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit(
                    &line_event2,
                    serde_json::json!({
                        "session": session2,
                        "stream": "stderr",
                        "data": line,
                    }),
                );
            }
        });
    }
    tauri::async_runtime::spawn(async move {
        let code = child.wait().await.ok().and_then(|s| s.code());
        let _ = app.emit(
            &done_event,
            serde_json::json!({
                "session": session_done,
                "code": code,
            }),
        );
    });
    Ok(())
}

/// Streaming NDJSON variant that ALSO writes a body to the child's stdin
/// before streaming stdout. This is the chat counterpart to
/// `run_engine_stream` — `prevail chat` reads the user message from stdin
/// (so multi-line / arbitrary content needs no shell-quoting) and emits a
/// ChatEvent NDJSON stream on stdout. Mirrors the spawn/stream/emit pattern
/// of `run_engine_stream`; the only difference is the piped + written stdin.
///
/// Each parsed stdout line is emitted on `<event_prefix>:line` as
/// `{ "session", "data": <ChatEvent> }`; stderr lines as
/// `{ "session", "stream": "stderr", "data": <line> }`; child exit fires
/// `<event_prefix>:done` with `{ "session", "code" }`.
pub async fn run_engine_stream_stdin(
    app: tauri::AppHandle,
    session: String,
    args: Vec<String>,
    stdin_body: String,
    event_prefix: &'static str,
    extra_env: Vec<(&'static str, String)>,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::process::Command as TokioCommand;

    let bin = resolve_prevail_bin();
    let (combined_path, user, logname) = crate::build_cli_env();

    let mut full = args;
    full.push("--json".to_string());

    let mut cmd = TokioCommand::new(&bin);
    cmd.args(&full)
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // Bunker Mode: tell the engine to self-enforce local-only (defense in depth
    // alongside the --local-only flag), and CRUCIALLY do not hand it any cloud
    // provider keys — with no key the engine physically cannot reach a cloud
    // gateway even if some path tried to.
    if crate::bunker::bunker_enabled() {
        cmd.env("PREVAIL_BUNKER", "1");
    } else {
        // Provider keys for the engine's OpenAI-compatible gateways (OpenRouter,
        // etc.). Read from the Keychain and injected here so the engine can make
        // its in-process HTTP call. Named PREVAIL_OPENROUTER_KEY to avoid the
        // engine's scrubbedEnv strip list (OPENAI_/ANTHROPIC_…).
        if let Ok(key) = crate::ingestion::keychain::get("prevail.providers", "openrouter") {
            if !key.is_empty() {
                cmd.env("PREVAIL_OPENROUTER_KEY", key);
            }
        }
    }
    // Per-call env overrides (e.g. PREVAIL_OLLAMA_URL redirect so the engine's
    // local provider path reaches LM Studio / MLX instead of Ollama). Local-only,
    // so safe under Bunker Mode.
    for (k, v) in &extra_env {
        cmd.env(k, v);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {bin} failed: {e}"))?;

    // Write the user message to stdin, then drop it so the child sees EOF.
    if let Some(mut stdin) = child.stdin.take() {
        let body = stdin_body.clone();
        tauri::async_runtime::spawn(async move {
            let _ = stdin.write_all(body.as_bytes()).await;
            let _ = stdin.shutdown().await;
            // stdin dropped here -> EOF for the child.
        });
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let session_done = session.clone();

    let line_event = format!("{event_prefix}:line");
    let done_event = format!("{event_prefix}:done");

    if let Some(s) = stdout {
        let app2 = app.clone();
        let session2 = session.clone();
        let line_event2 = line_event.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                let parsed: serde_json::Value = serde_json::from_str(&line)
                    .unwrap_or_else(|_| serde_json::Value::String(line.clone()));
                let _ = app2.emit(
                    &line_event2,
                    serde_json::json!({
                        "session": session2,
                        "data": parsed,
                    }),
                );
            }
        });
    }
    if let Some(s) = stderr {
        let app2 = app.clone();
        let session2 = session.clone();
        let line_event2 = line_event.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit(
                    &line_event2,
                    serde_json::json!({
                        "session": session2,
                        "stream": "stderr",
                        "data": line,
                    }),
                );
            }
        });
    }
    tauri::async_runtime::spawn(async move {
        let code = child.wait().await.ok().and_then(|s| s.code());
        let _ = app.emit(
            &done_event,
            serde_json::json!({
                "session": session_done,
                "code": code,
            }),
        );
    });
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────
// Typed structs — mirror the contract schemas in
// fd-apps-prevail-cli/docs/schemas/. Field names match the JSON schemas
// EXACTLY. Nullable schema fields are Option<>. We do NOT use
// deny_unknown_fields so the CLI can add fields without breaking the
// desktop's deserialization.

/// Mirrors ContextScore.json $defs/Dimension.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreDimension {
    pub score: i64,
    pub detail: String,
}

/// Mirrors ContextScore.json $defs/ScoreBreakdown. The six dimensions are
/// FROZEN per the schema — do not add/remove/rename without a version bump.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreBreakdown {
    pub coverage: ScoreDimension,
    pub density: ScoreDimension,
    pub freshness: ScoreDimension,
    pub structure: ScoreDimension,
    pub activity: ScoreDimension,
    pub config_completeness: ScoreDimension,
}

/// Mirrors MissingItem.json. `severity` is one of info|warn|critical and
/// `kind` is one of file|section|config|goal|freshness|skill|routing|
/// structure; kept as String so the desktop doesn't break if the CLI
/// adds an enum value.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingItem {
    pub label: String,
    pub severity: String,
    pub kind: String,
}

/// Mirrors ContextScore.json $defs/RelevanceItem — one expected, domain-specific
/// context item (e.g. "Most recent tax return") and whether it's present/fresh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelevanceItem {
    pub id: String,
    pub label: String,
    pub present: bool,
    pub stale: bool,
    pub severity: String,
    pub detail: String,
    pub recommend: String,
}

/// Mirrors ContextScore.json $defs/DomainRelevance — the domain-intelligent
/// half of the score (how much of what matters for THIS domain is present).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainRelevance {
    pub matched: String,
    pub score: i64,
    pub detail: String,
    pub items: Vec<RelevanceItem>,
}

/// Mirrors ContextScore.json — output of `prevail score <domain>`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextScore {
    pub domain: String,
    pub score: i64,
    pub breakdown: ScoreBreakdown,
    /// Domain-intelligent relevance layer; null for domains with no rubric.
    #[serde(default)]
    pub relevance: Option<DomainRelevance>,
    pub missing: Vec<MissingItem>,
    pub freshness_secs: i64,
    /// Optional LLM narrative; null when the score is purely heuristic.
    pub assessment: Option<String>,
    /// Engine that produced the assessment; null when no audit ran.
    pub audit_source: Option<String>,
    pub computed_at: String,
    /// Epoch milliseconds the audit ran, or null if never audited.
    pub audited_at: Option<f64>,
}

// ── DomainManifest (manifest.json) ──────────────────────────────────

/// Mirrors DomainManifest.json identity block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestIdentity {
    pub name: String,
    pub label: String,
    pub emoji: String,
    pub summary: String,
    pub created: String,
}

/// Mirrors DomainManifest.json config block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestConfig {
    pub cli: String,
    pub model: String,
    /// Default response framework id or null.
    pub framework: Option<String>,
    /// Default analytical lens id or null.
    pub lens: Option<String>,
    pub skills: Vec<String>,
    #[serde(rename = "autoState")]
    pub auto_state: bool,
}

/// Mirrors DomainManifest.json heartbeat.routines item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestRoutine {
    pub id: String,
    pub schedule: String,
    /// Per-routine toggle; defaults to true when omitted in the file.
    pub enabled: Option<bool>,
}

/// Mirrors DomainManifest.json heartbeat block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestHeartbeat {
    pub enabled: bool,
    pub routines: Vec<ManifestRoutine>,
}

/// Mirrors DomainManifest.json routing block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestRouting {
    pub keywords: Vec<String>,
    pub channels: Vec<String>,
    pub default: bool,
}

/// Mirrors DomainManifest.json sandbox block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestSandbox {
    /// "open" | "locked".
    pub mode: String,
}

/// Mirrors DomainManifest.json privacy block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestPrivacy {
    #[serde(rename = "localOnly")]
    pub local_only: bool,
}

/// Mirrors DomainManifest.json — the per-domain manifest.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainManifest {
    pub schema: i64,
    pub identity: ManifestIdentity,
    pub config: ManifestConfig,
    /// Last computed context score, embedded; null until first scored.
    pub context_score: Option<ContextScore>,
    pub goals: Vec<String>,
    pub heartbeat: ManifestHeartbeat,
    pub routing: ManifestRouting,
    pub sandbox: ManifestSandbox,
    pub privacy: ManifestPrivacy,
    pub archived: bool,
    /// ISO-8601 archival timestamp, or null if not archived.
    pub archived_at: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────
// Tauri commands — typed proxies to the engine. Each passes the vault
// via `--vault <vault>` placed BEFORE the subcommand, matching lib.rs
// benchmark_start/benchmark_score.

/// `prevail --vault <vault> domains --json`
/// Returns the raw JSON array of domains as the CLI reports them. Left as
/// serde_json::Value because the desktop already has its own richer
/// Domain shape from native scanning (lib.rs scan_vault); this is the
/// engine's own view for parity/debugging.
#[tauri::command]
pub fn engine_domains(vault: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["--vault", &vault, "domains"])
}

/// `prevail appmode get` — the demo vs production flag (engine config, global).
#[tauri::command]
pub fn engine_appmode_get() -> Result<serde_json::Value, String> {
    run_engine_json(&["appmode", "get"])
}

/// `prevail appmode set --mode demo|production`.
#[tauri::command]
pub fn engine_appmode_set(mode: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["appmode", "set", "--mode", &mode])
}

/// `prevail pack list` — the bundled persona packs.
#[tauri::command]
pub fn engine_pack_list() -> Result<serde_json::Value, String> {
    run_engine_json(&["pack", "list"])
}

/// `prevail --vault <vault> pack import <pack> [--overwrite]` — materialize a
/// bundled (or file) pack's starter domains into the vault.
#[tauri::command]
pub fn engine_pack_import(
    vault: String,
    pack: String,
    overwrite: bool,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<&str> = vec!["--vault", &vault, "pack", "import", &pack];
    if overwrite {
        args.push("--overwrite");
    }
    run_engine_json(&args)
}

/// `prevail --vault <vault> vault embed --from <vault> --json`
/// Non-destructively copy the active vault into the app-owned location
/// (~/.prevail/vault) and repoint config there. Returns the engine's
/// MigrateResult { dest, alreadyEmbedded, copied, sourceFiles, ok }. The source
/// is left intact; the desktop repoints its own vaultPath to `dest` on success.
#[tauri::command]
pub fn engine_vault_embed(vault: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["--vault", &vault, "vault", "embed", "--from", &vault])
}

/// `prevail --vault <vault> score <domain> [--audit] --json`
/// Returns a fully typed ContextScore.
#[tauri::command]
pub fn engine_score(
    vault: String,
    domain: String,
    audit: bool,
) -> Result<ContextScore, String> {
    let mut args: Vec<&str> = vec!["--vault", &vault, "score", &domain];
    if audit {
        args.push("--audit");
    }
    let value = run_engine_json(&args)?;
    serde_json::from_value::<ContextScore>(value)
        .map_err(|e| format!("failed to decode ContextScore: {e}"))
}

/// `prevail --vault <vault> manifest get <domain> --json`
/// Returns a fully typed DomainManifest.
#[tauri::command]
pub fn engine_manifest_get(
    vault: String,
    domain: String,
) -> Result<DomainManifest, String> {
    let value = run_engine_json(&["--vault", &vault, "manifest", "get", &domain])?;
    serde_json::from_value::<DomainManifest>(value)
        .map_err(|e| format!("failed to decode DomainManifest: {e}"))
}

/// Mirrors the aggregate output of `prevail score --all`. Contains the
/// per-domain ContextScore list plus the computed Life Readiness number
/// (the average of domain scores). Kept lenient — the desktop tolerates
/// the CLI adding fields. `life_readiness` is optional so the desktop can
/// fall back to averaging `domains[].score` itself if the CLI omits it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifeReadiness {
    /// 0–100 aggregate across all (non-archived) domains, or null when
    /// there are no domains to average.
    pub life_readiness: Option<i64>,
    /// Per-domain scores backing the aggregate.
    pub domains: Vec<ContextScore>,
    /// ISO-8601 timestamp the aggregate was computed.
    #[serde(default)]
    pub computed_at: Option<String>,
}

/// `prevail --vault <vault> score --all --json`
/// Returns the aggregate Life Readiness number plus every domain's
/// ContextScore. The CLI is expected to emit either an object matching
/// `LifeReadiness`, or a bare array of ContextScore — both are handled so
/// the desktop stays robust as the CLI evolves.
#[tauri::command]
pub fn engine_score_all(vault: String) -> Result<LifeReadiness, String> {
    let value = run_engine_json(&["--vault", &vault, "score", "--all"])?;

    // Preferred shape: { life_readiness, domains: [...] }.
    if value.is_object() {
        return serde_json::from_value::<LifeReadiness>(value)
            .map_err(|e| format!("failed to decode LifeReadiness: {e}"));
    }

    // Fallback shape: a bare array of ContextScore — average the scores.
    if value.is_array() {
        let domains = serde_json::from_value::<Vec<ContextScore>>(value)
            .map_err(|e| format!("failed to decode score --all array: {e}"))?;
        let life_readiness = if domains.is_empty() {
            None
        } else {
            let sum: i64 = domains.iter().map(|d| d.score).sum();
            Some(sum / domains.len() as i64)
        };
        return Ok(LifeReadiness {
            life_readiness,
            domains,
            computed_at: None,
        });
    }

    Err("unexpected shape from `prevail score --all`".to_string())
}

/// One historical context-score sample for a domain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreHistoryPoint {
    pub score: i64,
    /// ISO-8601 timestamp the sample was computed.
    pub computed_at: String,
    /// Engine that produced the assessment, when the sample was an audit.
    #[serde(default)]
    pub audit_source: Option<String>,
}

/// `prevail --vault <vault> score-history <domain> --json`
/// Returns the time series of past context scores for a domain (oldest
/// first per CLI convention). Tolerates the CLI wrapping the series in a
/// `{ "history": [...] }` object or returning a bare array.
#[tauri::command]
pub fn engine_score_history(
    vault: String,
    domain: String,
) -> Result<Vec<ScoreHistoryPoint>, String> {
    let value = run_engine_json(&["--vault", &vault, "score-history", &domain])?;

    let arr = if value.is_array() {
        value
    } else if let Some(h) = value.get("history").cloned() {
        h
    } else {
        return Err("unexpected shape from `prevail score-history`".to_string());
    };

    serde_json::from_value::<Vec<ScoreHistoryPoint>>(arr)
        .map_err(|e| format!("failed to decode score history: {e}"))
}

// ─────────────────────────────────────────────────────────────────────
// Wave-2 commands: onboarding, backup/archive/restore, manifest set.
//
// These mirror the contract in fd-apps-prevail-cli/docs/ENGINE-JSON-API.md.
// They return serde_json::Value (rather than fully typed structs) so the
// desktop stays robust as the CLI evolves; the React side has matching
// TypeScript interfaces (see App.tsx OnboardingRecommendation / BackupResult).

/// `prevail --vault <vault> onboard recommend --json` (answers JSON on stdin).
///
/// `answers_json` is the raw JSON document the contract expects on stdin,
/// e.g. `{ "answers": { "focus": "building ventures", ... } }`.
/// Returns an `OnboardingRecommendation`.
#[tauri::command]
pub fn engine_onboard_recommend(
    vault: String,
    #[allow(non_snake_case)] answersJson: String,
) -> Result<serde_json::Value, String> {
    run_engine_json_stdin(
        &["--vault", &vault, "onboard", "recommend"],
        &answersJson,
    )
}

/// `prevail --vault <vault> onboard apply --json` (picks JSON on stdin).
///
/// `picks_json` is the raw JSON document the contract expects on stdin,
/// e.g. `{ "picks": ["wealth", "business"] }`.
/// Returns a `Domain[]` for the picked names.
#[tauri::command]
pub fn engine_onboard_apply(
    vault: String,
    #[allow(non_snake_case)] picksJson: String,
) -> Result<serde_json::Value, String> {
    run_engine_json_stdin(&["--vault", &vault, "onboard", "apply"], &picksJson)
}

/// `prevail --vault <vault> vault backup [--domain X] --json`
///
/// `domain_opt` limits the backup to a single domain when `Some`; the whole
/// vault is backed up when `None`. Returns a `BackupResult`.
#[tauri::command]
pub fn engine_vault_backup(
    vault: String,
    #[allow(non_snake_case)] domainOpt: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<&str> = vec!["--vault", &vault, "vault", "backup"];
    if let Some(ref d) = domainOpt {
        if !d.is_empty() {
            args.push("--domain");
            args.push(d);
        }
    }
    run_engine_json(&args)
}

/// `prevail --vault <vault> vault archive <domain> --json`
/// Archives a domain (sets `archived: true`). Never deletes data.
/// Returns `{ "ok": true }`.
#[tauri::command]
pub fn engine_vault_archive(
    vault: String,
    domain: String,
) -> Result<serde_json::Value, String> {
    run_engine_json(&["--vault", &vault, "vault", "archive", &domain])
}

/// `prevail --vault <vault> vault restore <domain> --json`
/// Un-archives a domain. Returns `{ "ok": true }`.
#[tauri::command]
pub fn engine_vault_restore(
    vault: String,
    domain: String,
) -> Result<serde_json::Value, String> {
    run_engine_json(&["--vault", &vault, "vault", "restore", &domain])
}

/// `prevail --vault <vault> vault list-archived --json`
/// Returns the array of archived domain names. Tolerates the CLI wrapping
/// the list in `{ "domains": [...] }` or returning a bare array.
#[tauri::command]
pub fn engine_list_archived(vault: String) -> Result<Vec<String>, String> {
    let value = run_engine_json(&["--vault", &vault, "vault", "list-archived"])?;
    let arr = if value.is_array() {
        value
    } else if let Some(d) = value.get("domains").cloned() {
        d
    } else if let Some(d) = value.get("archived").cloned() {
        d
    } else {
        return Err("unexpected shape from `prevail vault list-archived`".to_string());
    };
    serde_json::from_value::<Vec<String>>(arr)
        .map_err(|e| format!("failed to decode archived list: {e}"))
}

/// `prevail --vault <vault> manifest set <domain> --json` (manifest JSON on stdin).
///
/// `json` is a partial or full `DomainManifest`; the engine deep-merges it
/// onto the existing manifest. Returns the resulting `DomainManifest`.
#[tauri::command]
pub fn engine_manifest_set(
    vault: String,
    domain: String,
    json: String,
) -> Result<serde_json::Value, String> {
    run_engine_json_stdin(&["--vault", &vault, "manifest", "set", &domain], &json)
}

// ─────────────────────────────────────────────────────────────────────
// Unified chat through the engine (Track D5).
//
// `prevail --vault <vault> chat --domain <domain> --json` runs a single
// chat turn against the domain's configured engine and emits a ChatEvent
// NDJSON stream on stdout (see fd-apps-prevail-cli/docs/schemas/ChatEvent.json:
// start / user / delta / assistant / tool / usage / done / error).
//
// The user message is passed on stdin so multi-line / arbitrary content
// needs no shell-quoting. Optional `cli` / `model` override the manifest's
// configured engine for this turn; `localOnly` forces a local engine
// (privacy). Events are streamed back via `engine-chat:line` /
// `engine-chat:done` (reusing the run_engine_stream_stdin plumbing).
//
// This is ADDITIVE: the existing native `chat_send` path is untouched.
// The desktop prefers this engine path when the `prevail` CLI is present
// and falls back to `chat_send` otherwise.

/// `prevail --vault <vault> chat --domain <domain> [--cli X] [--model Y]
///  [--local-only] --json` (message on stdin).
///
/// Streams ChatEvent NDJSON to the frontend on `engine-chat:line` and
/// closes with `engine-chat:done`.
#[tauri::command]
pub async fn engine_chat(
    app: tauri::AppHandle,
    session: String,
    vault: String,
    domain: String,
    message: String,
    cli: Option<String>,
    model: Option<String>,
    #[allow(non_snake_case)] localOnly: Option<bool>,
) -> Result<(), String> {
    // Build the arg vector. `--vault V` goes BEFORE the subcommand,
    // matching every other engine command here.
    let mut args: Vec<String> = vec![
        "--vault".to_string(),
        vault,
        "chat".to_string(),
        "--domain".to_string(),
        domain,
    ];
    // Bunker Mode: refuse cloud providers, and force the engine local-only
    // regardless of the per-domain toggle so a cloud model can never run.
    let bunker = crate::bunker::bunker_enabled();
    // Auto-switch a stale cloud selection to an available local provider rather
    // than hard-blocking; errors only when nothing local can serve the request.
    let mut switched = false;
    let mut extra_env: Vec<(&'static str, String)> = Vec::new();
    if let Some(c) = cli.filter(|s| !s.is_empty()) {
        let eff = crate::bunker::resolve_cli(&c)?;
        switched = eff != c;
        // LM Studio / MLX are OpenAI-compatible local servers the engine reaches
        // through its `ollama` provider path. Pass `--cli ollama` and redirect
        // PREVAIL_OLLAMA_URL to the right port — no engine-side change needed.
        if let Some(url) = crate::bunker::local_endpoint_url(&eff) {
            extra_env.push(("PREVAIL_OLLAMA_URL", url.to_string()));
            args.push("--cli".to_string());
            args.push("ollama".to_string());
        } else {
            args.push("--cli".to_string());
            args.push(eff);
        }
    }
    // Drop the model when we switched providers — the requested id belongs to the
    // old (cloud) CLI; let the engine pick the local provider's default.
    if !switched {
        if let Some(m) = model.filter(|s| !s.is_empty()) {
            args.push("--model".to_string());
            args.push(m);
        }
    }
    if bunker || localOnly.unwrap_or(false) {
        args.push("--local-only".to_string());
    }

    run_engine_stream_stdin(app, session, args, message, "engine-chat", extra_env).await
}
