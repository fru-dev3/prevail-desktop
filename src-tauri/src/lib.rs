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

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Emitter;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

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

#[tauri::command]
fn scan_vault(path: String) -> Result<Vec<Domain>, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("vault path does not exist: {}", path));
    }
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
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
        let state_path = p.join("state.md");
        let has_state = state_path.exists();
        // Only count as a domain if state.md exists (matches CLI behavior).
        if !has_state {
            continue;
        }
        let state_preview = fs::read_to_string(&state_path)
            .ok()
            .map(|s| s.lines().take(3).collect::<Vec<&str>>().join("\n"));
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
}

const CLIS: &[(&str, &str, &str)] = &[
    ("claude", "Claude", "claude"),
    ("codex", "Codex", "codex"),
    ("antigravity", "Antigravity", "agy"),
    ("ollama", "Ollama", "ollama"),
];

#[tauri::command]
async fn detect_clis(app: tauri::AppHandle) -> Result<Vec<CliInfo>, String> {
    let mut out = Vec::new();
    for (id, label, bin) in CLIS {
        // Use `which` via shell plugin to test for binary presence.
        let result = app.shell().command("which").args(&[*bin]).output().await;
        let available = match result {
            Ok(o) => o.status.success(),
            Err(_) => false,
        };
        out.push(CliInfo {
            id: id.to_string(),
            label: label.to_string(),
            bin: bin.to_string(),
            available,
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
}

fn cli_args(cli: &str, prompt: &str) -> (String, Vec<String>) {
    // Match the prevail CLI's dispatch table. -p / --prompt for one-shot
    // non-interactive mode.
    match cli {
        "claude" => (
            "claude".to_string(),
            vec![
                "--dangerously-skip-permissions".to_string(),
                "-p".to_string(),
                prompt.to_string(),
            ],
        ),
        "codex" => (
            "codex".to_string(),
            vec!["exec".to_string(), "--skip-git-repo-check".to_string(), prompt.to_string()],
        ),
        "antigravity" => (
            "agy".to_string(),
            vec![
                "--dangerously-skip-permissions".to_string(),
                "-p".to_string(),
                prompt.to_string(),
            ],
        ),
        "ollama" => (
            "ollama".to_string(),
            vec!["run".to_string(), "llama3.2".to_string(), prompt.to_string()],
        ),
        _ => ("echo".to_string(), vec![format!("unknown cli: {}", cli)]),
    }
}

#[tauri::command]
async fn chat_send(
    app: tauri::AppHandle,
    args: ChatArgs,
) -> Result<(), String> {
    let (bin, cli_args) = cli_args(&args.cli, &args.prompt);
    let cmd = app.shell().command(&bin).args(cli_args);
    let (mut rx, _child) = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let session = args.session_id.clone();
    let cli = args.cli.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(chunk) => {
                    let s = String::from_utf8_lossy(&chunk).to_string();
                    let _ = app.emit(
                        "chat:chunk",
                        serde_json::json!({
                            "session": session,
                            "cli": cli,
                            "stream": "stdout",
                            "data": s,
                        }),
                    );
                }
                CommandEvent::Stderr(chunk) => {
                    let s = String::from_utf8_lossy(&chunk).to_string();
                    let _ = app.emit(
                        "chat:chunk",
                        serde_json::json!({
                            "session": session,
                            "cli": cli,
                            "stream": "stderr",
                            "data": s,
                        }),
                    );
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app.emit(
                        "chat:done",
                        serde_json::json!({
                            "session": session,
                            "cli": cli,
                            "code": payload.code,
                        }),
                    );
                    break;
                }
                _ => {}
            }
        }
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
// Entry point

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            scan_vault,
            detect_clis,
            chat_send,
            benchmark_runs,
            benchmark_run_detail,
            read_file,
            telegram_send,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
