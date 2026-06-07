// Prevail desktop — Rust backend.
//
// v0.1 deliberately does NOT bundle the prevail CLI as a sidecar. Every
// cockpit feature is reimplemented natively:
//   - vault scanning via std::fs + walkdir
//   - CLI invocation via tauri-plugin-shell (spawns the user's existing
//     claude / codex / agy / ollama binaries from PATH)
//   - benchmark run loading via serde_json over results.json + score.json
//
// This keeps the desktop installable with zero CLI prereqs beyond
// whatever AI CLIs the user already has, and avoids the bundled-sidecar
// signing complexity for the first release.

mod engine;
mod ingestion;
mod telegram_bridge;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;
#[allow(unused_imports)]
use tauri_plugin_shell::ShellExt;

// Registry of running spawned children keyed by session id (or session
// prefix for council slots/score). Used so the React side can abort a
// long-running run.
fn child_registry() -> &'static Mutex<HashMap<String, u32>> {
    static REG: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}
fn register_child(session: &str, pid: u32) {
    if let Ok(mut g) = child_registry().lock() {
        g.insert(session.to_string(), pid);
    }
}
fn unregister_child(session: &str) {
    if let Ok(mut g) = child_registry().lock() {
        g.remove(session);
    }
}

// Kill every running child whose registry key starts with `prefix`.
// Returns the number of processes signalled.
#[tauri::command]
fn abort_sessions(prefix: String) -> Result<usize, String> {
    let pids: Vec<(String, u32)> = match child_registry().lock() {
        Ok(g) => g.iter()
            .filter(|(k, _)| k.starts_with(&prefix))
            .map(|(k, v)| (k.clone(), *v))
            .collect(),
        Err(_) => return Err("registry poisoned".into()),
    };
    let mut killed = 0;
    for (key, pid) in &pids {
        // Use libc::kill on Unix; on Windows we'd use TerminateProcess.
        #[cfg(unix)]
        unsafe {
            // SIGTERM first; tokio's wait will pick up the exit and emit
            // benchmark:done / chat:done.
            libc::kill(*pid as i32, libc::SIGTERM);
        }
        unregister_child(key);
        killed += 1;
    }
    Ok(killed)
}

// ─────────────────────────────────────────────────────────────────────
// Vault scanning

#[derive(Serialize, Clone)]
pub struct Domain {
    pub name: String,
    pub path: String,
    pub has_state: bool,
    pub state_preview: Option<String>,
}

const NON_DOMAIN_DIRS: &[&str] = &[
    "benchmark",
    "apps",
    ".git",
    ".DS_Store",
    "node_modules",
    "_archive",
    "_scratch",
];

// Retry I/O on EINTR (os error 4). macOS sandboxing + Tauri's runtime
// can interrupt syscalls; the fix is the standard retry-on-EINTR loop.
fn read_dir_retry(p: &Path) -> std::io::Result<fs::ReadDir> {
    for _ in 0..5 {
        match fs::read_dir(p) {
            Ok(it) => return Ok(it),
            Err(e) if e.raw_os_error() == Some(4) => continue,
            Err(e) => return Err(e),
        }
    }
    fs::read_dir(p)
}
fn read_to_string_retry(p: &Path) -> std::io::Result<String> {
    for _ in 0..5 {
        match fs::read_to_string(p) {
            Ok(s) => return Ok(s),
            Err(e) if e.raw_os_error() == Some(4) => continue,
            Err(e) => return Err(e),
        }
    }
    fs::read_to_string(p)
}

/// Pull a short, human-meaningful summary from a domain's state.md for card
/// previews. Skips the H1 title, blockquote synthetic-data warnings, horizontal
/// rules, code fences and blank lines, then takes the first couple of real
/// content lines (typically the `**Key:** value` metadata) with markdown
/// markers stripped. Returns None if nothing meaningful is found.
fn meaningful_preview(md: &str) -> Option<String> {
    // Strip a leading YAML frontmatter block (--- … ---) so v2 `_state.md`
    // provenance (`derived_from:` etc.) never leaks into the card preview.
    let mut lines: Vec<&str> = md.lines().collect();
    if lines.first().map(|l| l.trim()) == Some("---") {
        if let Some(end) = lines.iter().skip(1).position(|l| l.trim() == "---") {
            lines = lines.split_off(end + 2); // drop through the closing `---`
        }
    }
    let mut picked: Vec<String> = Vec::new();
    for raw in lines {
        let line = raw.trim();
        if line.is_empty()
            || line.starts_with('#')
            || line.starts_with('>')
            || line.starts_with("---")
            || line.starts_with("```")
        {
            continue;
        }
        let cleaned = line
            .replace("**", "")
            .replace('`', "")
            .trim_start_matches(|c: char| c == '-' || c == '*' || c == ' ')
            .trim()
            .to_string();
        if cleaned.is_empty() {
            continue;
        }
        picked.push(cleaned);
        if picked.len() >= 2 {
            break;
        }
    }
    if picked.is_empty() {
        None
    } else {
        Some(picked.join(" · "))
    }
}

#[tauri::command]
fn scan_vault(path: String) -> Result<Vec<Domain>, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("vault path does not exist: {}", path));
    }
    let entries = read_dir_retry(&root).map_err(|e| e.to_string())?;
    let mut domains: Vec<Domain> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || NON_DOMAIN_DIRS.contains(&name.as_str()) {
            continue;
        }
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        // Domain detection — forward + backward compatible across the v1→v2
        // migration. v2: a folder is a domain because the human declared intent
        // (`soul.md`). v1: detected by hand-written `state.md`. Transition: the
        // agent's derived `_state.md`. Any of the three makes it a domain.
        let soul_path = p.join("soul.md");
        let state_v2 = p.join("_state.md"); // v2 derived snapshot
        let state_v1 = p.join("state.md"); // v1 hand-written snapshot
        let is_domain = soul_path.exists() || state_v2.exists() || state_v1.exists();
        if !is_domain {
            continue;
        }
        // "has_state" now means a usable snapshot exists (derived or legacy).
        let has_state = state_v2.exists() || state_v1.exists();
        // Preview prefers the v2 derived snapshot, falls back to v1, then to soul.
        let preview_src = if state_v2.exists() {
            state_v2
        } else if state_v1.exists() {
            state_v1
        } else {
            soul_path
        };
        let state_preview = read_to_string_retry(&preview_src)
            .ok()
            .and_then(|s| meaningful_preview(&s));
        domains.push(Domain {
            name,
            path: p.to_string_lossy().to_string(),
            has_state,
            state_preview,
        });
    }
    domains.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(domains)
}

// ─────────────────────────────────────────────────────────────────────
// CLI detection

#[derive(Serialize, Clone)]
pub struct CliInfo {
    pub id: String,
    pub label: String,
    pub bin: String,
    pub available: bool,
    pub version: Option<String>,
}

const CLIS: &[(&str, &str, &str)] = &[
    ("claude", "Claude", "claude"),
    ("codex", "Codex", "codex"),
    ("antigravity", "Antigravity", "agy"),
    ("ollama", "Ollama", "ollama"),
];

fn resolve_bin_path(bin: &str) -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.local/bin/{bin}"),
        format!("{home}/.bun/bin/{bin}"),
        format!("/opt/homebrew/bin/{bin}"),
        format!("/usr/local/bin/{bin}"),
        format!("/usr/bin/{bin}"),
    ];
    candidates.into_iter().find(|p| Path::new(p).exists())
}

fn probe_cli_version(bin: &str) -> Option<String> {
    let path = resolve_bin_path(bin)?;
    use std::process::Command;
    // Pass the same enriched env chat_send uses — PATH so env-node
    // shebangs resolve, USER/LOGNAME so claude finds its keychain.
    let (combined, user, logname) = build_cli_env();
    let out = Command::new(&path)
        .arg("--version")
        .env("PATH", combined)
        .env("USER", user)
        .env("LOGNAME", logname)
        .output()
        .ok()?;
    let text = if !out.stdout.is_empty() {
        String::from_utf8_lossy(&out.stdout).to_string()
    } else if !out.stderr.is_empty() {
        String::from_utf8_lossy(&out.stderr).to_string()
    } else {
        return None;
    };
    let first = text.lines().next()?.trim();
    if first.is_empty() {
        return None;
    }
    Some(first.to_string())
}

