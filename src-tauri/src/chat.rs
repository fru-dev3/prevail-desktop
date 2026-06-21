// Chat — spawn a model CLI with a prompt and stream its output back to the
// frontend as Tauri events; the pre-flight model verification path; and the
// shared CLI/env spawn helpers (build_cli_env, scrubbed_env_pairs,
// ideal_state_preamble, resolve_bin_abs, is_secret_env_key) the rest of the
// crate uses — they live here because chat is the canonical spawn site, and
// lib.rs re-exports them at the crate root so other modules keep calling
// crate::<name>. Extracted from lib.rs.

use std::path::Path;

use serde::Deserialize;
use tauri::Emitter;

use crate::children::{register_child, unregister_child};
use crate::{bunker, read_to_string_retry};

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

/// Materialize ~/.prevail/agent-mcp.json (the Composio HTTP MCP server with the
/// X-CONSUMER-API-KEY header) from the Keychain key, and return its path so the
/// chat agent can use the Composio gateway live (search + execute the connected
/// apps' tools). Returns None when no Composio key is set, so a chat without
/// Composio configured is byte-for-byte unchanged. Mirrors the CLI engine's
/// agent-mcp.ts contract exactly.
fn composio_agent_mcp_config() -> Option<String> {
    use std::os::unix::fs::PermissionsExt;
    let key = crate::ingestion::keychain::get("prevail.ingestion", "composio").ok()?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    let base = std::env::var("PREVAIL_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("{}/.prevail", std::env::var("HOME").unwrap_or_default()));
    let dir = std::path::Path::new(&base);
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join("agent-mcp.json");
    let cfg = serde_json::json!({
        "mcpServers": {
            "composio": {
                "type": "http",
                "url": "https://connect.composio.dev/mcp",
                "headers": { "X-CONSUMER-API-KEY": key }
            }
        }
    });
    let body = serde_json::to_string_pretty(&cfg).ok()?;
    std::fs::write(&path, &body).ok()?;
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    Some(path.to_string_lossy().to_string())
}

// Vault Lock guardrail for the chat agent. Mirrors the CLI bridge's preamble so
// the desktop chat path (which spawns the agent CLI directly) enforces the same
// hard filesystem scope. The agent must refuse anything outside the vault.
fn vault_lock_preamble() -> String {
    "# FILESYSTEM SCOPE - VAULT LOCK IS ON. HARD CONSTRAINT.\n\
     You may only read, write, list, search, or modify files inside the vault (this working directory and its data/ and build/ folders). \
     Do NOT access, read, list, search, or execute ANYTHING outside the vault: no other directories, no home folder, no system paths, no temp dirs, \
     and no tools or commands that reach beyond the vault (e.g. scanning the Mac for files). \
     If a request would require touching files outside the vault, REFUSE and state that Vault Lock is enabled (turn it off in Settings to allow full-machine access).\n\n---\n\n".to_string()
}

fn cli_args(cli: &str, prompt: &str, model: Option<&str>) -> (String, Vec<String>) {
    // Match the prevail CLI's dispatch table. -p / --prompt for one-shot
    // non-interactive mode. When `model` is supplied, inject the right
    // flag for each vendor (ollama uses a positional arg, the rest use
    // --model <id>).
    // Vault Lock: when ON, the agent is confined to the vault. We (1) prepend a
    // hard scope rule, (2) drop the Bash escape hatch + confine file tools to the
    // vault via --add-dir, and (3) skip the external Composio MCP - so a prompt
    // like "scan my Mac for big files" cannot reach outside the vault.
    let locked = crate::vault_lock::vault_lock_enabled();
    let vault = crate::engine::vault_root();
    let prompt_owned = if locked { format!("{}{}", vault_lock_preamble(), prompt) } else { prompt.to_string() };
    let prompt = prompt_owned.as_str();
    match cli {
        "claude" => {
            let mut v = vec!["--dangerously-skip-permissions".to_string()];
            if locked {
                if let Some(ref vp) = vault { v.push("--add-dir".to_string()); v.push(vp.clone()); }
                // Remove the shell escape hatch so the agent can't du/find the
                // whole filesystem; vault file ops still work via Read/Glob/Grep.
                v.push("--disallowedTools".to_string());
                v.push("Bash".to_string());
            }
            if let Some(m) = model {
                v.push("--model".to_string());
                v.push(m.to_string());
            }
            // Give the chat agent the Composio gateway MCP when a key is set, so it
            // can fetch live data for a connected app (Notion, PayPal, etc.) instead
            // of guessing. Skipped when Vault Lock is on (external = out of scope).
            if !locked {
                if let Some(cfg) = composio_agent_mcp_config() {
                    v.push("--mcp-config".to_string());
                    v.push(cfg);
                }
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
            if locked {
                if let Some(ref vp) = vault { v.push("--add-dir".to_string()); v.push(vp.clone()); }
                v.push("--disallowedTools".to_string());
                v.push("Bash".to_string());
            }
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
        "gemini" => {
            // Legacy Gemini CLI: --skip-trust, -m <model>, -p <prompt> (value).
            let mut v = vec!["--skip-trust".to_string()];
            if let Some(m) = model {
                v.push("-m".to_string());
                v.push(m.to_string());
            }
            v.push(format!("--prompt={prompt}"));
            ("gemini".to_string(), v)
        }
        _ => {
            // Additional CLI runtime families (codebuddy/copilot/cursor/kiro/…):
            // best-effort via the de-facto headless convention `<bin> -p -- <prompt>`.
            // No claude-only flags (other CLIs may reject them). The bin is the kind
            // except where they differ (cursor ships `cursor-agent`). A wrong-flag
            // run surfaces as a visible error, never silent.
            let bin = match cli {
                "cursor" => "cursor-agent",
                other => other,
            };
            let mut v = Vec::new();
            if let Some(m) = model {
                v.push("--model".to_string());
                v.push(m.to_string());
            }
            v.push("-p".to_string());
            v.push("--".to_string());
            v.push(prompt.to_string());
            (bin.to_string(), v)
        }
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

pub(crate) fn is_secret_env_key(k: &str) -> bool {
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
    let raw = read_to_string_retry(vault.join("ideal-state.md")).unwrap_or_default();
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

/// Compact a running conversation: one-shot model call that summarizes the
/// transcript into a dense brief preserving the key facts, decisions, open
/// questions, and context — so a fresh chat can continue seamlessly with far
/// fewer tokens. Used by the context-window meter's "Compact" action.
#[tauri::command]
pub(crate) async fn summarize_conversation(
    cli: String,
    model: Option<String>,
    text: String,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("nothing to summarize".into());
    }
    let prompt = format!(
        "You are compacting a chat so it can continue with fewer tokens. Summarize the conversation below into a DENSE brief that preserves everything needed to continue seamlessly: key facts, the user's goals, decisions made, open questions, and any concrete details (names, numbers, dates). Be concise but lose nothing important. Output ONLY the summary, no preamble.\n\nCONVERSATION:\n{text}"
    );
    let m = model.as_deref().filter(|s| !s.trim().is_empty());
    crate::telegram_bridge::run_cli(&cli, m, &prompt).await
}

#[tauri::command]
pub(crate) async fn chat_send(
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
pub(crate) async fn verify_cli_model(args: VerifyArgs) -> Result<String, String> {
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

// One-shot generation — run a CLI once with an arbitrary prompt and return
// the FULL reply. Like verify_cli_model but caller-supplied prompt, no output
// cap, and a tunable timeout. Used by Spark (the serendipity surface) to ask a
// rotating model for a single random thing and show who generated it.
#[derive(Deserialize)]
pub struct OneshotArgs {
    pub cli: String,
    pub model: Option<String>,
    pub prompt: String,
    pub timeout_sec: Option<u64>,
}
#[tauri::command]
pub(crate) async fn model_oneshot(args: OneshotArgs) -> Result<String, String> {
    use tokio::io::AsyncReadExt;
    use tokio::process::Command as TokioCommand;
    use tokio::time::{timeout, Duration};

    let (bin_name, cli_args) = cli_args(&args.cli, &args.prompt, args.model.as_deref());
    let bin_abs = resolve_bin_abs(&bin_name);
    let (combined_path, user, logname) = build_cli_env();

    let mut child = TokioCommand::new(&bin_abs)
        .args(&cli_args)
        .env_clear()
        .envs(scrubbed_env_pairs())
        .env("PATH", combined_path)
        .env("USER", &user)
        .env("LOGNAME", &logname)
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

    let secs = args.timeout_sec.unwrap_or(60).clamp(5, 300);
    match timeout(Duration::from_secs(secs), fut).await {
        Ok((code, out, err)) => {
            if code == 0 && !out.trim().is_empty() {
                Ok(out.trim().to_string())
            } else {
                Err(format!("exit {code}: {}", best_error_line(&err, &out)))
            }
        }
        Err(_) => Err(format!("timed out after {secs}s")),
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
