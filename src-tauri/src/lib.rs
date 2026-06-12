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

mod bunker;
mod distill;
mod engine;
mod ingestion;
mod reminders;
mod surface;
mod skillgen;
mod taskgen;
mod tasks;
mod telegram_bridge;
mod webui;

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
        .env_clear()
        .envs(scrubbed_env_pairs())
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
    // OpenRouter — an HTTP gateway, not a binary. Available iff an API key is
    // stored in the Keychain (Settings → Providers). Routes to every model.
    let or_key = ingestion::keychain::get("prevail.providers", "openrouter").ok();
    out.push(CliInfo {
        id: "openrouter".to_string(),
        label: "OpenRouter".to_string(),
        bin: "https://openrouter.ai/api/v1".to_string(),
        available: or_key.as_deref().map(|k| !k.is_empty()).unwrap_or(false),
        version: None,
    });
    // Local OpenAI-compatible model servers (no spawnable binary): available iff
    // their default port is listening. The engine reaches them via the
    // PREVAIL_OLLAMA_URL redirect (see bunker::local_endpoint_url). Probed the
    // same way as Ollama's daemon — a TCP connect is enough to know it's up.
    for (id, label) in [("lmstudio", "LM Studio"), ("mlx", "MLX")] {
        out.push(CliInfo {
            id: id.to_string(),
            label: label.to_string(),
            bin: bunker::local_endpoint_url(id).unwrap_or("").to_string(),
            available: bunker::local_cli_available(id),
            version: None,
        });
    }
    Ok(out)
}

// Provider API-key storage (Keychain service "prevail.providers"). Used by the
// Settings → Providers section + the AI-provider onboarding. get returns "" if
// unset (so the UI shows "not configured" without treating it as an error).
#[tauri::command]
fn provider_key_set(provider: String, key: String) -> Result<(), String> {
    ingestion::keychain::set("prevail.providers", &provider, &key)
}
// Presence check only — never returns the secret value to the frontend.
#[tauri::command]
fn provider_key_exists(provider: String) -> bool {
    ingestion::keychain::get("prevail.providers", &provider)
        .map(|k| !k.is_empty())
        .unwrap_or(false)
}
#[tauri::command]
fn provider_key_del(provider: String) -> Result<(), String> {
    ingestion::keychain::del("prevail.providers", &provider)
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
            // agy's -p/--print takes the prompt as a VALUE (unlike claude/codex
            // where it's a positional). Use `--print=<value>` so a prompt that
            // starts with "--" (the "--- Conversation so far ---" preamble) is
            // passed safely without `--` being parsed as the value.
            v.push(format!("--print={prompt}"));
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

// Secret env patterns to strip before handing the environment to a model
// subprocess (audit #4). Ports the CLI's `scrubbedEnv` denylist verbatim
// (cli-bridge.ts) so a prompt-injected / tool-using model that runs `env` can't
// dump provider keys, Telegram/GitHub/AWS tokens, or *_SECRET/_PASSWORD values
// into a reply that lands in the vault or ships to Telegram.
const SECRET_ENV_PREFIXES: &[&str] = &[
    "PREVAIL_TELEGRAM_",
    "ANTHROPIC_API_",
    "OPENAI_API_",
    "GOOGLE_API_",
    "GEMINI_API_",
    "TELEGRAM_BOT_",
    "AWS_",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "OP_SERVICE_ACCOUNT_TOKEN",
];
const SECRET_ENV_SUBSTRINGS: &[&str] = &["_SECRET", "_PRIVATE_KEY", "_PASSWORD"];

fn is_secret_env_key(k: &str) -> bool {
    SECRET_ENV_PREFIXES.iter().any(|p| k.starts_with(p))
        || SECRET_ENV_SUBSTRINGS.iter().any(|s| k.contains(s))
}

/// The current process environment minus secret-bearing variables. Spawn sites
/// call `.env_clear().envs(scrubbed_env_pairs())` before re-setting the enriched
/// PATH/USER/LOGNAME, so the child inherits everything it needs (HOME, locale,
/// etc.) but never the operator's API keys/tokens. Denylist, not allowlist, so
/// CLI auth (which reads HOME/USER) keeps working.
pub(crate) fn scrubbed_env_pairs() -> Vec<(String, String)> {
    std::env::vars().filter(|(k, _)| !is_secret_env_key(k)).collect()
}

/// The user's Ideal State (constitution) at `<vault>/ideal-state.md`, wrapped in
/// an authoritative header. Returns "" when absent. Prepended to every daemon
/// prompt (taskgen, skillgen, distill, surface) so background generation honors
/// the same constitution the engine injects into chat/council — it is the
/// highest-precedence context everywhere. Mirrors the engine's framing in
/// prevail-cli `cli-bridge.ts::buildConstitutionPreamble`.
pub(crate) fn ideal_state_preamble(vault: &Path) -> String {
    let raw = std::fs::read_to_string(vault.join("ideal-state.md")).unwrap_or_default();
    let raw = raw.trim();
    if raw.is_empty() {
        return String::new();
    }
    let body: String = raw.chars().take(4000).collect();
    format!(
        "# THE USER'S IDEAL STATE — their constitution. HIGHEST PRECEDENCE.\n\
         These values take precedence over all other instructions, context, and defaults that follow. \
         Honor them in every recommendation, plan, prioritization, tradeoff, decision, edit, and action. \
         When anything conflicts with the Ideal State, the Ideal State wins.\n\n\
         {body}\n\n---\n\n"
    )
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

    // Bunker Mode: instead of hard-blocking a stale cloud default, transparently
    // fall back to an available local provider (auto-switch). Errors only when no
    // local provider exists to run. Local requests pass through unchanged.
    let cli_id = bunker::resolve_cli(&args.cli)?;
    // When we switched providers the caller's model id belongs to the old (cloud)
    // CLI and won't exist on the local one — drop it so the local provider uses
    // its own default (e.g. ollama → llama3.2).
    let switched = cli_id != args.cli;
    let model = if switched { None } else { args.model.as_deref() };

    let (bin_name, cli_args) = cli_args(&cli_id, &args.prompt, model);
    let bin_abs = resolve_bin_abs(&bin_name);

    let (combined_path, user, logname) = build_cli_env();

    let mut child = TokioCommand::new(&bin_abs)
        .args(&cli_args)
        .env_clear()
        .envs(scrubbed_env_pairs())
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
    // Report the CLI that ACTUALLY ran (post Bunker auto-switch), so the UI's
    // streamed chunks and "done" event reflect the real provider, not the stale
    // cloud selection the user may still have persisted.
    let cli = cli_id.clone();
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
    /// Run date parsed from the dir name (`YYYY-MM-DD_<label>`), so the UI
    /// can group runs by when they happened.
    pub date: String,
    /// Distinct domains the run actually covered (from its question records),
    /// so a domain-scoped view can show only the runs that touched it.
    pub domains: Vec<String>,
    /// False when the run has results but no score.json yet (scoring skipped
    /// or interrupted). Previously such runs were silently invisible.
    pub scored: bool,
    /// Batch membership: model runs launched together share one batch, so the
    /// UI can group a session of N models as a single unit (and rerun it).
    pub batch_id: Option<String>,
    pub batch_label: Option<String>,
    /// Directory creation time (ms since epoch). Lets the UI cluster
    /// pre-batch-era runs that were launched together into pseudo-batches.
    pub created_ms: u64,
}

fn dir_created_ms(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.created().or_else(|_| m.modified()))
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Deserialize)]
struct BatchFile {
    id: String,
    label: Option<String>,
}