fn find_in_known_paths(bin: &str) -> bool {
    // Mac apps launched from Finder inherit a minimal PATH from
    // launchctl (/usr/bin:/bin:/usr/sbin:/sbin), which excludes the
    // usual CLI install locations. Probe them explicitly.
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.local/bin/{bin}"),
        format!("{home}/.bun/bin/{bin}"),
        format!("/opt/homebrew/bin/{bin}"),
        format!("/usr/local/bin/{bin}"),
        format!("/usr/bin/{bin}"),
    ];
    candidates.iter().any(|p| Path::new(p).exists())
}

#[tauri::command]
async fn detect_clis(_app: tauri::AppHandle) -> Result<Vec<CliInfo>, String> {
    let mut out = Vec::new();
    for (id, label, bin) in CLIS {
        // Special-case ollama: it runs as a daemon, the `ollama` binary
        // is optional. Treat the daemon port as the source of truth.
        let available = if *id == "ollama" {
            // Probe the local API. Tiny HEAD-ish check via TCP — we
            // don't pull in reqwest just for this; a TcpStream connect
            // is enough to know the daemon is up.
            use std::net::TcpStream;
            use std::time::Duration;
            TcpStream::connect_timeout(
                &"127.0.0.1:11434".parse().unwrap(),
                Duration::from_millis(250),
            )
            .is_ok()
                || find_in_known_paths(bin)
        } else {
            find_in_known_paths(bin)
        };
        let version = if available { probe_cli_version(bin) } else { None };
        out.push(CliInfo {
            id: id.to_string(),
            label: label.to_string(),
            bin: bin.to_string(),
            available,
            version,
        });
    }
    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────
// Chat — spawn a CLI with a prompt, stream output back via events

#[derive(Deserialize)]
pub struct ChatArgs {
    pub cli: String,        // "claude" | "codex" | "antigravity" | "ollama"
    pub prompt: String,
    pub session_id: String, // unique id so the UI knows which session each chunk belongs to
    #[serde(default)]
    pub model: Option<String>,
    // Hard cap on how long the child is allowed to run. After this
    // expires the child is killed and chat:done emits with a synthetic
    // code so the UI can show a "timed out" reply rather than a hang.
    #[serde(default)]
    pub timeout_sec: Option<u64>,
}

fn cli_args(cli: &str, prompt: &str, model: Option<&str>) -> (String, Vec<String>) {
    // Match the prevail CLI's dispatch table. -p / --prompt for one-shot
    // non-interactive mode. When `model` is supplied, inject the right
    // flag for each vendor (ollama uses a positional arg, the rest use
    // --model <id>).
    match cli {
        "claude" => {
            let mut v = vec!["--dangerously-skip-permissions".to_string()];
            if let Some(m) = model {
                v.push("--model".to_string());
                v.push(m.to_string());
            }
            v.push("-p".to_string());
            // `--` ends option parsing so a prompt that starts with "--"
            // (e.g. the "--- Conversation so far ---" preamble) is treated as
            // the positional prompt, not an unknown flag.
            v.push("--".to_string());
            v.push(prompt.to_string());
            ("claude".to_string(), v)
        }
        "codex" => {
            let mut v = vec!["exec".to_string(), "--skip-git-repo-check".to_string()];
            if let Some(m) = model {
                // Model id may carry a reasoning-effort suffix as
                // "<model>@<effort>" (e.g. "gpt-5.5@high"). Split it off
                // and pass the effort via `-c model_reasoning_effort`,
                // since codex has no per-model "high" id.
                let (base, effort) = match m.split_once('@') {
                    Some((b, e)) => (b, Some(e)),
                    None => (m, None),
                };
                v.push("--model".to_string());
                v.push(base.to_string());
                if let Some(e) = effort {
                    v.push("-c".to_string());
                    v.push(format!("model_reasoning_effort={e}"));
                }
            }
            v.push("--".to_string()); // end options — prompt may start with "--"
            v.push(prompt.to_string());
            ("codex".to_string(), v)
        }
        "antigravity" => {
            let mut v = vec!["--dangerously-skip-permissions".to_string()];
            if let Some(m) = model {
                v.push("--model".to_string());
                v.push(m.to_string());
            }
            v.push("-p".to_string());
            v.push("--".to_string()); // end options — prompt may start with "--"
            v.push(prompt.to_string());
            ("agy".to_string(), v)
        }
        "ollama" => {
            // ollama uses positional model arg. Fall back to llama3.2.
            let m = model.unwrap_or("llama3.2");
            (
                "ollama".to_string(),
                // `--` ends options — prompt may start with "--".
                vec!["run".to_string(), m.to_string(), "--".to_string(), prompt.to_string()],
            )
        }
        _ => ("echo".to_string(), vec![format!("unknown cli: {}", cli)]),
    }
}

/// Build the env vars every spawned CLI inherits.
///
/// Returns (combined_path, user, logname).
///
/// PATH is enriched with the well-known CLI install dirs so a
/// `#!/usr/bin/env node` shebang resolves even when Finder-launched
/// apps get a launchctl-minimal PATH.
///
/// USER + LOGNAME are derived from $HOME's basename when not present
/// in the environment, because claude in particular uses them to
/// scope its macOS Keychain lookup — without them set, claude
/// silently treats the user as logged out and returns nothing.
pub(crate) fn build_cli_env() -> (String, String, String) {
    let home = std::env::var("HOME").unwrap_or_default();
    let extra_path = format!(
        "{home}/.local/bin:{home}/.bun/bin:/opt/homebrew/bin:/usr/local/bin"
    );
    let cur_path = std::env::var("PATH").unwrap_or_default();
    let combined = if cur_path.is_empty() {
        extra_path
    } else {
        format!("{extra_path}:{cur_path}")
    };
    let user_from_env = std::env::var("USER").ok();
    let logname_from_env = std::env::var("LOGNAME").ok();
    let fallback = std::path::Path::new(&home)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let user = user_from_env.filter(|s| !s.is_empty()).unwrap_or_else(|| fallback.clone());
    let logname = logname_from_env.filter(|s| !s.is_empty()).unwrap_or_else(|| fallback);
    (combined, user, logname)
}

pub(crate) fn resolve_bin_abs(bin: &str) -> String {
    // Mirror the detection logic — find the binary's absolute path so
    // we can spawn it even when the Finder-launched app has minimal
    // PATH. Falls back to the bare name (tokio will use PATH).
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.local/bin/{bin}"),
        format!("{home}/.bun/bin/{bin}"),
        format!("/opt/homebrew/bin/{bin}"),
        format!("/usr/local/bin/{bin}"),
        format!("/usr/bin/{bin}"),
    ];
    for c in &candidates {
        if Path::new(c).exists() {
            return c.clone();
        }
    }
    bin.to_string()
}

#[tauri::command]
async fn chat_send(
    app: tauri::AppHandle,
    args: ChatArgs,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command as TokioCommand;

    let (bin_name, cli_args) = cli_args(&args.cli, &args.prompt, args.model.as_deref());
    let bin_abs = resolve_bin_abs(&bin_name);

    let (combined_path, user, logname) = build_cli_env();

    let mut child = TokioCommand::new(&bin_abs)
        .args(&cli_args)
        .env("PATH", combined_path)
        // USER + LOGNAME — claude reads these to scope its macOS
        // Keychain lookup. Finder-launched GUI apps inherit from
        // launchctl which may leave them blank, which makes claude
        // think no user is logged in and reply "(empty)". Pinning
        // them to the real user fixes the silent-reply bug.
        .env("USER", &user)
        .env("LOGNAME", &logname)
        // Closing stdin so claude/codex/etc don't sit waiting for it.
        // claude in particular prints "no stdin data received in 3s,
        // proceeding without it." to stderr and stalls before emitting
        // the actual reply when inherited stdin is invalid (Finder GUI
        // apps have no controlling terminal).
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn {bin_abs} failed: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let session = args.session_id.clone();
    let cli = args.cli.clone();
    let session_done = session.clone();
    let cli_done = cli.clone();
    if let Some(pid) = child.id() {
        register_child(&session, pid);
    }

    if let Some(s) = stdout {
        let app2 = app.clone();
        let session2 = session.clone();
        let cli2 = cli.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(s);
            let mut buf = [0u8; 4096];
            use tokio::io::AsyncReadExt;
            loop {
                match reader.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app2.emit(
                            "chat:chunk",
                            serde_json::json!({
                                "session": session2,
                                "cli": cli2,
                                "stream": "stdout",
                                "data": text,
                            }),
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }
    if let Some(s) = stderr {
        let app2 = app.clone();
        let session2 = session.clone();
        let cli2 = cli.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit(
                    "chat:chunk",
                    serde_json::json!({
                        "session": session2,
                        "cli": cli2,
                        "stream": "stderr",
                        "data": format!("{line}\n"),
                    }),
                );
            }
        });
    }
    let timeout_sec = args.timeout_sec;
    tauri::async_runtime::spawn(async move {
        use tokio::time::{timeout, Duration};
        let result = match timeout_sec {
            Some(secs) if secs > 0 => timeout(Duration::from_secs(secs), child.wait()).await,
            _ => Ok(child.wait().await),
        };
        let (code, timed_out) = match result {
            Ok(Ok(status)) => (status.code(), false),
            Ok(Err(_)) => (None, false),
            Err(_) => {
                // Hard cap hit — kill the child so it doesn't linger.
                let _ = child.kill().await;
                (Some(124), true) // 124 mirrors GNU coreutils' `timeout` exit code
            }
        };
        unregister_child(&session_done);
        if timed_out {
            let _ = app.emit(
                "chat:chunk",
                serde_json::json!({
                    "session": session_done,
                    "cli": cli_done,
                    "stream": "stderr",
                    "data": format!("[prevail] killed: exceeded timeout ({}s)\n", timeout_sec.unwrap_or(0)),
                }),
            );
        }
        let _ = app.emit(
            "chat:done",
            serde_json::json!({
                "session": session_done,
                "cli": cli_done,
                "code": code,
                "timed_out": timed_out,
            }),
        );
    });
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────
// Benchmark — read saved runs from <vault>/benchmark/runs/

#[derive(Serialize)]
pub struct BenchmarkRun {
    pub label: String,
    pub run_dir: String,
    pub judge_avg: Option<f64>,
    pub keyword_avg: Option<f64>,
    pub questions: usize,
}

#[derive(Deserialize)]
struct ScoreFile {
    label: String,
    #[serde(rename = "runDir")]
    run_dir: String,
    #[serde(rename = "judge_avg")]
    judge_avg: Option<f64>,
    #[serde(rename = "keyword_avg")]
    keyword_avg: Option<f64>,
    #[serde(rename = "questionScores")]
    question_scores: Vec<serde_json::Value>,
}

#[tauri::command]
fn benchmark_runs(vault: String) -> Result<Vec<BenchmarkRun>, String> {
    let runs_dir = Path::new(&vault).join("benchmark").join("runs");
    if !runs_dir.exists() {
        return Ok(vec![]);
    }
    let entries = fs::read_dir(&runs_dir).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let score_file = p.join("score.json");
        if !score_file.exists() {
            continue;
        }
        if let Ok(raw) = fs::read_to_string(&score_file) {
            if let Ok(parsed) = serde_json::from_str::<ScoreFile>(&raw) {
                out.push(BenchmarkRun {
                    label: parsed.label,
                    run_dir: parsed.run_dir,
                    judge_avg: parsed.judge_avg,
                    keyword_avg: parsed.keyword_avg,
                    questions: parsed.question_scores.len(),
                });
            }
        }
    }
    out.sort_by(|a, b| {
        let aj = a.judge_avg.unwrap_or(-1.0);
        let bj = b.judge_avg.unwrap_or(-1.0);
        bj.partial_cmp(&aj).unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

#[tauri::command]
fn benchmark_run_detail(run_dir: String) -> Result<serde_json::Value, String> {
    let results_file = Path::new(&run_dir).join("results.json");
    let score_file = Path::new(&run_dir).join("score.json");
    let results = fs::read_to_string(&results_file)
        .map_err(|e| format!("results.json: {e}"))?;
    let score = fs::read_to_string(&score_file).map_err(|e| format!("score.json: {e}"))?;
    let results_v: serde_json::Value = serde_json::from_str(&results).map_err(|e| e.to_string())?;
    let score_v: serde_json::Value = serde_json::from_str(&score).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "records": results_v,
        "score": score_v,
    }))
}

// ─────────────────────────────────────────────────────────────────────
// Read state.md / log files for a domain

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read {}: {}", path, e))
}

// Diagnostic: the frontend's fatal-error handler writes the crash here so
// production render failures (blank window) are inspectable from disk.
#[tauri::command]
fn log_fatal(msg: String) {
    let _ = fs::write("/tmp/prevail-fatal.log", msg);
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

// Where we remember the last-chosen vault so it survives a webview-cache
// wipe (which clears localStorage). Read on boot as a fallback.
fn bootstrap_vault_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(Path::new(&home).join("Library/Application Support/sh.prevail.desktop/bootstrap-vault.txt"))
}

fn write_bootstrap_vault(path: &str) {
    if let Some(bf) = bootstrap_vault_path() {
        if let Some(p) = bf.parent() {
            let _ = fs::create_dir_all(p);
        }
        let _ = fs::write(&bf, path);
    }
}