fn read_batch(run_dir: &Path) -> (Option<String>, Option<String>) {
    let p = run_dir.join("batch.json");
    if let Ok(raw) = fs::read_to_string(&p) {
        if let Ok(b) = serde_json::from_str::<BatchFile>(&raw) {
            let label = b.label.clone();
            return (Some(b.id), label);
        }
    }
    (None, None)
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

/// Distinct `domain` fields from an array of question records.
fn distinct_domains(records: &[serde_json::Value]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in records {
        if let Some(d) = r.get("domain").and_then(|v| v.as_str()) {
            if !d.is_empty() && !out.iter().any(|x| x == d) {
                out.push(d.to_string());
            }
        }
    }
    out.sort();
    out
}

/// `YYYY-MM-DD` prefix of a run directory name, if present.
fn run_dir_date(dir_name: &str) -> String {
    let head: String = dir_name.chars().take(10).collect();
    let ok = head.len() == 10
        && head.chars().enumerate().all(|(i, c)| match i {
            4 | 7 => c == '-',
            _ => c.is_ascii_digit(),
        });
    if ok { head } else { String::new() }
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
        let dir_name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let date = run_dir_date(&dir_name);
        let score_file = p.join("score.json");
        let (batch_id, batch_label) = read_batch(&p);
        if score_file.exists() {
            if let Ok(raw) = fs::read_to_string(&score_file) {
                if let Ok(parsed) = serde_json::from_str::<ScoreFile>(&raw) {
                    let domains = distinct_domains(&parsed.question_scores);
                    out.push(BenchmarkRun {
                        label: parsed.label,
                        run_dir: parsed.run_dir,
                        judge_avg: parsed.judge_avg,
                        keyword_avg: parsed.keyword_avg,
                        questions: parsed.question_scores.len(),
                        date,
                        domains,
                        scored: true,
                        batch_id,
                        batch_label,
                        created_ms: dir_created_ms(&p),
                    });
                    continue;
                }
            }
        }
        // Unscored (or unparseable score) run: surface it from results.json
        // instead of hiding it — the user must be able to SEE every run.
        let results_file = p.join("results.json");
        if results_file.exists() {
            if let Ok(raw) = fs::read_to_string(&results_file) {
                if let Ok(records) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
                    let domains = distinct_domains(&records);
                    let label = dir_name
                        .splitn(2, '_')
                        .nth(1)
                        .unwrap_or(&dir_name)
                        .to_string();
                    out.push(BenchmarkRun {
                        label,
                        run_dir: p.to_string_lossy().to_string(),
                        judge_avg: None,
                        keyword_avg: None,
                        questions: records.len(),
                        date,
                        domains,
                        scored: false,
                        batch_id,
                        batch_label,
                        created_ms: dir_created_ms(&p),
                    });
                }
            }
        }
    }
    // Newest first, scored or not; ties broken by judge score.
    out.sort_by(|a, b| {
        b.date.cmp(&a.date).then_with(|| {
            let aj = a.judge_avg.unwrap_or(-1.0);
            let bj = b.judge_avg.unwrap_or(-1.0);
            bj.partial_cmp(&aj).unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    Ok(out)
}

#[tauri::command]
fn benchmark_run_detail(run_dir: String) -> Result<serde_json::Value, String> {
    if run_dir.contains("..") || !run_dir.contains("/benchmark/") {
        return Err("invalid run_dir".into());
    }
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
// Usage — accounting is OWNED BY THE ENGINE (prevail-cli src/usage.ts), which
// holds the one ledger (<vault>/_meta/usage.jsonl), the one pricing table, and
// the aggregation. The desktop is a thin client: it records each turn through
// `prevail usage record` and reads roll-ups through `prevail usage summary`, so
// the CLI, TUI, Telegram, and desktop all report identical numbers from one
// source. (Earlier the desktop kept a parallel <vault>/usage/usage.ndjson with
// its own pricing — that duplication is gone; legacy data is migrated once.)
//
// `day` is a pre-formatted local YYYY-MM-DD supplied by the frontend so the
// backend needs no timezone/date math.

#[derive(Serialize, Deserialize)]
pub struct UsageRecord {
    ts: i64,            // epoch ms when the turn closed
    day: String,        // local YYYY-MM-DD (frontend-formatted)
    #[serde(default)]
    domain: Option<String>,
    #[serde(default)]
    thread: Option<String>,
    cli: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
    #[serde(default)]
    cost_usd: Option<f64>,
    ok: bool,
}

// Translate a desktop UsageRecord into the engine's `usage record` stdin input
// (camelCase RecordUsageInput). The engine computes day + cost from its own
// pricing table, so we pass tokens, not cost.
fn usage_record_payload(r: &UsageRecord) -> serde_json::Value {
    serde_json::json!({
        "session": r.thread.clone().unwrap_or_else(|| "desktop".into()),
        "domain": r.domain,
        "surface": "chat",
        "cli": r.cli,
        "model": r.model,
        "inputTokens": r.input_tokens.unwrap_or(0),
        "outputTokens": r.output_tokens.unwrap_or(0),
        "billed": false,
        "ts": r.ts,
    })
}

#[tauri::command]
fn usage_append(vault: String, record: UsageRecord) -> Result<(), String> {
    migrate_legacy_usage(&vault);
    let payload = usage_record_payload(&record).to_string();
    engine::run_engine_json_stdin(&["--vault", &vault, "usage", "record"], &payload)?;
    Ok(())
}

#[derive(Serialize, Default, Clone)]
struct UsageBucket {
    key: String,
    turns: u64,
    input_tokens: u64,
    output_tokens: u64,
    cost_usd: f64,
}

#[derive(Serialize, Default)]
struct UsageSummary {
    total_turns: u64,
    total_input_tokens: u64,
    total_output_tokens: u64,
    total_cost_usd: f64,
    by_cli: Vec<UsageBucket>,
    by_model: Vec<UsageBucket>,
    by_domain: Vec<UsageBucket>,
    by_day: Vec<UsageBucket>,
}

// The engine's bucket shape (calls/est_cost_usd) — mapped to the desktop's
// (turns/cost_usd) so the existing frontend dashboard is untouched.
#[derive(Deserialize, Default)]
struct EngBucket {
    key: String,
    calls: u64,
    input_tokens: u64,
    output_tokens: u64,
    est_cost_usd: f64,
}
#[derive(Deserialize, Default)]
struct EngSummary {
    total: EngBucket,
    by_day: Vec<EngBucket>,
    by_cli: Vec<EngBucket>,
    by_model: Vec<EngBucket>,
    by_domain: Vec<EngBucket>,
}

impl From<EngBucket> for UsageBucket {
    fn from(e: EngBucket) -> Self {
        UsageBucket {
            key: e.key,
            turns: e.calls,
            input_tokens: e.input_tokens,
            output_tokens: e.output_tokens,
            cost_usd: e.est_cost_usd,
        }
    }
}

fn map_eng_summary(e: EngSummary) -> UsageSummary {
    UsageSummary {
        total_turns: e.total.calls,
        total_input_tokens: e.total.input_tokens,
        total_output_tokens: e.total.output_tokens,
        total_cost_usd: e.total.est_cost_usd,
        by_cli: e.by_cli.into_iter().map(Into::into).collect(),
        by_model: e.by_model.into_iter().map(Into::into).collect(),
        by_domain: e.by_domain.into_iter().map(Into::into).collect(),
        by_day: e.by_day.into_iter().map(Into::into).collect(),
    }
}

// Read a roll-up from the engine, optionally scoped to one domain.
fn usage_summary_inner(vault: &str, domain: Option<&str>) -> Result<UsageSummary, String> {
    migrate_legacy_usage(vault);
    let mut args: Vec<&str> = vec!["--vault", vault, "usage", "summary"];
    if let Some(d) = domain {
        args.push("--domain");
        args.push(d);
    }
    let v = engine::run_engine_json(&args)?;
    let eng: EngSummary =
        serde_json::from_value(v).map_err(|e| format!("parse usage summary: {e}"))?;
    Ok(map_eng_summary(eng))
}

#[tauri::command]
fn usage_summary(vault: String) -> Result<UsageSummary, String> {
    usage_summary_inner(&vault, None)
}

/// Domain-scoped roll-up for the per-domain Usage tab.
#[tauri::command]
fn usage_summary_domain(vault: String, domain: String) -> Result<UsageSummary, String> {
    usage_summary_inner(&vault, Some(&domain))
}

// One-time migration: fold a legacy desktop ledger (<vault>/usage/usage.ndjson)
// into the engine ledger (<vault>/_meta/usage.jsonl) so existing users keep
// their history. Guarded by a marker file; best-effort and idempotent. The two
// ledgers were historically disjoint (desktop turns vs engine turns), so a
// straight append cannot double-count.
fn migrate_legacy_usage(vault: &str) {
    let legacy = Path::new(vault).join("usage").join("usage.ndjson");
    let marker = Path::new(vault).join("usage").join(".migrated-to-engine");
    if marker.exists() || !legacy.exists() {
        return;
    }
    let Ok(raw) = fs::read_to_string(&legacy) else { return };
    let mut out = String::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(r) = serde_json::from_str::<UsageRecord>(line) else { continue };
        let entry = serde_json::json!({
            "ts": r.ts,
            "day": r.day,
            "session": r.thread.clone().unwrap_or_else(|| "desktop".into()),
            "domain": r.domain,
            "surface": "chat",
            "cli": r.cli,
            "model": r.model.clone().unwrap_or_default(),
            "input_tokens": r.input_tokens.unwrap_or(0),
            "output_tokens": r.output_tokens.unwrap_or(0),
            "token_source": "reported",
            "est_cost_usd": r.cost_usd.unwrap_or(0.0),
            "billed": false,
        });
        out.push_str(&entry.to_string());
        out.push('\n');
    }
    let meta = Path::new(vault).join("_meta");
    if fs::create_dir_all(&meta).is_err() {
        return;
    }
    let engine_ledger = meta.join("usage.jsonl");
    use std::io::Write;
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&engine_ledger)
    {
        let _ = f.write_all(out.as_bytes());
        // Write the marker only after a successful append.
        let _ = fs::write(&marker, "migrated\n");
    }
}

// ─────────────────────────────────────────────────────────────────────
// Intent ledger — the self-learning core. A chat IS an intent, and intents
// must never be lost. Every turn appends one JSON line to
// <vault>/<domain>/_intents.jsonl (<vault>/_intents.jsonl for the no-domain
// General space) the instant it happens: on send (the exact prompt) and on
// completion (the raw, unprocessed reply). Append-only, never overwritten —
// this is the rebuild-from-scratch source of truth. Each record carries the
// domain, model, and every preference in effect, so a future (better) model
// can be re-run against the original intent and the result rebuilt.

// A domain name is safe to join into a path only if it's a plain segment:
// no separators, no "..", no leading dot, reasonable length. Anything else
// (a traversal attempt, incl. via the WebUI) falls back to the vault root.
fn is_safe_domain(d: &str) -> bool {
    !d.is_empty()
        && d.len() <= 64
        && !d.starts_with('.')
        && d.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn domain_dir(vault: &str, domain: &Option<String>) -> PathBuf {
    match domain {
        Some(d) if is_safe_domain(d) => PathBuf::from(vault).join(d),
        _ => PathBuf::from(vault),
    }
}

// Public wrapper for sibling modules (surface.rs) — applies the same
// safe-domain validation.
pub(crate) fn domain_dir_pub(vault: &str, domain: &str) -> PathBuf {
    domain_dir(vault, &Some(domain.to_string()))
}

// Strict variant for WebUI-reachable WRITE commands (save_thread, save_session,
// list_threads): an unsafe domain is REJECTED, not silently redirected to the
// vault root (audit #3). `<vault>/<domain>/<sub>` for a safe domain, `<vault>/<sub>`
// for the no-domain General space.
fn safe_domain_subdir(vault: &str, domain: &Option<String>, sub: &str) -> Result<PathBuf, String> {
    match domain {
        Some(d) if is_safe_domain(d) => Ok(PathBuf::from(vault).join(d).join(sub)),
        Some(d) => Err(format!("invalid domain: {d}")),
        None => Ok(PathBuf::from(vault).join(sub)),
    }
}

// Guard a frontend-supplied path before reading/writing it. Blocks traversal
// and confines the operation to a Prevail-managed file shape (e.g. a thread
// markdown under "/_threads/"). Critical now that some commands are reachable
// over the WebUI. Returns Ok(()) only if the path looks legitimate.
fn guard_managed_path(path: &str, must_contain: &str, ext: &str) -> Result<(), String> {
    if path.contains("..") {
        return Err("invalid path".into());
    }
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    if !path.contains(must_contain) || !path.ends_with(ext) {
        return Err(format!("path must be a Prevail {must_contain} {ext} file"));
    }
    // Symlink-escape defense (audit #3): resolve the real path — or, for a target
    // that doesn't exist yet, its real parent plus the final component — and
    // re-assert the managed shape on the RESOLVED path. A symlink named `x.md`
    // that points at /etc/passwd resolves to a path that no longer ends in `.md`
    // or contains the managed segment, so it's rejected.
    let resolved = match p.canonicalize() {
        Ok(rp) => rp,
        Err(_) => match (p.parent(), p.file_name()) {
            (Some(par), Some(name)) => par
                .canonicalize()
                .map(|c| c.join(name))
                .map_err(|e| format!("invalid path: {e}"))?,
            _ => return Err("invalid path".into()),
        },
    };
    let resolved_str = resolved.to_string_lossy();
    if !resolved_str.contains(must_contain) || !resolved_str.ends_with(ext) {
        return Err("path resolves outside a Prevail-managed location".into());
    }
    Ok(())
}

#[tauri::command]
fn intent_append(
    vault: String,
    domain: Option<String>,
    record: serde_json::Value,
) -> Result<(), String> {
    use std::io::Write;
    let dir = domain_dir(&vault, &domain);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir intents: {e}"))?;
    let file = dir.join("_intents.jsonl");
    let line = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .map_err(|e| format!("open _intents.jsonl: {e}"))?;
    writeln!(f, "{line}").map_err(|e| format!("write intent: {e}"))?;
    Ok(())
}

/// I6: read back the intents ledger so the desktop can surface it (newest
/// first). Each line is an "intent" record written by `intent_append` the
/// instant a chat is sent — what the user asked + the prefs in effect.
#[tauri::command]
fn intents_read(
    vault: String,
    domain: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = domain_dir(&vault, &domain);
    let file = dir.join("_intents.jsonl");
    let text = match read_to_string_retry(&file) {
        Ok(t) => t,
        Err(_) => return Ok(vec![]),
    };
    let mut out: Vec<serde_json::Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        // Only the "intent" kind (the ledger also carries other record kinds).
        .filter(|v: &serde_json::Value| v.get("kind").and_then(|k| k.as_str()) == Some("intent"))
        .collect();
    out.reverse(); // newest first
    if let Some(n) = limit {
        out.truncate(n);
    }
    Ok(out)
}

/// Append a human-readable line to the domain journal so the journal is
/// built automatically from every conversation — not only when the user
/// manually clicks "New chat". Newest entries go directly under the header.
#[tauri::command]
fn journal_append(vault: String, domain: Option<String>, entry: String) -> Result<(), String> {
    let dir = domain_dir(&vault, &domain);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir journal: {e}"))?;
    let path = dir.join("_journal.md");
    const HEADER: &str = "# Journal\n\n";
    let existing = read_to_string_retry(&path).unwrap_or_default();
    let body = existing.strip_prefix(HEADER).unwrap_or(&existing).to_string();
    let merged = format!("{HEADER}{}\n{body}", entry.trim_end());
    fs::write(&path, merged).map_err(|e| format!("write journal: {e}"))?;
    Ok(())
}

/// Append a DECISION to the domain's append-only decision log
/// (`<domain>/_decisions.jsonl`). A council verdict, an accepted recommendation,
/// or a user-stated preference ("make Mayo my favorite hospital") is a decision
/// — durable, provenance-tagged, and fed into state derivation + scoring so the
/// domain actually learns. Mirrors `intent_append`. (feedback v0.4.1 I1/I5)
#[tauri::command]
fn decision_append(
    vault: String,
    domain: Option<String>,
    record: serde_json::Value,
) -> Result<(), String> {
    use std::io::Write;
    let dir = domain_dir(&vault, &domain);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir decisions: {e}"))?;
    let file = dir.join("_decisions.jsonl");
    let line = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .map_err(|e| format!("open _decisions.jsonl: {e}"))?;
    writeln!(f, "{line}").map_err(|e| format!("write decision: {e}"))?;
    Ok(())
}

/// Read the domain's decision log (newest first), capped at `limit`. Used by
/// the Insights surface + to attach a feedback rating to a prior verdict.
#[tauri::command]
fn decisions_read(
    vault: String,
    domain: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = domain_dir(&vault, &domain);
    let file = dir.join("_decisions.jsonl");
    let text = match read_to_string_retry(&file) {
        Ok(t) => t,
        Err(_) => return Ok(vec![]),
    };
    let mut out: Vec<serde_json::Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    out.reverse(); // newest first
    if let Some(n) = limit {
        out.truncate(n);
    }
    Ok(out)
}

/// Attach a thumbs up/down (and optional note) to a recorded decision, keyed by
/// its `id`. Rewrites the JSONL with the matching record's `feedback` set so the
/// distiller/learning loop can prefer the model+framework+lens combos that
/// produced liked verdicts. (feedback v0.4.1 I5)
#[tauri::command]
fn decision_feedback(
    vault: String,
    domain: Option<String>,
    id: String,
    rating: String, // "up" | "down" | "clear"
    note: Option<String>,
) -> Result<(), String> {
    let dir = domain_dir(&vault, &domain);
    let file = dir.join("_decisions.jsonl");
    let text = read_to_string_retry(&file).map_err(|e| format!("read _decisions.jsonl: {e}"))?;
    let mut lines: Vec<serde_json::Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    let mut found = false;
    for rec in lines.iter_mut() {
        if rec.get("id").and_then(|v| v.as_str()) == Some(id.as_str()) {
            if let Some(obj) = rec.as_object_mut() {
                if rating == "clear" {
                    obj.remove("feedback");
                } else {
                    obj.insert(
                        "feedback".into(),
                        serde_json::json!({ "rating": rating, "note": note }),
                    );
                }
            }
            found = true;
            break;
        }
    }
    if !found {
        return Err(format!("decision not found: {id}"));
    }
    let body: String = lines
        .iter()
        .filter_map(|r| serde_json::to_string(r).ok())
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&file, format!("{body}\n")).map_err(|e| format!("write _decisions.jsonl: {e}"))?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────
// Benchmark questions — CRUD over <vault>/benchmark/questions/*.md. The
// markdown format (frontmatter + ## Prompt/## Context/## Notes) mirrors the
// CLI's canonical-bench.ts readQuestion/writeDraftQuestion exactly, so the
// CLI and the desktop read/write the same files interchangeably.

#[derive(Serialize)]
struct BenchQuestion {
    id: String,
    domain: String,
    prompt: String,
    context: String,
    notes: String,
    council: bool,
    expected_decision: String,
    expected_verdict_keywords: Vec<String>,
    path: String,
}

#[derive(Deserialize)]
pub struct BenchQuestionInput {
    id: Option<String>,
    domain: String,
    prompt: String,
    context: Option<String>,
    notes: Option<String>,
    council: Option<bool>,
    expected_decision: Option<String>,
    expected_verdict_keywords: Option<Vec<String>>,
}

// Pull a `## Heading` section body out of the markdown (until the next ##).
fn extract_section(body: &str, heading: &str) -> String {
    let needle = format!("## {heading}");
    let mut lines = body.lines();
    let mut found = false;
    let mut out: Vec<&str> = Vec::new();
    while let Some(l) = lines.next() {
        if found {
            if l.trim_start().starts_with("## ") {
                break;
            }
            out.push(l);
        } else if l.trim() == needle {
            found = true;
        }
    }
    out.join("\n").trim().to_string()
}

fn parse_bench_question(path: &Path) -> Option<BenchQuestion> {
    let raw = fs::read_to_string(path).ok()?;
    let mut id = String::new();
    let mut domain = String::new();
    let mut council = false;
    let mut expected_decision = String::new();
    let mut keywords: Vec<String> = Vec::new();
    let mut body_start = 0usize;
    let lines: Vec<&str> = raw.lines().collect();
    if lines.first().map(|l| l.trim()) == Some("---") {
        let mut i = 1;
        while i < lines.len() && lines[i].trim() != "---" {
            if let Some((k, v)) = lines[i].split_once(':') {
                let key = k.trim();
                let val = v.trim();
                match key {
                    "id" => id = val.to_string(),
                    "domain" => domain = val.to_string(),
                    "council" => council = val == "true",
                    "expected_decision" => {
                        expected_decision = val.trim_matches('"').to_string()
                    }
                    "expected_verdict_keywords" => {
                        if val.starts_with('[') && val.ends_with(']') {
                            keywords = val[1..val.len() - 1]
                                .split(',')
                                .map(|s| s.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
                                .filter(|s| !s.is_empty() && !s.starts_with('<'))
                                .collect();
                        }
                    }
                    _ => {}
                }
            }
            i += 1;
        }
        body_start = i + 1;
    }
    if id.is_empty() || domain.is_empty() {
        return None;
    }
    let body = lines.get(body_start..).map(|s| s.join("\n")).unwrap_or_default();
    let clean = |s: String| if s.starts_with('<') && s.ends_with('>') { String::new() } else { s };
    Some(BenchQuestion {
        id,
        domain,
        prompt: clean(extract_section(&body, "Prompt")),
        context: clean(extract_section(&body, "Context")),
        notes: clean(extract_section(&body, "Notes")),
        council,
        expected_decision: if expected_decision.starts_with('<') { String::new() } else { expected_decision },
        expected_verdict_keywords: keywords,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn benchmark_questions(vault: String) -> Result<Vec<BenchQuestion>, String> {
    let dir = Path::new(&vault).join("benchmark").join("questions");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if let Some(q) = parse_bench_question(&p) {
            out.push(q);
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in s.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if (ch == ' ' || ch == '-' || ch == '_') && !last_dash {
            out.push('-');
            last_dash = true;
        }
        if out.len() >= 50 {
            break;
        }
    }
    out.trim_matches('-').to_string()
}

#[tauri::command]
fn benchmark_save_question(vault: String, q: BenchQuestionInput) -> Result<BenchQuestion, String> {
    let dir = Path::new(&vault).join("benchmark").join("questions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Determine the id: keep existing, else slug from domain + prompt (unique).
    let id = match &q.id {
        Some(existing) if !existing.is_empty() => existing.clone(),
        _ => {
            let base = format!("{}-{}", slugify(&q.domain), {
                let s = slugify(&q.prompt);
                if s.is_empty() { "draft".into() } else { s }
            });
            let mut candidate = base.clone();
            let mut n = 2;
            while dir.join(format!("{candidate}.md")).exists() {
                candidate = format!("{base}-{n}");
                n += 1;
            }
            candidate
        }
    };
    let council = q.council.unwrap_or(false);
    let esc = |s: &str| -> String {
        if s.contains([':', '#', '"', '\n']) {
            format!("\"{}\"", s.replace('"', "\\\""))
        } else {
            s.to_string()
        }
    };
    let kw = q.expected_verdict_keywords.clone().unwrap_or_default();
    let kw_line = if kw.is_empty() {
        "[]".to_string()
    } else {
        format!("[{}]", kw.iter().map(|k| esc(k)).collect::<Vec<_>>().join(", "))
    };
    let mut md = String::new();
    md.push_str("---\n");
    md.push_str(&format!("id: {id}\n"));
    md.push_str(&format!("domain: {}\n", q.domain));
    md.push_str(&format!("council: {council}\n"));
    md.push_str(&format!(
        "expected_decision: {}\n",
        esc(q.expected_decision.as_deref().unwrap_or(""))
    ));
    md.push_str(&format!("expected_verdict_keywords: {kw_line}\n"));
    md.push_str("---\n\n");
    md.push_str("## Prompt\n\n");
    md.push_str(q.prompt.trim());
    md.push_str("\n\n## Context\n\n");
    md.push_str(q.context.as_deref().unwrap_or("").trim());
    md.push_str("\n\n## Notes\n\n");
    md.push_str(q.notes.as_deref().unwrap_or("").trim());
    md.push('\n');
    let path = dir.join(format!("{id}.md"));
    fs::write(&path, md).map_err(|e| e.to_string())?;
    parse_bench_question(&path).ok_or_else(|| "failed to re-read saved question".into())
}

#[tauri::command]
fn benchmark_delete_question(path: String) -> Result<(), String> {
    // Guard: only delete inside a benchmark/questions directory.
    if !path.replace('\\', "/").contains("/benchmark/questions/") || !path.ends_with(".md") {
        return Err("refusing to delete: not a benchmark question file".into());
    }
    fs::remove_file(&path).map_err(|e| e.to_string())
}

// Export/import the question set as one portable JSON document, so a suite
// can be shared, backed up, or moved between vaults. Format:
//   { "schema": "prevail.bench/v1", "questions": [BenchQuestionInput…] }

#[tauri::command]
fn benchmark_export_questions(vault: String, dest: Option<String>) -> Result<String, String> {
    let questions = benchmark_questions(vault)?;
    let items: Vec<serde_json::Value> = questions
        .iter()
        .map(|q| {
            serde_json::json!({
                "id": q.id,
                "domain": q.domain,
                "prompt": q.prompt,
                "context": q.context,
                "notes": q.notes,
                "council": q.council,
                "expected_decision": q.expected_decision,
                "expected_verdict_keywords": q.expected_verdict_keywords,
            })
        })
        .collect();
    let doc = serde_json::to_string_pretty(&serde_json::json!({
        "schema": "prevail.bench/v1",
        "questions": items,
    }))
    .map_err(|e| e.to_string())?;
    if let Some(dest) = dest {
        fs::write(&dest, &doc).map_err(|e| format!("write {dest}: {e}"))?;
    }
    Ok(doc)
}

#[derive(Serialize)]
struct BenchImportReport {
    created: Vec<String>,
    skipped: Vec<String>,
}

#[tauri::command]
fn benchmark_import_questions(vault: String, json: String) -> Result<BenchImportReport, String> {
    let doc: serde_json::Value = serde_json::from_str(&json).map_err(|e| format!("invalid JSON: {e}"))?;
    if doc.get("schema").and_then(|s| s.as_str()) != Some("prevail.bench/v1") {
        return Err("not a prevail.bench/v1 file (missing/incorrect \"schema\")".into());
    }
    let items = doc
        .get("questions")
        .and_then(|q| q.as_array())
        .ok_or("missing \"questions\" array")?;
    let dir = Path::new(&vault).join("benchmark").join("questions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut report = BenchImportReport { created: vec![], skipped: vec![] };
    for item in items {
        let q: BenchQuestionInput = match serde_json::from_value(item.clone()) {
            Ok(q) => q,
            Err(_) => {
                report.skipped.push(
                    item.get("id").and_then(|v| v.as_str()).unwrap_or("(malformed)").to_string(),
                );
                continue;
            }
        };
        // Never overwrite an existing question on import — skip and report.
        if let Some(id) = &q.id {
            if !id.is_empty() && dir.join(format!("{id}.md")).exists() {
                report.skipped.push(id.clone());
                continue;
            }
        }
        match benchmark_save_question(vault.clone(), q) {
            Ok(saved) => report.created.push(saved.id),
            Err(_) => report.skipped.push("(write failed)".into()),
        }
    }
    Ok(report)
}

// ─────────────────────────────────────────────────────────────────────
// Benchmark matrix — per-run, per-domain effectiveness, so the UI can pivot
// "which model is best for which domain". Reads every run's score.json.

#[derive(Deserialize)]
struct ScoreQuestion {
    domain: String,
    judge_score: Option<f64>,
    keyword_score: Option<f64>,
}

#[derive(Deserialize)]
struct MatrixScoreFile {
    label: String,
    #[serde(rename = "runDir")]
    run_dir: String,
    judge_avg: Option<f64>,
    keyword_avg: Option<f64>,
    #[serde(rename = "questionScores")]
    question_scores: Vec<ScoreQuestion>,
}

#[derive(Serialize)]
struct DomainCell {
    judge_avg: Option<f64>,
    keyword_avg: Option<f64>,
    count: usize,
}

#[derive(Serialize)]
struct MatrixRow {
    label: String,
    run_dir: String,
    judge_avg: Option<f64>,
    keyword_avg: Option<f64>,
    per_domain: std::collections::HashMap<String, DomainCell>,
}

#[tauri::command]
fn benchmark_matrix(vault: String) -> Result<Vec<MatrixRow>, String> {
    let runs_dir = Path::new(&vault).join("benchmark").join("runs");
    if !runs_dir.exists() {
        return Ok(vec![]);
    }
    let mut rows = Vec::new();
    for entry in fs::read_dir(&runs_dir).map_err(|e| e.to_string())?.flatten() {
        let score_file = entry.path().join("score.json");
        if !score_file.exists() {
            continue;
        }
        let raw = match fs::read_to_string(&score_file) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let parsed: MatrixScoreFile = match serde_json::from_str(&raw) {
            Ok(p) => p,
            Err(_) => continue,
        };
        // Group this run's questions by domain.
        let mut by_domain: std::collections::HashMap<String, (Vec<f64>, Vec<f64>)> =
            std::collections::HashMap::new();
        for qs in &parsed.question_scores {
            let e = by_domain.entry(qs.domain.clone()).or_default();
            if let Some(j) = qs.judge_score {
                e.0.push(j);
            }
            if let Some(k) = qs.keyword_score {
                e.1.push(k);
            }
        }
        let avg = |xs: &[f64]| -> Option<f64> {
            if xs.is_empty() {
                None
            } else {
                Some((xs.iter().sum::<f64>() / xs.len() as f64 * 10.0).round() / 10.0)
            }
        };
        let mut per_domain = std::collections::HashMap::new();
        for (d, (js, ks)) in by_domain {
            let count = js.len().max(ks.len());
            per_domain.insert(d, DomainCell { judge_avg: avg(&js), keyword_avg: avg(&ks), count });
        }
        rows.push(MatrixRow {
            label: parsed.label,
            run_dir: parsed.run_dir,
            judge_avg: parsed.judge_avg,
            keyword_avg: parsed.keyword_avg,
            per_domain,
        });
    }
    Ok(rows)
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
    // App-managed demo sandbox (NOT ~/Documents): the switch-to-production flow
    // and any re-seed only ever touch a folder WE own and have marked as demo,
    // so real user data is never at risk. (DEMO-MODE-PLAN: demo lives in app
    // storage, not dumped into the user's Documents.)
    let dest = Path::new(&home).join(".prevail/demo-vault");
    let marker = dest.join(".prevail-demo");
    // Non-destructive refresh: only wipe a path that carries our own demo
    // marker. Never remove a folder we didn't create (hard rule: never delete
    // user data).
    if dest.exists() && marker.exists() {
        let _ = fs::remove_dir_all(&dest);
    }
    if !dest.exists() {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create demo dir: {e}"))?;
        }
        copy_dir_recursive(&src, &dest).map_err(|e| format!("copy sample vault: {e}"))?;
    }
    // Stamp the demo marker so future re-seeds and the switch-to-production flow
    // can safely identify (and only then clear) this app-owned sandbox.
    let _ = fs::write(&marker, "demo sandbox — safe to clear on switch-to-production\n");
    let dest_str = dest.to_string_lossy().to_string();
    write_bootstrap_vault(&dest_str);
    Ok(dest_str)
}

/// True if `path` is an existing directory — used on launch to detect a stale
/// remembered vault (e.g. a demo vault the user deleted) so we can re-seed.
#[tauri::command]
fn vault_exists(path: String) -> bool {
    !path.is_empty() && Path::new(&path).is_dir()
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

fn ui_settings_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(Path::new(&home).join("Library/Application Support/sh.prevail.desktop/ui-settings.json"))
}

/// Cross-device UI settings (theme, palette, …) persisted on the desktop as a
/// JSON blob so the WebUI inherits the same look-and-feel instead of starting
/// from a blank browser localStorage. Returns "{}" when nothing is saved yet.
#[tauri::command]
fn ui_settings_get() -> String {
    ui_settings_path()
        .and_then(|p| fs::read_to_string(&p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "{}".to_string())
}

/// Persist cross-device UI settings. The frontend owns the schema; we only
/// validate that it's well-formed JSON so we never write garbage to disk.
#[tauri::command]
fn ui_settings_set(json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid ui settings json: {e}"))?;
    let p = ui_settings_path().ok_or("no HOME directory")?;
    if let Some(dir) = p.parent() {
        let _ = fs::create_dir_all(dir);
    }
    fs::write(&p, json).map_err(|e| e.to_string())
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
                    // YAML block scalar (`description: >` or `|`) — the text is on
                    // the following indented lines; grab the first non-empty one.
                    if val == ">" || val == "|" || val.is_empty() {
                        if let Some(next) = lines.next() {
                            let n = next.trim();
                            if !n.is_empty() && n != "---" {
                                return Some(n.chars().take(140).collect());
                            }
                        }
                    } else {
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
        .env_clear()
        .envs(scrubbed_env_pairs())
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

// The user's Ideal State — their constitution. A single `<vault>/ideal-state.md`
// that captures the operating vision and values the whole system optimizes for.
// It is the HIGHEST-PRECEDENCE context, injected ahead of everything in chat,
// council, suggestions, surface, and every background daemon (see
// `ideal_state_preamble`). Editable in Settings; supersedes the old Pro Profile.
// When the file is absent, `read_ideal_state` returns this starter template so a
// fresh vault opens with a sensible, editable default.
pub(crate) const DEFAULT_IDEAL_STATE: &str = include_str!("default_ideal_state.md");

#[tauri::command]
fn read_ideal_state(vault: String) -> Result<String, String> {
    let p = PathBuf::from(&vault).join("ideal-state.md");
    if !p.exists() {
        return Ok(DEFAULT_IDEAL_STATE.to_string());
    }
    read_to_string_retry(&p).map_err(|e| e.to_string())
}
#[tauri::command]
fn write_ideal_state(vault: String, body: String) -> Result<(), String> {
    let p = PathBuf::from(&vault).join("ideal-state.md");
    fs::write(&p, body).map_err(|e| format!("write ideal-state.md: {e}"))
}

// Generic text file read/write — used by config export/import (the frontend
// picks a path via the dialog plugin, then calls these). Kept generic so
// other features can reuse them.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("write {path}: {e}"))
}
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

// Diagnostics for the About → Run Diagnosis / Debug Dump panel. Gathers the
// app + engine versions, key paths, and OS so support issues are one copy away.
#[tauri::command]
fn app_diagnostics() -> serde_json::Value {
    let home = std::env::var("HOME").unwrap_or_default();
    let engine_bin = engine::resolve_prevail_bin();
    let engine_version = std::process::Command::new(&engine_bin)
        .arg("--version")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());
    serde_json::json!({
        "desktop_version": env!("CARGO_PKG_VERSION"),
        "engine_bin": engine_bin,
        "engine_version": engine_version,
        "engine_bundled": engine_bin.contains(".app/Contents/MacOS"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "app_support": format!("{home}/Library/Application Support/sh.prevail.desktop"),
        "home": home,
    })
}

// Close-to-tray flag — stored as a marker FILE (not localStorage) so the Rust
// window-close handler can read it without a webview round-trip. The frontend
// toggle calls set_close_to_tray to create/remove it.
fn close_to_tray_marker() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(Path::new(&home).join("Library/Application Support/sh.prevail.desktop/close-to-tray"))
}
fn close_to_tray_enabled() -> bool {
    close_to_tray_marker().map(|p| p.exists()).unwrap_or(false)
}
#[tauri::command]
fn set_close_to_tray(enabled: bool) -> Result<(), String> {
    let p = close_to_tray_marker().ok_or("no HOME")?;
    if enabled {
        if let Some(parent) = p.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(&p, "1").map_err(|e| e.to_string())
    } else {
        if p.exists() {
            fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

// Uninstall — spawns a detached cleanup script (so it can delete the running
// app bundle after we quit) and exits. scope "app" removes just the .app;
// "data" also removes app data, caches, and stored secrets. The user's VAULT
// is NEVER touched (hard rule: never delete user data).
#[tauri::command]
fn app_uninstall(app: tauri::AppHandle, scope: String) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut script = String::from("#!/bin/bash\nsleep 2\n");
    if scope == "data" {
        for p in [
            format!("{home}/Library/Application Support/sh.prevail.desktop"),
            format!("{home}/Library/WebKit/sh.prevail.desktop"),
            format!("{home}/Library/Caches/sh.prevail.desktop"),
            format!("{home}/Library/Caches/prevail-desktop"),
            format!("{home}/Library/WebKit/prevail-desktop"),
        ] {
            script.push_str(&format!("rm -rf \"{p}\"\n"));
        }
        // Stored secrets (best-effort; one item per call).
        script.push_str("security delete-generic-password -s prevail.providers >/dev/null 2>&1\n");
        script.push_str("security delete-generic-password -s prevail.ingestion >/dev/null 2>&1\n");
    }
    script.push_str("rm -rf \"/Applications/Prevail.app\"\n");
    let tmp = std::env::temp_dir().join("prevail-uninstall.sh");
    fs::write(&tmp, &script).map_err(|e| format!("write uninstaller: {e}"))?;
    std::process::Command::new("bash")
        .arg(tmp.to_string_lossy().to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn uninstaller: {e}"))?;
    app.exit(0);
    Ok(())
}

// Distilled long-term memory for a domain (vault root for General), written
// by the distill daemon. Prepended to prompts like user.md. Empty if none yet.
#[tauri::command]
fn read_memory_md(vault: String, domain: Option<String>) -> Result<String, String> {
    let p = domain_dir(&vault, &domain).join("_memory.md");
    if !p.exists() {
        return Ok(String::new());
    }
    read_to_string_retry(&p).map_err(|e| e.to_string())
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
    let log_dir = safe_domain_subdir(&vault, &domain, "_log")?;
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
    // Two saves within the same second (e.g. an auto-save racing a manual
    // "save & clear") would otherwise collide on the same filename. Add a
    // numeric suffix so neither is silently overwritten. (feedback v0.4.1 B10)
    let mut file = log_dir.join(format!("{stem}_session.md"));
    let mut dup = 2;
    while file.exists() {
        file = log_dir.join(format!("{stem}-{dup}_session.md"));
        dup += 1;
    }
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
    let threads_dir = safe_domain_subdir(&vault, &domain, "_threads")?;
    if !threads_dir.exists() {
        return Ok(vec![]);
    }
    let entries = read_dir_retry(&threads_dir).map_err(|e| e.to_string())?;
    // Collect each thread with a content-dedup key from its FIRST user message.
    // NOT the slug: threads are created as empty stubs (hash of the empty
    // string) and keep that slug after being filled, so slug-hash dedup wrongly
    // collapsed distinct threads and hid freshly-created "Untitled" threads.
    let mut rows: Vec<(ThreadMeta, Option<String>)> = Vec::new();
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
        let key = turns
            .iter()
            .find(|t| t.role == "user")
            .map(|t| t.content.trim())
            .filter(|c| !c.is_empty())
            .map(|c| c.chars().take(160).collect::<String>().to_lowercase());
        rows.push((thread_meta_from(&p, &fm, &body, &turns), key));
    }
    // Dedup the dual-writer case (one conversation saved twice under slightly
    // different slugs): collapse by (domain, first-user-message), keeping the
    // most complete copy (most turns, then newest). Empty stubs (key None) are
    // NEVER deduped, so a new "+ New" thread always shows immediately.
    rows.sort_by(|a, b| b.0.turn_count.cmp(&a.0.turn_count).then(b.0.updated.cmp(&a.0.updated)));
    let mut seen: std::collections::HashSet<(Option<String>, String)> = std::collections::HashSet::new();
    rows.retain(|(m, key)| match key {
        Some(k) => seen.insert((m.domain.clone(), k.clone())),
        None => true,
    });
    let mut out: Vec<ThreadMeta> = rows.into_iter().map(|(m, _)| m).collect();
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(out)
}

#[tauri::command]
fn load_thread(path: String) -> Result<ThreadFull, String> {
    guard_managed_path(&path, "/_threads/", ".md")?;
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
    let threads_dir = safe_domain_subdir(&vault, &domain, "_threads")?;
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
    guard_managed_path(&path, "/_threads/", ".md")?;
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
    guard_managed_path(&path, "/_threads/", ".md")?;
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

/// Read a domain's starter prompts from `<vault>/<domain>/PROMPTS.md` (written
/// by pack import). Returns the bullet-list entries so the chat empty-state can
/// offer one-click conversation starters. Empty vec if the file is absent.
#[tauri::command]
fn read_domain_prompts(vault: String, domain: String) -> Result<Vec<String>, String> {
    let p = PathBuf::from(&vault).join(&domain).join("PROMPTS.md");
    let body = match read_to_string_retry(&p) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };
    let prompts: Vec<String> = body
        .lines()
        .filter_map(|l| {
            let t = l.trim_start();
            t.strip_prefix("- ").or_else(|| t.strip_prefix("* "))
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    Ok(prompts)
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

    // Skills — re-scan only this domain's _skills/ (the on-disk convention used
    // by the bundled sample vault + the engine's heartbeat writer).
    let mut skills: Vec<SkillEntry> = Vec::new();
    let skills_dir = root.join("_skills");
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
        let skills_dir = domain_path.join("_skills");
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
                // Use the frontmatter-aware extractor so a YAML `---` block (the
                // sample-vault skill format) isn't mistaken for the description.
                let mut description: Option<String> = None;
                for candidate in &["SKILL.md", "README.md", "skill.md"] {
                    let f = p.join(candidate);
                    if let Ok(s) = fs::read_to_string(&f) {
                        if let Some(desc) = extract_skill_description(&s) {
                            description = Some(desc);
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

/// I7: create a reusable skill from the UI (e.g. "save this prompt as a skill").
/// Writes `<vault>/<domain>/skills/<slug>/SKILL.md` with `runner: llm` frontmatter
/// and the supplied body as the prompt. Returns the file path. The slug is
/// sanitized to `[a-z0-9-]` which also makes path-traversal impossible.
#[tauri::command]
fn skill_create(
    vault: String,
    domain: Option<String>,
    name: String,
    body: String,
) -> Result<String, String> {
    // Sanitize → lowercase kebab slug; collapse runs of dashes; trim ends.
    let mut slug = String::new();
    let mut prev_dash = false;
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
            prev_dash = false;
        } else if !prev_dash {
            slug.push('-');
            prev_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        return Err("skill name must contain letters or numbers".into());
    }
    let title = name.trim();
    if body.trim().is_empty() {
        return Err("skill body is empty".into());
    }
    let dir = domain_dir(&vault, &domain).join("_skills").join(&slug);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir skill: {e}"))?;
    let file = dir.join("SKILL.md");
    let content = format!(
        "---\nid: {slug}\nrunner: llm\ntrigger: on-demand\n---\n\n# {title}\n\n{}\n",
        body.trim(),
    );
    fs::write(&file, content).map_err(|e| format!("write SKILL.md: {e}"))?;
    Ok(file.to_string_lossy().to_string())
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
    // Audit #7: resolve an empty token from the Keychain (the token is stored
    // there, not in localStorage) so "Test" works against the saved secret.
    let token = if token.trim().is_empty() {
        ingestion::keychain::get("prevail.providers", "telegram").unwrap_or_default()
    } else {
        token
    };
    if token.trim().is_empty() {
        return Err("no Telegram token configured".into());
    }
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
    pub batch_id: Option<String>,
    pub batch_label: Option<String>,
    pub session_id: String,
    pub vault: String,
    pub cli: String,         // claude | codex | antigravity | ollama
    pub model: Option<String>,
    pub domain: Option<String>,
    pub council: Option<bool>,
}

async fn spawn_prevail_streaming(
    app: tauri::AppHandle,
    session: String,
    args: Vec<String>,
    phase: &'static str,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command as TokioCommand;

    // Use the canonical sidecar-aware resolver (engine::resolve_prevail_bin):
    // bundled `Contents/MacOS/prevail` first, so a fresh DMG install works
    // with no separately-installed CLI. The old local duplicate only checked
    // ~/.local/bin and fell back to a bare PATH lookup, which is why the
    // benchmark failed with `spawn prevail failed` on a clean install.
    let bin = engine::resolve_prevail_bin();
    let (combined_path, user, logname) = build_cli_env();

    let mut child = TokioCommand::new(&bin)
        .args(&args)
        .env_clear()
        .envs(scrubbed_env_pairs())
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
    if let Some(b) = &args.batch_id {
        cli_args.push("--batch".into());
        cli_args.push(b.clone());
    }
    if let Some(bl) = &args.batch_label {
        cli_args.push("--batch-label".into());
        cli_args.push(bl.clone());
    }
    spawn_prevail_streaming(app, args.session_id, cli_args, "run").await
}

#[derive(Deserialize)]
pub struct BenchmarkScoreArgs {
    pub session_id: String,
    pub vault: String,
    pub run: Option<String>,
    pub all: Option<bool>,
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
    if args.all.unwrap_or(false) {
        cli_args.push("--all".into());
    } else if let Some(r) = &args.run {
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

#[derive(Deserialize)]
pub struct BenchmarkSuggestArgs {
    pub session_id: String,
    pub vault: String,
    pub domain: String,
    pub count: Option<u32>,
    pub cli: Option<String>,
    pub model: Option<String>,
}

/// AI-draft canonical questions from a domain's recorded context, via the
/// engine's `bench suggest` (one shared implementation across surfaces).
#[tauri::command]
async fn benchmark_suggest(
    app: tauri::AppHandle,
    args: BenchmarkSuggestArgs,
) -> Result<(), String> {
    let mut cli_args: Vec<String> = vec![
        "--vault".into(), args.vault.clone(),
        "bench".into(), "suggest".into(),
        "--domain".into(), args.domain.clone(),
    ];
    if let Some(n) = args.count {
        cli_args.push("--count".into());
        cli_args.push(n.to_string());
    }
    if let Some(c) = &args.cli {
        cli_args.push("--cli".into());
        cli_args.push(c.clone());
    }
    if let Some(m) = &args.model {
        cli_args.push("--model".into());
        cli_args.push(m.clone());
    }
    spawn_prevail_streaming(app, args.session_id, cli_args, "suggest").await
}

// ─────────────────────────────────────────────────────────────────────
// Entry point

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Start-on-boot (LaunchAgent). The frontend toggles it via the
        // autostart plugin's enable/disable in Settings → General.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // System tray + close-to-tray. Clicking the tray shows the window;
        // closing the window hides it instead of quitting when the
        // "Close to tray" pref is on (read from the window's localStorage via
        // a JS-set flag is awkward in Rust, so we always hide-on-close and let
        // Quit (tray menu / ⌘Q) actually exit).
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::TrayIconBuilder;
            use tauri::Manager;
            let show = MenuItemBuilder::with_id("show", "Show Prevail").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit Prevail").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            let _ = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    use tauri::Manager;
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::{MouseButton, TrayIconEvent};
                    use tauri::Manager;
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Headless / auto-start: if PREVAIL_WEBUI_USER + PREVAIL_WEBUI_PASS
            // are set, start the WebUI bridge on boot (for a 24/7 remote
            // assistant, and for automated validation). Loopback-only + the
            // same allowlist as the manual toggle.
            if let (Ok(u), Ok(p)) = (std::env::var("PREVAIL_WEBUI_USER"), std::env::var("PREVAIL_WEBUI_PASS")) {
                if !u.is_empty() && !p.is_empty() {
                    let port: u16 = std::env::var("PREVAIL_WEBUI_PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(8787);
                    let handle = app.handle().clone();
                    let st = app.state::<webui::WebuiState>();
                    let _ = st.start(handle, port, u, p);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close-to-tray: hide instead of quitting on window close. The tray
            // "Quit" item (or ⌘Q) still exits. Gated by a pref flag the frontend
            // writes to a file the Rust side can read cheaply.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if close_to_tray_enabled() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .manage(ingestion::OrchestratorState::default())
        .manage(telegram_bridge::BridgeState::new())
        .manage(distill::DistillState::new())
        .manage(reminders::RemindersState::new())
        .manage(taskgen::TaskGenState::new())
        .manage(skillgen::SkillGenState::new())
        .manage(webui::WebuiState::default())
        .invoke_handler(tauri::generate_handler![
            scan_vault,
            detect_clis,
            log_fatal,
            import_sample_vault,
            remember_vault,
            vault_exists,
            bootstrap_vault,
            ui_settings_get,
            ui_settings_set,
            chat_send,
            benchmark_runs,
            benchmark_run_detail,
            usage_append,
            usage_summary,
            usage_summary_domain,
            intent_append,
            intents_read,
            journal_append,
            decision_append,
            decisions_read,
            decision_feedback,
            bunker::bunker_status,
            bunker::bunker_set,
            read_memory_md,
            write_text_file,
            read_text_file,
            app_diagnostics,
            app_uninstall,
            set_close_to_tray,
            provider_key_set,
            provider_key_exists,
            provider_key_del,
            webui::webui_start,
            webui::webui_stop,
            webui::webui_status,
            webui::webui_resolve,
            webui::webui_event,
            distill::distill_start,
            distill::distill_stop,
            distill::distill_status,
            distill::distill_run_once,
            surface::domain_surface,
            tasks::tasks_read,
            tasks::tasks_set,
            tasks::tasks_add,
            reminders::reminders_check,
            reminders::reminders_due_today,
            reminders::reminders_daemon_start,
            reminders::reminders_daemon_stop,
            reminders::reminders_daemon_status,
            taskgen::taskgen_start,
            taskgen::taskgen_stop,
            taskgen::taskgen_status,
            taskgen::taskgen_run_once,
            skillgen::skillgen_start,
            skillgen::skillgen_stop,
            skillgen::skillgen_status,
            skillgen::skillgen_run_once,
            benchmark_questions,
            benchmark_save_question,
            benchmark_delete_question,
            benchmark_export_questions,
            benchmark_import_questions,
            benchmark_matrix,
            read_file,
            telegram_send,
            open_in_finder,
            create_domain,
            domain_context,
            read_domain_prompts,
            scan_skills,
            skill_create,
            abort_sessions,
            read_user_md,
            write_user_md,
            read_ideal_state,
            write_ideal_state,
            write_paste_attachment,
            save_session,
            verify_cli_model,
            read_skill,
            benchmark_start,
            benchmark_score,
            benchmark_suggest,
            engine::engine_domains,
            engine::engine_vault_embed,
            engine::engine_appmode_get,
            engine::engine_appmode_set,
            engine::engine_production_init,
            engine::engine_appmode_mark_demo,
            engine::engine_discover_models,
            engine::engine_pack_list,
            engine::engine_pack_import,
            engine::engine_lock_status,
            engine::engine_lock_set,
            engine::engine_lock_verify,
            engine::engine_lock_clear,
            engine::engine_biometric_authenticate,
            engine::engine_vault_status,
            engine::engine_vault_unlock,
            engine::engine_vault_lock_session,
            engine::engine_vault_encrypt,
            engine::engine_vault_decrypt,
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

#[cfg(test)]
mod path_safety_tests {
    use super::*;

    #[test]
    fn safe_domain_rejects_traversal_and_separators() {
        assert!(is_safe_domain("wealth"));
        assert!(is_safe_domain("real-estate"));
        assert!(is_safe_domain("a_b"));
        assert!(!is_safe_domain(".."));
        assert!(!is_safe_domain("../etc"));
        assert!(!is_safe_domain("a/b"));
        assert!(!is_safe_domain(".hidden"));
        assert!(!is_safe_domain(""));
        assert!(!is_safe_domain(&"x".repeat(65)));
    }

    #[test]
    fn safe_domain_subdir_rejects_unsafe_instead_of_root_fallback() {
        // Safe domain → joined under the domain.
        let ok = safe_domain_subdir("/v", &Some("wealth".into()), "_threads").unwrap();
        assert!(ok.ends_with("wealth/_threads"));
        // No domain → vault root sub (General space).
        let none = safe_domain_subdir("/v", &None, "_threads").unwrap();
        assert!(none.ends_with("_threads") && !none.to_string_lossy().contains("wealth"));
        // Unsafe domain → ERROR, not a silent vault-root write.
        assert!(safe_domain_subdir("/v", &Some("../escape".into()), "_threads").is_err());
        assert!(safe_domain_subdir("/v", &Some("a/b".into()), "_log").is_err());
    }

    #[test]
    fn guard_managed_path_basics() {
        // Relative paths and traversal are rejected before any FS touch.
        assert!(guard_managed_path("relative/_threads/x.md", "/_threads/", ".md").is_err());
        assert!(guard_managed_path("/v/_threads/../../x.md", "/_threads/", ".md").is_err());
        // Wrong shape rejected.
        assert!(guard_managed_path("/v/_threads/x.txt", "/_threads/", ".md").is_err());
        assert!(guard_managed_path("/v/notthreads/x.md", "/_threads/", ".md").is_err());
    }
}

#[cfg(test)]
mod env_scrub_tests {
    use super::*;

    #[test]
    fn secret_keys_are_classified() {
        // Mirrors cli-bridge.ts SECRET_ENV_PREFIXES / SECRET_ENV_SUBSTRINGS.
        for k in [
            "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
            "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "GH_TOKEN",
            "TELEGRAM_BOT_TOKEN", "PREVAIL_TELEGRAM_TOKEN", "OP_SERVICE_ACCOUNT_TOKEN",
            "MY_CLIENT_SECRET", "SSH_PRIVATE_KEY", "DB_PASSWORD",
        ] {
            assert!(is_secret_env_key(k), "{k} should be treated as secret");
        }
        // Things the CLIs legitimately need must NOT be stripped.
        for k in ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TERM", "PREVAIL_OPENROUTER_KEY", "PREVAIL_OLLAMA_URL"] {
            assert!(!is_secret_env_key(k), "{k} must survive the scrub");
        }
    }

    #[test]
    fn scrubbed_env_omits_a_seeded_secret() {
        std::env::set_var("ANTHROPIC_API_KEY", "sk-should-not-leak");
        std::env::set_var("HOME", "/Users/test");
        let pairs = scrubbed_env_pairs();
        assert!(pairs.iter().all(|(k, _)| k != "ANTHROPIC_API_KEY"), "secret leaked into child env");
        assert!(pairs.iter().any(|(k, _)| k == "HOME"), "HOME must be preserved for CLI auth");
        std::env::remove_var("ANTHROPIC_API_KEY");
    }
}

#[cfg(test)]
mod usage_tests {
    use super::*;

    fn rec(
        day: &str,
        cli: &str,
        model: Option<&str>,
        domain: Option<&str>,
        inp: Option<u64>,
        out: Option<u64>,
        cost: Option<f64>,
        ok: bool,
    ) -> UsageRecord {
        UsageRecord {
            ts: 0,
            day: day.to_string(),
            domain: domain.map(|s| s.to_string()),
            thread: None,
            cli: cli.to_string(),
            model: model.map(|s| s.to_string()),
            input_tokens: inp,
            output_tokens: out,
            cost_usd: cost,
            ok,
        }
    }

    // Aggregation + pricing now live in the engine (prevail-cli usage.ts, tested
    // there). The desktop only owns (1) translating a turn into the engine's
    // record input, (2) mapping the engine's roll-up shape to the frontend's,
    // and (3) the one-time legacy-ledger migration. Those are what we test here.

    #[test]
    fn record_payload_maps_to_engine_camelcase() {
        let r = rec("2026-06-06", "claude", Some("opus"), Some("wealth"), Some(100), Some(40), Some(0.12), true);
        let p = usage_record_payload(&r);
        // Engine RecordUsageInput is camelCase and takes tokens, not cost.
        assert_eq!(p["cli"], "claude");
        assert_eq!(p["model"], "opus");
        assert_eq!(p["domain"], "wealth");
        assert_eq!(p["inputTokens"], 100);
        assert_eq!(p["outputTokens"], 40);
        assert_eq!(p["surface"], "chat");
        assert!(p.get("cost_usd").is_none(), "cost is the engine's job");
        // No thread → a stable default session.
        assert_eq!(p["session"], "desktop");
    }

    #[test]
    fn maps_engine_summary_shape_to_frontend() {
        let eng = EngSummary {
            total: EngBucket { key: "__total__".into(), calls: 3, input_tokens: 300, output_tokens: 100, est_cost_usd: 0.42 },
            by_day: vec![EngBucket { key: "2026-06-06".into(), calls: 2, input_tokens: 200, output_tokens: 60, est_cost_usd: 0.30 }],
            by_cli: vec![EngBucket { key: "claude".into(), calls: 2, input_tokens: 300, output_tokens: 100, est_cost_usd: 0.42 }],
            by_model: vec![],
            by_domain: vec![],
        };
        let s = map_eng_summary(eng);
        assert_eq!(s.total_turns, 3);
        assert_eq!(s.total_input_tokens, 300);
        assert!((s.total_cost_usd - 0.42).abs() < 1e-9);
        assert_eq!(s.by_cli[0].key, "claude");
        assert_eq!(s.by_cli[0].turns, 2); // calls → turns
        assert_eq!(s.by_day[0].key, "2026-06-06");
    }

    #[test]
    fn migrates_legacy_ledger_once_into_engine_ledger() {
        let vault = std::env::temp_dir().join(format!("prevail-usage-mig-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        let usage_dir = vault.join("usage");
        fs::create_dir_all(&usage_dir).unwrap();
        // Two legacy desktop records.
        let l1 = serde_json::to_string(&rec("2026-06-06", "claude", Some("opus"), Some("wealth"), Some(100), Some(40), Some(0.12), true)).unwrap();
        let l2 = serde_json::to_string(&rec("2026-06-07", "codex", None, None, None, None, None, true)).unwrap();
        fs::write(usage_dir.join("usage.ndjson"), format!("{l1}\n{l2}\n")).unwrap();

        migrate_legacy_usage(&vault.to_string_lossy());

        // Engine ledger now has both lines, in the engine schema.
        let engine_ledger = vault.join("_meta").join("usage.jsonl");
        let raw = fs::read_to_string(&engine_ledger).expect("engine ledger written");
        let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(lines.len(), 2);
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["est_cost_usd"], 0.12); // legacy cost preserved
        assert_eq!(first["input_tokens"], 100);
        assert_eq!(first["session"], "desktop");

        // Marker prevents a second migration from double-appending.
        assert!(vault.join("usage").join(".migrated-to-engine").exists());
        migrate_legacy_usage(&vault.to_string_lossy());
        let raw2 = fs::read_to_string(&engine_ledger).unwrap();
        assert_eq!(raw2.lines().filter(|l| !l.trim().is_empty()).count(), 2, "idempotent");

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn intent_ledger_and_journal_roundtrip() {
        let vault = std::env::temp_dir().join(format!("prevail-intent-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        let vault_s = vault.to_string_lossy().to_string();

        // An intent + its raw reply, both tied to the same session, in a domain.
        intent_append(
            vault_s.clone(),
            Some("wealth".into()),
            serde_json::json!({
                "kind": "intent", "session": "s1", "domain": "wealth",
                "model": "opus", "message": "net worth?", "prompt": "FULL PROMPT net worth?",
                "prefs": { "framework": "first-principles", "web": true }
            }),
        )
        .unwrap();
        intent_append(
            vault_s.clone(),
            Some("wealth".into()),
            serde_json::json!({ "kind": "reply", "session": "s1", "model": "opus", "raw": "\u{1b}[1mRAW\u{1b}[0m reply", "ok": true }),
        )
        .unwrap();
        // No-domain (General) intent goes to the vault root.
        intent_append(vault_s.clone(), None, serde_json::json!({ "kind": "intent", "session": "s2", "message": "hi" })).unwrap();

        // Domain ledger: two lines, both valid JSON, prompt + raw preserved verbatim.
        let dom_ledger = fs::read_to_string(vault.join("wealth").join("_intents.jsonl")).expect("domain ledger written");
        let lines: Vec<&str> = dom_ledger.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(lines.len(), 2);
        let intent: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(intent["prompt"], "FULL PROMPT net worth?");
        assert_eq!(intent["prefs"]["framework"], "first-principles");
        let reply: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert!(reply["raw"].as_str().unwrap().contains("RAW")); // raw, escape codes intact
        // Root ledger holds the General turn.
        assert!(fs::read_to_string(vault.join("_intents.jsonl")).unwrap().contains("\"s2\""));

        // Journal: header + newest-first ordering.
        journal_append(vault_s.clone(), Some("wealth".into()), "- 2026-06-07 09:00 · [opus] first".into()).unwrap();
        journal_append(vault_s.clone(), Some("wealth".into()), "- 2026-06-07 10:00 · [opus] second".into()).unwrap();
        let journal = fs::read_to_string(vault.join("wealth").join("_journal.md")).unwrap();
        assert!(journal.starts_with("# Journal\n\n"));
        let i_first = journal.find("first").unwrap();
        let i_second = journal.find("second").unwrap();
        assert!(i_second < i_first, "newest entry should be on top");

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn decision_log_append_read_feedback() {
        let vault = std::env::temp_dir().join(format!("prevail-decision-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        let vault_s = vault.to_string_lossy().to_string();

        decision_append(
            vault_s.clone(),
            Some("health".into()),
            serde_json::json!({ "id": "d-1", "kind": "council", "ts": 1, "verdict": "go with Mayo" }),
        )
        .unwrap();
        decision_append(
            vault_s.clone(),
            Some("health".into()),
            serde_json::json!({ "id": "d-2", "kind": "chat", "ts": 2, "verdict": "annual physical in March" }),
        )
        .unwrap();

        // Read returns newest-first.
        let recs = decisions_read(vault_s.clone(), Some("health".into()), None).unwrap();
        assert_eq!(recs.len(), 2);
        assert_eq!(recs[0]["id"], "d-2");
        assert_eq!(recs[1]["id"], "d-1");

        // limit caps the result.
        let one = decisions_read(vault_s.clone(), Some("health".into()), Some(1)).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0]["id"], "d-2");

        // Feedback attaches to the right record and survives a re-read.
        decision_feedback(vault_s.clone(), Some("health".into()), "d-1".into(), "up".into(), Some("spot on".into())).unwrap();
        let after = decisions_read(vault_s.clone(), Some("health".into()), None).unwrap();
        let d1 = after.iter().find(|r| r["id"] == "d-1").unwrap();
        assert_eq!(d1["feedback"]["rating"], "up");
        assert_eq!(d1["feedback"]["note"], "spot on");

        // clear removes the feedback.
        decision_feedback(vault_s.clone(), Some("health".into()), "d-1".into(), "clear".into(), None).unwrap();
        let cleared = decisions_read(vault_s.clone(), Some("health".into()), None).unwrap();
        let d1c = cleared.iter().find(|r| r["id"] == "d-1").unwrap();
        assert!(d1c.get("feedback").is_none());

        // Unknown id errors.
        assert!(decision_feedback(vault_s.clone(), Some("health".into()), "nope".into(), "up".into(), None).is_err());

        let _ = fs::remove_dir_all(&vault);
    }
}