/// Copy the bundled sample vault into the user's Documents and return its
/// path, so a new user can explore every feature without creating domains.
#[tauri::command]
fn import_sample_vault(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let src = app
        .path()
        .resolve("resources/sample-vault", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve sample resource: {e}"))?;
    if !src.exists() {
        return Err(format!("bundled sample vault not found at {}", src.display()));
    }
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let dest = Path::new(&home).join("Documents/Prevail Sample Vault");
    if dest.exists() {
        let _ = fs::remove_dir_all(&dest);
    }
    copy_dir_recursive(&src, &dest).map_err(|e| format!("copy sample vault: {e}"))?;
    let dest_str = dest.to_string_lossy().to_string();
    write_bootstrap_vault(&dest_str);
    Ok(dest_str)
}

/// Persist the chosen vault path so it survives a cache wipe.
#[tauri::command]
fn remember_vault(path: String) {
    write_bootstrap_vault(&path);
}

/// Boot fallback: the last vault we remembered (when localStorage was wiped).
#[tauri::command]
fn bootstrap_vault() -> Option<String> {
    let bf = bootstrap_vault_path()?;
    let s = fs::read_to_string(&bf).ok()?;
    let s = s.trim();
    if s.is_empty() || !Path::new(s).exists() {
        return None;
    }
    Some(s.to_string())
}

// Create a new domain folder under the vault root. Writes a minimal
// state.md skeleton so scan_vault picks it up immediately.
#[tauri::command]
fn create_domain(vault: String, name: String) -> Result<Domain, String> {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        return Err("name cannot be empty".into());
    }
    let root = PathBuf::from(&vault);
    if !root.exists() {
        return Err(format!("vault not found: {vault}"));
    }
    let domain_dir = root.join(&slug);
    if domain_dir.exists() {
        return Err(format!("domain '{slug}' already exists"));
    }
    fs::create_dir_all(&domain_dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let title = slug
        .split('-')
        .map(|p| {
            let mut c = p.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    let stub = format!(
        "# {title}\n\n_State for the {title} domain. Edit freely._\n\n## Current focus\n\n- (none yet)\n\n## Open decisions\n\n- (none yet)\n"
    );
    let state_path = domain_dir.join("state.md");
    fs::write(&state_path, &stub).map_err(|e| format!("write state.md failed: {e}"))?;
    Ok(Domain {
        name: slug,
        path: domain_dir.to_string_lossy().to_string(),
        has_state: true,
        state_preview: Some(stub.chars().take(120).collect()),
    })
}

// Open a path in the OS default file manager (Finder on macOS).
#[tauri::command]
async fn open_in_finder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let bin = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    app.shell()
        .command(bin)
        .args([&path])
        .output()
        .await
        .map_err(|e| format!("open failed: {e}"))?;
    Ok(())
}

// List skill folders detected for a given vault. Returns a flat list
// where each entry has its parent domain inferred from the path.
#[derive(Serialize, Clone)]
pub struct SkillEntry {
    pub domain: String,
    pub name: String,
    pub path: String,
    pub description: Option<String>,
}

// Skip leading YAML frontmatter + heading lines, then return the first
// meaningful prose line as the skill description. Frontmatter is a
// block bounded by `---` lines at the very start of the file.
fn extract_skill_description(body: &str) -> Option<String> {
    let mut lines = body.lines().peekable();
    // Detect and consume frontmatter only if it starts on line 1.
    if let Some(first) = lines.peek() {
        if first.trim() == "---" {
            lines.next();
            while let Some(l) = lines.next() {
                if l.trim() == "---" { break; }
                // Also pull "description: …" out of YAML if present.
                let lt = l.trim();
                if let Some(rest) = lt.strip_prefix("description:") {
                    let val = rest.trim().trim_matches('"').trim();
                    if !val.is_empty() {
                        return Some(val.chars().take(140).collect());
                    }
                }
            }
        }
    }
    for l in lines {
        let t = l.trim();
        if t.is_empty() { continue; }
        if t.starts_with('#') { continue; }
        if t.starts_with("```") { continue; }
        // Strip any leading markdown markers (`-`, `*`, `>`, etc.)
        // so the description reads like prose.
        let cleaned = t
            .trim_start_matches(|c: char| c == '-' || c == '*' || c == '>' || c == ' ')
            .trim();
        if cleaned.len() < 3 { continue; }
        return Some(cleaned.chars().take(140).collect());
    }
    None
}

// Read the full content of a single skill (SKILL.md, README.md, or
// skill.md — whichever is present). Used by the Skills tab to expand
// a skill inline so the user can read its contents.
#[tauri::command]
fn read_skill(path: String) -> Result<String, String> {
    let dir = PathBuf::from(&path);
    for candidate in &["SKILL.md", "README.md", "skill.md"] {
        let f = dir.join(candidate);
        if f.exists() {
            return read_to_string_retry(&f).map_err(|e| e.to_string());
        }
    }
    Err(format!("no SKILL.md/README.md/skill.md in {}", dir.display()))
}

// Pre-flight verification — spawn the CLI with a tiny "respond: ok"
// prompt and the specified model. Returns Ok(reply) on success or
// Err(message) on failure. Short timeout (10s) so verification doesn't
// block the UI.
#[derive(Deserialize)]
pub struct VerifyArgs {
    pub cli: String,
    pub model: Option<String>,
}
#[tauri::command]
async fn verify_cli_model(args: VerifyArgs) -> Result<String, String> {
    use tokio::io::AsyncReadExt;
    use tokio::process::Command as TokioCommand;
    use tokio::time::{timeout, Duration};

    let (bin_name, cli_args) = cli_args(&args.cli, "respond with just: OK", args.model.as_deref());
    let bin_abs = resolve_bin_abs(&bin_name);
    let (combined_path, user, logname) = build_cli_env();

    let mut child = TokioCommand::new(&bin_abs)
        .args(&cli_args)
        .env("PATH", combined_path)
        .env("USER", &user)
        .env("LOGNAME", &logname)
        // Closing stdin so claude/codex/etc don't sit waiting for it.
        // claude in particular prints "no stdin data received in 3s,
        // proceeding without it." to stderr and stalls before emitting
        // the actual reply when inherited stdin is invalid (Finder GUI
        // apps have no controlling terminal).
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn {bin_abs} failed: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;

    let fut = async move {
        let mut out = Vec::new();
        let mut err = Vec::new();
        let _ = stdout.read_to_end(&mut out).await;
        let _ = stderr.read_to_end(&mut err).await;
        let code = child.wait().await.ok().and_then(|s| s.code()).unwrap_or(-1);
        (code, String::from_utf8_lossy(&out).into_owned(), String::from_utf8_lossy(&err).into_owned())
    };

    match timeout(Duration::from_secs(30), fut).await {
        Ok((code, out, err)) => {
            if code == 0 && !out.trim().is_empty() {
                Ok(out.trim().chars().take(200).collect())
            } else {
                let msg = best_error_line(&err, &out);
                Err(format!("exit {code}: {msg}"))
            }
        }
        Err(_) => Err("verification timed out after 30s".into()),
    }
}

/// Pick the most useful error line out of a CLI's combined output.
///
/// Lots of CLIs (claude, codex) print a startup banner + harmless
/// notices on stderr before the real error. Naively grabbing the
/// FIRST line surfaces noise like "Reading additional input from
/// stdin..." or "OpenAI Codex v0.136.0". We instead scan from the
/// END looking for a line that carries an error keyword. Falling
/// back to the first stderr line, then the first stdout line, then
/// a generic "(no output)".
fn best_error_line(stderr: &str, stdout: &str) -> String {
    fn looks_like_error(s: &str) -> bool {
        let lower = s.to_ascii_lowercase();
        // Anything containing one of these is more useful than a banner.
        let needles = [
            "error", "invalid", "unsupported", "denied", "forbidden",
            "401", "402", "403", "404", "429", "5", "quota", "rate",
            "limit", "not supported", "not found", "missing", "fail",
            "auth", "unauthor", "no such", "cannot", "expired",
        ];
        // Banners + transient notices we want to skip.
        let banner_prefixes = [
            "reading additional input from stdin",
            "warning: no stdin data received",
            "openai codex v",
            "claude ",
        ];
        if banner_prefixes.iter().any(|p| lower.starts_with(p)) {
            return false;
        }
        needles.iter().any(|n| lower.contains(n))
    }

    let stderr_trim = stderr.trim();
    let stdout_trim = stdout.trim();

    // Walk stderr lines in reverse — the deepest line is usually the
    // root cause; earlier lines are scaffolding.
    for line in stderr_trim.lines().rev() {
        let l = line.trim();
        if l.is_empty() { continue; }
        if looks_like_error(l) {
            return clamp(l);
        }
    }
    for line in stdout_trim.lines().rev() {
        let l = line.trim();
        if l.is_empty() { continue; }
        if looks_like_error(l) {
            return clamp(l);
        }
    }

    // Nothing matched our heuristic — fall back to the first
    // non-banner stderr line. Strip the noisy stdin-wait notice
    // that several CLIs emit.
    for line in stderr_trim.lines() {
        let l = line.trim();
        if l.is_empty() { continue; }
        let lower = l.to_ascii_lowercase();
        if lower.starts_with("reading additional input from stdin") { continue; }
        if lower.starts_with("warning: no stdin data received") { continue; }
        return clamp(l);
    }
    for line in stdout_trim.lines() {
        let l = line.trim();
        if !l.is_empty() { return clamp(l); }
    }
    "(no output)".to_string()
}

fn clamp(s: &str) -> String {
    // Keep error pills readable but useful — JSON errors can be long.
    s.chars().take(240).collect()
}

// User-level context — a single `<vault>/user.md` that captures who
// the user is, persistent preferences, recurring details. Mirrors the
// OpenClaw / Hermes user-profile pattern. Read/write via these calls.
#[tauri::command]
fn read_user_md(vault: String) -> Result<String, String> {
    let p = PathBuf::from(&vault).join("user.md");
    if !p.exists() { return Ok(String::new()); }
    read_to_string_retry(&p).map_err(|e| e.to_string())
}
#[tauri::command]
fn write_user_md(vault: String, body: String) -> Result<(), String> {
    let p = PathBuf::from(&vault).join("user.md");
    fs::write(&p, body).map_err(|e| format!("write user.md: {e}"))
}

#[tauri::command]
fn write_paste_attachment(vault: String, body: String) -> Result<String, String> {
    let dir = PathBuf::from(&vault).join("_paste");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir _paste: {e}"))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, m, d, hh, mm, ss) = secs_to_ymdhms(now as i64);
    let name = format!("{y:04}-{m:02}-{d:02}_{hh:02}-{mm:02}-{ss:02}.txt");
    let p = dir.join(&name);
    fs::write(&p, body).map_err(|e| format!("write paste: {e}"))?;
    Ok(p.to_string_lossy().to_string())
}

// Save a chat session as a markdown transcript under <domain>/_log/.
// Filename format: YYYY-MM-DD_HH-MM-SS_session.md so directory listings
// sort newest-last and the user can scan when each happened. Nothing is
// thrown away — every prompt + reply is appended.
#[derive(Deserialize)]
pub struct SessionTurn {
    pub role: String,
    pub cli: Option<String>,
    pub model: Option<String>,
    pub content: String,
}
#[tauri::command]
fn save_session(
    vault: String,
    domain: Option<String>,
    title: Option<String>,
    turns: Vec<SessionTurn>,
) -> Result<String, String> {
    if turns.is_empty() {
        return Err("session is empty".into());
    }
    let log_dir = match domain.clone() {
        Some(d) => PathBuf::from(&vault).join(&d).join("_log"),
        None => PathBuf::from(&vault).join("_log"),
    };
    fs::create_dir_all(&log_dir).map_err(|e| format!("mkdir _log: {e}"))?;
    // Use chrono-free timestamp by formatting from std time.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // YYYY-MM-DD_HH-MM-SS via a tiny formatter.
    let secs = now as i64;
    let (year, month, day, hh, mm, ss) = secs_to_ymdhms(secs);
    let stem = format!("{year:04}-{month:02}-{day:02}_{hh:02}-{mm:02}-{ss:02}");
    let file = log_dir.join(format!("{stem}_session.md"));
    let mut body = String::new();
    body.push_str("---\n");
    if let Some(t) = &title { body.push_str(&format!("title: {t}\n")); }
    if let Some(d) = &domain { body.push_str(&format!("domain: {d}\n")); }
    body.push_str(&format!("turns: {}\n", turns.len()));
    body.push_str("---\n\n");
    for t in &turns {
        let speaker = if t.role == "user" {
            "You".to_string()
        } else {
            let cli = t.cli.as_deref().unwrap_or("assistant");
            let model = t.model.as_deref().map(|m| format!(" · {m}")).unwrap_or_default();
            format!("{cli}{model}")
        };
        body.push_str(&format!("## {speaker}\n\n{}\n\n", t.content.trim()));
    }
    fs::write(&file, &body).map_err(|e| format!("write session: {e}"))?;

    // Append a one-line summary to _journal.md so the user has a
    // running record of every session without having to open _log/.
    if let Some(d) = &domain {
        let journal_path = PathBuf::from(&vault).join(d).join("_journal.md");
        let first_user = turns.iter()
            .find(|t| t.role == "user")
            .map(|t| t.content.lines().next().unwrap_or("").trim().to_string())
            .unwrap_or_else(|| title.clone().unwrap_or_else(|| "session".into()));
        let truncated: String = first_user.chars().take(140).collect();
        let entry = format!(
            "- {year:04}-{month:02}-{day:02} {hh:02}:{mm:02} · [{file}](_log/{file}) · {turns} turns · {snippet}\n",
            year = year, month = month, day = day, hh = hh, mm = mm,
            file = file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            turns = turns.len(),
            snippet = truncated,
        );
        let existing = read_to_string_retry(&journal_path).unwrap_or_else(|_| "# Journal\n\n".into());
        let merged = if existing.contains("# Journal") {
            format!("{existing}{entry}")
        } else {
            format!("# Journal\n\n{entry}")
        };
        let _ = fs::write(&journal_path, merged);
    }
    Ok(file.to_string_lossy().to_string())
}

// Days-since-epoch → date. Good enough for log filenames, no chrono.
fn secs_to_ymdhms(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let day_secs = 86_400i64;
    let mut days = secs.div_euclid(day_secs);
    let mut rem = secs.rem_euclid(day_secs);
    let hh = (rem / 3600) as u32; rem %= 3600;
    let mm = (rem / 60) as u32;
    let ss = (rem % 60) as u32;
    // Convert days from 1970-01-01 to ymd (Gregorian).
    let mut year = 1970i32;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let ydays = if leap { 366 } else { 365 };
        if days < ydays as i64 { break; }
        days -= ydays as i64;
        year += 1;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_lens = if leap {
        [31u32,29,31,30,31,30,31,31,30,31,30,31]
    } else {
        [31u32,28,31,30,31,30,31,31,30,31,30,31]
    };
    let mut month = 0u32;
    for (i, &ml) in month_lens.iter().enumerate() {
        if days < ml as i64 { month = i as u32 + 1; break; }
        days -= ml as i64;
    }
    let day = days as u32 + 1;
    (year, month, day, hh, mm, ss)
}

// ─────────────────────────────────────────────────────────────────────
// Threads — markdown-on-disk chat threads stored under
// <vault>/<domain>/_threads/<slug>.md (or <vault>/_threads/<slug>.md
// when no domain is set). Each file is markdown with a YAML frontmatter
// block holding title/domain/created/updated/turns; bodies are `## You`
// and `## <cli> [· model]` sections, one per turn.

#[derive(Serialize, Clone)]
pub struct ThreadMeta {
    pub path: String,
    pub slug: String,
    pub title: String,
    pub domain: Option<String>,
    pub created: u64,
    pub updated: u64,
    pub turn_count: usize,
    pub preview: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThreadTurn {
    pub role: String,
    pub cli: Option<String>,
    pub model: Option<String>,
    pub content: String,
}

#[derive(Serialize, Clone)]
pub struct ThreadFull {
    pub meta: ThreadMeta,
    pub turns: Vec<ThreadTurn>,
}

// Parse an ISO-8601 timestamp like 2026-06-05T18:30:00Z into unix secs.
// We only handle the canonical Z-suffixed form we write ourselves; if
// the value doesn't parse we return 0 so callers can fall back to mtime.
fn parse_iso8601_z(s: &str) -> u64 {
    let s = s.trim();
    if s.len() < 20 || !s.ends_with('Z') {
        return 0;
    }
    let bytes = s.as_bytes();
    let to_num = |start: usize, end: usize| -> Option<i64> {
        std::str::from_utf8(&bytes[start..end]).ok()?.parse::<i64>().ok()
    };
    let year = match to_num(0, 4) { Some(v) => v as i32, None => return 0 };
    let month = match to_num(5, 7) { Some(v) => v as u32, None => return 0 };
    let day = match to_num(8, 10) { Some(v) => v as u32, None => return 0 };
    let hh = match to_num(11, 13) { Some(v) => v as u32, None => return 0 };
    let mm = match to_num(14, 16) { Some(v) => v as u32, None => return 0 };
    let ss = match to_num(17, 19) { Some(v) => v as u32, None => return 0 };
    // Days from 1970-01-01 to year-01-01 (Gregorian).
    let mut days: i64 = 0;
    for y in 1970..year {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        days += if leap { 366 } else { 365 };
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_lens: [u32; 12] = if leap {
        [31,29,31,30,31,30,31,31,30,31,30,31]
    } else {
        [31,28,31,30,31,30,31,31,30,31,30,31]
    };
    if month < 1 || month > 12 || day < 1 { return 0; }
    for i in 0..(month as usize - 1) {
        days += month_lens[i] as i64;
    }
    days += (day - 1) as i64;
    let secs = days * 86_400 + (hh as i64) * 3600 + (mm as i64) * 60 + ss as i64;
    if secs < 0 { 0 } else { secs as u64 }
}

fn iso8601_z(secs: u64) -> String {
    let (y, mo, d, hh, mm, ss) = secs_to_ymdhms(secs as i64);
    format!("{y:04}-{mo:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

// Minimal frontmatter scanner — splits the leading `---\n…\n---\n`
// block from the body and returns (key → value) pairs plus body text.
fn split_frontmatter(raw: &str) -> (HashMap<String, String>, String) {
    let mut meta: HashMap<String, String> = HashMap::new();
    let mut lines = raw.lines();
    let first = match lines.next() {
        Some(l) => l,
        None => return (meta, String::new()),
    };
    if first.trim() != "---" {
        return (meta, raw.to_string());
    }
    let mut consumed = first.len() + 1;
    for line in lines.by_ref() {
        consumed += line.len() + 1;
        if line.trim() == "---" {
            break;
        }
        if let Some(idx) = line.find(':') {
            let key = line[..idx].trim().to_string();
            let val = line[idx + 1..].trim().to_string();
            if !key.is_empty() {
                meta.insert(key, val);
            }
        }
    }
    let body = if consumed >= raw.len() {
        String::new()
    } else {
        raw[consumed..].to_string()
    };
    (meta, body)
}

// Parse the body of a thread into ThreadTurns by splitting on `## `
// headers at the start of lines. The header tells us the role.
fn parse_thread_body(body: &str) -> Vec<ThreadTurn> {
    let mut turns: Vec<ThreadTurn> = Vec::new();
    // Normalize: split on lines that start with "## ". We walk the
    // string by lines to keep things allocation-light.
    let mut current_header: Option<String> = None;
    let mut current_content: String = String::new();
    let flush = |hdr: &Option<String>, content: &str, turns: &mut Vec<ThreadTurn>| {
        let header = match hdr {
            Some(h) => h.trim().to_string(),
            None => return,
        };
        let content = content.trim_matches('\n').to_string();
        if header.is_empty() && content.is_empty() {
            return;
        }
        if header.eq_ignore_ascii_case("You") {
            turns.push(ThreadTurn {
                role: "user".into(),
                cli: None,
                model: None,
                content,
            });
        } else {
            // Assistant header may be "<cli>" or "<cli> · <model>".
            let (cli, model) = match header.split_once(" · ") {
                Some((c, m)) => (c.trim().to_string(), Some(m.trim().to_string())),
                None => (header.clone(), None),
            };
            turns.push(ThreadTurn {
                role: "assistant".into(),
                cli: if cli.is_empty() { None } else { Some(cli) },
                model,
                content,
            });
        }
    };
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            flush(&current_header, &current_content, &mut turns);
            current_header = Some(rest.to_string());
            current_content = String::new();
        } else {
            if !current_content.is_empty() {
                current_content.push('\n');
            }
            current_content.push_str(line);
        }
    }
    flush(&current_header, &current_content, &mut turns);
    turns
}

// Build a ThreadMeta from a path + parsed frontmatter + body. Falls
// back to file mtime / slug when fields are missing.
fn thread_meta_from(
    path: &Path,
    meta: &HashMap<String, String>,
    body: &str,
    turns: &[ThreadTurn],
) -> ThreadMeta {
    let slug = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let title = meta
        .get("title")
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| slug.clone());
    let domain = meta
        .get("domain")
        .cloned()
        .filter(|s| !s.is_empty());
    let mtime_secs = fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let created = meta
        .get("created")
        .map(|s| parse_iso8601_z(s))
        .unwrap_or(0);
    let created = if created == 0 { mtime_secs } else { created };
    let updated = meta
        .get("updated")
        .map(|s| parse_iso8601_z(s))
        .unwrap_or(0);
    let updated = if updated == 0 { mtime_secs } else { updated };
    let turn_count = meta
        .get("turns")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(turns.len());
    // Preview = first 120 chars of the first user turn's content. If
    // there's no user turn (shouldn't happen, but be defensive), fall
    // back to the first non-empty body line.
    let preview = turns
        .iter()
        .find(|t| t.role == "user")
        .map(|t| t.content.clone())
        .unwrap_or_else(|| {
            body.lines()
                .find(|l| !l.trim().is_empty() && !l.starts_with("## "))
                .unwrap_or("")
                .to_string()
        });
    let preview: String = preview.chars().take(120).collect();
    ThreadMeta {
        path: path.to_string_lossy().to_string(),
        slug,
        title,
        domain,
        created,
        updated,
        turn_count,
        preview,
    }
}

#[tauri::command]
fn list_threads(vault: String, domain: Option<String>) -> Result<Vec<ThreadMeta>, String> {
    let threads_dir = match &domain {
        Some(d) => PathBuf::from(&vault).join(d).join("_threads"),
        None => PathBuf::from(&vault).join("_threads"),
    };
    if !threads_dir.exists() {
        return Ok(vec![]);
    }
    let entries = read_dir_retry(&threads_dir).map_err(|e| e.to_string())?;
    let mut out: Vec<ThreadMeta> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let raw = match read_to_string_retry(&p) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let (fm, body) = split_frontmatter(&raw);
        let turns = parse_thread_body(&body);
        out.push(thread_meta_from(&p, &fm, &body, &turns));
    }
    // Dedup: a single conversation can land on disk under two slightly
    // different slugs (e.g. `<ts>_<hash>` vs `<ts>-<hash>`) when more than one
    // writer persists it. Both end in the same 8-hex content hash, so collapse
    // by (domain, trailing-hash), keeping the most complete copy (most turns,
    // then newest). This makes the rail show one entry regardless.
    fn trailing_hash(slug: &str) -> Option<String> {
        let tok = slug.rsplit(|c| c == '-' || c == '_').next()?;
        if tok.len() == 8 && tok.chars().all(|c| c.is_ascii_hexdigit()) {
            Some(tok.to_string())
        } else {
            None
        }
    }
    out.sort_by(|a, b| b.turn_count.cmp(&a.turn_count).then(b.updated.cmp(&a.updated)));
    let mut seen: std::collections::HashSet<(Option<String>, String)> = std::collections::HashSet::new();
    out.retain(|m| match trailing_hash(&m.slug) {
        Some(h) => seen.insert((m.domain.clone(), h)),
        None => true,
    });
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(out)
}

#[tauri::command]
fn load_thread(path: String) -> Result<ThreadFull, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("thread not found: {path}"));
    }
    let raw = read_to_string_retry(&p).map_err(|e| e.to_string())?;
    let (fm, body) = split_frontmatter(&raw);
    let turns = parse_thread_body(&body);
    let meta = thread_meta_from(&p, &fm, &body, &turns);
    Ok(ThreadFull { meta, turns })
}

// Slug helper — strip non-alphanumeric chars, collapse to dashes.
fn slugify_fragment(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

// Tiny stable hash for slug generation — FNV-1a 32-bit. We only need
// determinism + low collision rate, not cryptographic strength.
fn fnv1a32(data: &[u8]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for b in data {
        h ^= *b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

#[tauri::command]
fn save_thread(
    vault: String,
    domain: Option<String>,
    slug: Option<String>,
    title: String,
    turns: Vec<ThreadTurn>,
) -> Result<String, String> {
    // Allow empty turns so the UI can pre-create a thread file when
    // the user clicks "+ New thread" — they want the entry to appear
    // in the rail immediately and be renameable BEFORE typing the
    // first prompt. Subsequent auto-saves overwrite with real turns.
    let threads_dir = match &domain {
        Some(d) => PathBuf::from(&vault).join(d).join("_threads"),
        None => PathBuf::from(&vault).join("_threads"),
    };
    fs::create_dir_all(&threads_dir).map_err(|e| format!("mkdir _threads: {e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (year, month, day, hh, mm, ss) = secs_to_ymdhms(now as i64);
    let stamp = format!("{year:04}-{month:02}-{day:02}_{hh:02}-{mm:02}-{ss:02}");

    let final_slug = match slug.as_ref().map(|s| slugify_fragment(s)).filter(|s| !s.is_empty()) {
        Some(s) => s,
        None => {
            let first_user = turns
                .iter()
                .find(|t| t.role == "user")
                .map(|t| t.content.as_str())
                .unwrap_or("");
            let hash = fnv1a32(first_user.as_bytes());
            let hash_suffix = format!("{hash:08x}");
            // Dedup safety net: the frontend autosave can fire two
            // slug=null saves seconds apart for the SAME new conversation
            // (e.g. once when the prompt is sent, once when the reply
            // lands). Each previously produced a distinct
            // `<timestamp>_<hash>.md`, so the thread appeared twice. If a
            // thread with this same first-message hash was created very
            // recently, reuse it instead of creating a duplicate.
            let mut reuse: Option<String> = None;
            if !first_user.is_empty() {
                if let Ok(rd) = fs::read_dir(&threads_dir) {
                    let mut best: Option<(u64, String)> = None;
                    for e in rd.flatten() {
                        let p = e.path();
                        if p.extension().and_then(|x| x.to_str()) != Some("md") {
                            continue;
                        }
                        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                        if !stem.ends_with(&hash_suffix) {
                            continue;
                        }
                        let created = read_to_string_retry(&p)
                            .ok()
                            .and_then(|raw| {
                                split_frontmatter(&raw)
                                    .0
                                    .get("created")
                                    .map(|s| parse_iso8601_z(s))
                            })
                            .unwrap_or(0);
                        // Only merge into a thread created in the last 10
                        // minutes, so genuinely separate conversations that
                        // happen to share a first message stay distinct.
                        if created != 0 && now.saturating_sub(created) < 600 {
                            if best.as_ref().map(|(c, _)| created > *c).unwrap_or(true) {
                                best = Some((created, stem.to_string()));
                            }
                        }
                    }
                    reuse = best.map(|(_, s)| s);
                }
            }
            reuse.unwrap_or_else(|| format!("{stamp}_{hash_suffix}"))
        }
    };

    let file_path = threads_dir.join(format!("{final_slug}.md"));

    // Preserve existing `created` timestamp + title if the file is
    // being overwritten with a known slug; otherwise stamp it now.
    // The title preservation is what stops auto-save from clobbering
    // a user's manual rename — the frontend always sends a freshly
    // derived title from the first user message, but if the file
    // already exists with a different title, the user's choice wins.
    let (created_secs, preserved_title) = if file_path.exists() {
        let fm = read_to_string_retry(&file_path)
            .ok()
            .map(|raw| split_frontmatter(&raw).0);
        let created = fm
            .as_ref()
            .and_then(|m| m.get("created").map(|s| parse_iso8601_z(s)))
            .filter(|v| *v != 0)
            .unwrap_or(now);
        let existing_title = fm.and_then(|m| m.get("title").cloned()).unwrap_or_default();
        (created, existing_title)
    } else {
        (now, String::new())
    };

    // If the on-disk file has a title and it's different from what
    // the caller derived, treat the on-disk one as canonical so
    // renames stick across auto-saves. Exception: the placeholder
    // "Untitled" written by the "+ new thread" handler — we WANT
    // the incoming title (first user message) to replace it.
    let final_title = if !preserved_title.is_empty()
        && preserved_title != title
        && preserved_title != "Untitled"
    {
        preserved_title
    } else {
        title
    };

    let mut body = String::new();
    body.push_str("---\n");
    body.push_str(&format!("title: {}\n", final_title));
    body.push_str(&format!(
        "domain: {}\n",
        domain.as_deref().unwrap_or("")
    ));
    body.push_str(&format!("created: {}\n", iso8601_z(created_secs)));
    body.push_str(&format!("updated: {}\n", iso8601_z(now)));
    body.push_str(&format!("turns: {}\n", turns.len()));
    body.push_str("---\n\n");
    for t in &turns {
        let speaker = if t.role == "user" {
            "You".to_string()
        } else {
            let cli = t.cli.as_deref().unwrap_or("assistant");
            let model = t
                .model
                .as_deref()
                .map(|m| format!(" · {m}"))
                .unwrap_or_default();
            format!("{cli}{model}")
        };
        body.push_str(&format!("## {speaker}\n\n{}\n\n", t.content.trim()));
    }
    fs::write(&file_path, &body).map_err(|e| format!("write thread: {e}"))?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn rename_thread(path: String, new_title: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("thread not found: {path}"));
    }
    let raw = read_to_string_retry(&p).map_err(|e| e.to_string())?;
    // Walk the leading frontmatter block, replacing the `title:` line.
    // If there's no frontmatter, prepend a minimal one.
    let mut out = String::with_capacity(raw.len() + 32);
    let mut lines = raw.lines();
    let first = lines.next();
    match first {
        Some(l) if l.trim() == "---" => {
            out.push_str("---\n");
            let mut title_written = false;
            for line in lines.by_ref() {
                if line.trim() == "---" {
                    if !title_written {
                        out.push_str(&format!("title: {new_title}\n"));
                    }
                    out.push_str("---\n");
                    break;
                }
                if line.trim_start().starts_with("title:") && !title_written {
                    out.push_str(&format!("title: {new_title}\n"));
                    title_written = true;
                } else {
                    out.push_str(line);
                    out.push('\n');
                }
            }
            // Append the remaining body verbatim.
            let rest: Vec<&str> = lines.collect();
            if !rest.is_empty() {
                out.push_str(&rest.join("\n"));
                if raw.ends_with('\n') {
                    out.push('\n');
                }
            } else if raw.ends_with('\n') && !out.ends_with('\n') {
                out.push('\n');
            }
        }
        Some(_) | None => {
            // No frontmatter — synthesize a minimal one and prepend.
            out.push_str("---\n");
            out.push_str(&format!("title: {new_title}\n"));
            out.push_str("---\n\n");
            out.push_str(&raw);
        }
    }
    fs::write(&p, out).map_err(|e| format!("write thread: {e}"))
}

#[tauri::command]
fn delete_thread(path: String) -> Result<(), String> {
    if !path.contains("_threads/") {
        return Err(format!("refusing to delete path outside _threads/: {path}"));
    }
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("thread not found: {path}"));
    }
    fs::remove_file(&p).map_err(|e| format!("delete thread: {e}"))
}

// Domain context bundle — everything the user (and the AI) might want
// to load when entering a domain: state.md, decisions.md, _journal.md
// (or _journal/), recent _log/ entries, and skills.
#[derive(Serialize, Clone)]
pub struct DomainLogEntry {
    pub name: String,
    pub path: String,
    pub mtime_secs: u64,
    pub preview: String,
}
#[derive(Serialize, Clone)]
pub struct DomainContext {
    pub state: Option<String>,
    pub decisions: Option<String>,
    pub journal: Option<String>,
    pub recent_logs: Vec<DomainLogEntry>,
    pub skills: Vec<SkillEntry>,
}

#[tauri::command]
fn domain_context(vault: String, domain: String) -> Result<DomainContext, String> {
    let root = PathBuf::from(&vault).join(&domain);
    if !root.exists() {
        return Err(format!("domain not found: {}", root.display()));
    }
    let read = |p: PathBuf| -> Option<String> {
        if !p.exists() { return None; }
        read_to_string_retry(&p).ok()
    };
    let state = read(root.join("state.md"));
    let decisions = read(root.join("decisions.md"));
    // Journal can live as a single _journal.md or a _journal/ folder
    // of dated entries — concat the latter into newest-first order.
    let journal = read(root.join("_journal.md")).or_else(|| {
        let dir = root.join("_journal");
        if !dir.is_dir() { return None; }
        let mut entries: Vec<(String, PathBuf)> = match read_dir_retry(&dir) {
            Ok(it) => it
                .flatten()
                .map(|e| (e.file_name().to_string_lossy().to_string(), e.path()))
                .filter(|(n, _)| n.ends_with(".md"))
                .collect(),
            Err(_) => return None,
        };
        entries.sort_by(|a, b| b.0.cmp(&a.0));
        let bodies: Vec<String> = entries
            .into_iter()
            .filter_map(|(_, p)| read_to_string_retry(&p).ok())
            .collect();
        if bodies.is_empty() { None } else { Some(bodies.join("\n\n---\n\n")) }
    });

    // Recent logs — newest 10 .md files from _log/ (sorted by mtime).
    let log_dir = root.join("_log");
    let mut recent_logs: Vec<DomainLogEntry> = Vec::new();
    if log_dir.is_dir() {
        if let Ok(it) = read_dir_retry(&log_dir) {
            let mut all: Vec<(PathBuf, u64)> = it
                .flatten()
                .filter_map(|e| {
                    let p = e.path();
                    if p.extension().and_then(|s| s.to_str()) != Some("md") { return None; }
                    let mtime = e.metadata().ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    Some((p, mtime))
                })
                .collect();
            all.sort_by(|a, b| b.1.cmp(&a.1));
            for (p, mtime) in all.into_iter().take(10) {
                let preview = read_to_string_retry(&p)
                    .ok()
                    .map(|s| s.lines().take(2).collect::<Vec<_>>().join(" · "))
                    .unwrap_or_default()
                    .chars().take(120).collect();
                recent_logs.push(DomainLogEntry {
                    name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                    path: p.to_string_lossy().to_string(),
                    mtime_secs: mtime,
                    preview,
                });
            }
        }
    }

    // Skills — re-scan only this domain's skills/.
    let mut skills: Vec<SkillEntry> = Vec::new();
    let skills_dir = root.join("skills");
    if skills_dir.is_dir() {
        if let Ok(it) = read_dir_retry(&skills_dir) {
            for entry in it.flatten() {
                let p = entry.path();
                if !p.is_dir() { continue; }
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') { continue; }
                let mut description: Option<String> = None;
                for candidate in &["SKILL.md", "README.md", "skill.md"] {
                    let f = p.join(candidate);
                    if let Ok(s) = read_to_string_retry(&f) {
                        if let Some(desc) = extract_skill_description(&s) {
                            description = Some(desc);
                            break;
                        }
                    }
                }
                skills.push(SkillEntry {
                    domain: domain.clone(),
                    name,
                    path: p.to_string_lossy().to_string(),
                    description,
                });
            }
            skills.sort_by(|a, b| a.name.cmp(&b.name));
        }
    }

    Ok(DomainContext { state, decisions, journal, recent_logs, skills })
}

#[tauri::command]
fn scan_skills(vault: String) -> Result<Vec<SkillEntry>, String> {
    let root = PathBuf::from(&vault);
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut out: Vec<SkillEntry> = Vec::new();
    let entries = match fs::read_dir(&root) {
        Ok(e) => e,
        Err(_) => return Ok(vec![]),
    };
    for entry in entries.flatten() {
        let domain_path = entry.path();
        if !domain_path.is_dir() {
            continue;
        }
        let domain_name = entry.file_name().to_string_lossy().to_string();
        if NON_DOMAIN_DIRS.contains(&domain_name.as_str()) || domain_name.starts_with('.') {
            continue;
        }
        let skills_dir = domain_path.join("skills");
        if !skills_dir.exists() || !skills_dir.is_dir() {
            continue;
        }
        if let Ok(skills) = fs::read_dir(&skills_dir) {
            for skill in skills.flatten() {
                let p = skill.path();
                if !p.is_dir() {
                    continue;
                }
                let name = skill.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                // Try to read a SKILL.md or README.md for a one-line description.
                let mut description: Option<String> = None;
                for candidate in &["SKILL.md", "README.md", "skill.md"] {
                    let f = p.join(candidate);
                    if let Ok(s) = fs::read_to_string(&f) {
                        let first = s
                            .lines()
                            .find(|l| !l.trim().is_empty() && !l.starts_with('#'))
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        if !first.is_empty() {
                            description = Some(first.chars().take(140).collect());
                            break;
                        }
                    }
                }
                out.push(SkillEntry {
                    domain: domain_name.clone(),
                    name,
                    path: p.to_string_lossy().to_string(),
                    description,
                });
            }
        }
    }
    out.sort_by(|a, b| a.domain.cmp(&b.domain).then(a.name.cmp(&b.name)));
    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────
// Telegram bot integration — POST to /sendMessage on the Bot API.
// The token + chat ID are passed from the frontend (stored in
// localStorage). v0.2 uses `curl` via the shell plugin so we don't
// need to add a new HTTP dependency; v0.3 will move to reqwest.

#[derive(Serialize)]
pub struct TelegramResult {
    pub ok: bool,
    pub description: Option<String>,
}

#[tauri::command]
async fn telegram_send(
    app: tauri::AppHandle,
    token: String,
    chat_id: String,
    text: String,
) -> Result<TelegramResult, String> {
    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let body = format!(
        "{{\"chat_id\":\"{}\",\"text\":{},\"parse_mode\":\"Markdown\"}}",
        chat_id,
        serde_json::to_string(&text).map_err(|e| e.to_string())?,
    );
    let out = app
        .shell()
        .command("curl")
        .args([
            "-fsS",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-d",
            &body,
            &url,
        ])
        .output()
        .await
        .map_err(|e| format!("curl spawn failed: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Ok(TelegramResult {
            ok: false,
            description: Some(if stderr.is_empty() { "send failed".into() } else { stderr }),
        });
    }
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let v: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("parse response: {e}"))?;
    let ok = v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false);
    let desc = v.get("description").and_then(|x| x.as_str()).map(String::from);
    Ok(TelegramResult { ok, description: desc })
}

// ─────────────────────────────────────────────────────────────────────
// Native benchmark runner — spawns the `prevail` CLI binary against the
// active vault, streams stdout/stderr back as Tauri events, and emits
// a final "benchmark:done" with the exit code so the React side can
// refresh the leaderboard.

#[derive(Deserialize)]
pub struct BenchmarkRunArgs {
    pub session_id: String,
    pub vault: String,
    pub cli: String,         // claude | codex | antigravity | ollama
    pub model: Option<String>,
    pub domain: Option<String>,
    pub council: Option<bool>,
}

fn resolve_prevail_bin() -> String {
    // Prefer ~/.local/bin/prevail (the install script's target),
    // fall back to whatever's first on PATH.
    if let Ok(home) = std::env::var("HOME") {
        let local = format!("{home}/.local/bin/prevail");
        if Path::new(&local).exists() {
            return local;
        }
    }
    "prevail".to_string()
}

async fn spawn_prevail_streaming(
    app: tauri::AppHandle,
    session: String,
    args: Vec<String>,
    phase: &'static str,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command as TokioCommand;

    let bin = resolve_prevail_bin();
    let (combined_path, user, logname) = build_cli_env();

    let mut child = TokioCommand::new(&bin)
        .args(&args)
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn {bin} failed: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let session_done = session.clone();

    if let Some(s) = stdout {
        let app2 = app.clone();
        let session2 = session.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit(
                    "benchmark:chunk",
                    serde_json::json!({
                        "session": session2,
                        "stream": "stdout",
                        "data": format!("{line}\n"),
                    }),
                );
            }
        });
    }
    if let Some(s) = stderr {
        let app2 = app.clone();
        let session2 = session.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit(
                    "benchmark:chunk",
                    serde_json::json!({
                        "session": session2,
                        "stream": "stderr",
                        "data": format!("{line}\n"),
                    }),
                );
            }
        });
    }
    tauri::async_runtime::spawn(async move {
        let code = child.wait().await.ok().and_then(|s| s.code());
        let _ = app.emit(
            "benchmark:done",
            serde_json::json!({
                "session": session_done,
                "code": code,
                "phase": phase,
            }),
        );
    });
    Ok(())
}

#[tauri::command]
async fn benchmark_start(
    app: tauri::AppHandle,
    args: BenchmarkRunArgs,
) -> Result<(), String> {
    let mut cli_args: Vec<String> = vec![
        "--vault".into(), args.vault.clone(),
        "bench".into(), "run".into(), "--canonical".into(),
    ];
    if args.council.unwrap_or(false) {
        cli_args.push("--council".into());
    } else {
        cli_args.push("--cli".into());
        cli_args.push(args.cli.clone());
        if let Some(m) = &args.model {
            cli_args.push("--model".into());
            cli_args.push(m.clone());
        }
    }
    if let Some(d) = &args.domain {
        cli_args.push("--domain".into());
        cli_args.push(d.clone());
    }
    spawn_prevail_streaming(app, args.session_id, cli_args, "run").await
}

#[derive(Deserialize)]
pub struct BenchmarkScoreArgs {
    pub session_id: String,
    pub vault: String,
    pub run: Option<String>,
    pub judge_cli: Option<String>,
    pub judge_model: Option<String>,
    pub no_judge: Option<bool>,
}

#[tauri::command]
async fn benchmark_score(
    app: tauri::AppHandle,
    args: BenchmarkScoreArgs,
) -> Result<(), String> {
    let mut cli_args: Vec<String> = vec![
        "--vault".into(), args.vault.clone(),
        "bench".into(), "score".into(),
    ];
    if let Some(r) = &args.run {
        cli_args.push("--run".into());
        cli_args.push(r.clone());
    }
    if args.no_judge.unwrap_or(false) {
        cli_args.push("--no-judge".into());
    } else {
        if let Some(c) = &args.judge_cli {
            cli_args.push("--judge-cli".into());
            cli_args.push(c.clone());
        }
        if let Some(m) = &args.judge_model {
            cli_args.push("--judge-model".into());
            cli_args.push(m.clone());
        }
    }
    spawn_prevail_streaming(app, args.session_id, cli_args, "score").await
}

// ─────────────────────────────────────────────────────────────────────
// Entry point

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ingestion::OrchestratorState::default())
        .manage(telegram_bridge::BridgeState::new())
        .invoke_handler(tauri::generate_handler![
            scan_vault,
            detect_clis,
            log_fatal,
            import_sample_vault,
            remember_vault,
            bootstrap_vault,
            chat_send,
            benchmark_runs,
            benchmark_run_detail,
            read_file,
            telegram_send,
            open_in_finder,
            create_domain,
            domain_context,
            scan_skills,
            abort_sessions,
            read_user_md,
            write_user_md,
            write_paste_attachment,
            save_session,
            verify_cli_model,
            read_skill,
            benchmark_start,
            benchmark_score,
            engine::engine_domains,
            engine::engine_score,
            engine::engine_manifest_get,
            engine::engine_score_all,
            engine::engine_score_history,
            engine::engine_onboard_recommend,
            engine::engine_onboard_apply,
            engine::engine_vault_backup,
            engine::engine_vault_archive,
            engine::engine_vault_restore,
            engine::engine_list_archived,
            engine::engine_manifest_set,
            engine::engine_chat,
            list_threads,
            load_thread,
            save_thread,
            rename_thread,
            delete_thread,
            ingestion::ingestion_status,
            ingestion::ingestion_mcp_list,
            ingestion::ingestion_mcp_start,
            ingestion::ingestion_mcp_stop,
            ingestion::ingestion_composio_set_key,
            ingestion::ingestion_composio_start,
            ingestion::ingestion_composio_stop,
            ingestion::ingestion_browser_run,
            ingestion::ingestion_keychain_set,
            ingestion::ingestion_keychain_get,
            ingestion::ingestion_keychain_del,
            ingestion::ingestion_mcp_config_path,
            ingestion::ingestion_mcp_config_init,
            ingestion::ingestion_mcp_reload,
            ingestion::ingestion_browser_recipes,
            ingestion::ingestion_list_artifacts,
            ingestion::ingestion_mcp_stderr,
            ingestion::ingestion_recipe_save,
            ingestion::ingestion_domain_stats,
            ingestion::ingestion_audit_tail,
            ingestion::ingestion_vacuum_imports,
            telegram_bridge::telegram_bridge_start,
            telegram_bridge::telegram_bridge_stop,
            telegram_bridge::telegram_bridge_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
