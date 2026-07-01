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
// Held vault DEK (base64) for the current unlocked session. Set by
// engine_vault_unlock after the user enters their passcode; injected into every
// engine spawn as PREVAIL_VAULT_KEY so the sidecar can read/write the encrypted
// vault. Lives only in the desktop process memory, never on disk, never sent to
// the JS layer. None = vault is plaintext / locked.
// Wrapped in Zeroizing so the DEK's heap buffer is wiped when the slot is
// replaced/cleared (e.g. on lock), instead of lingering in process memory (O29).
static VAULT_KEY: std::sync::Mutex<Option<zeroize::Zeroizing<String>>> = std::sync::Mutex::new(None);
// The encrypted vault's root path — injected as PREVAIL_VAULT_ROOT so the engine
// only encrypts/decrypts files UNDER the vault (never an external path a skill
// might write to).
static VAULT_ROOT: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

// Serializes the tests that mutate the process-global VAULT_KEY/VAULT_ROOT so
// they can't race each other under parallel `cargo test`.
#[cfg(test)]
pub(crate) static KEY_STATE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn set_vault_key(k: Option<String>) {
    // Replacing the slot drops (and thus zeroes) any prior Zeroizing<String>.
    *VAULT_KEY.lock().unwrap_or_else(|e| e.into_inner()) = k.map(zeroize::Zeroizing::new);
}
fn vault_key() -> Option<String> {
    VAULT_KEY
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|z| z.to_string())
}
pub fn set_vault_root(r: Option<String>) {
    *VAULT_ROOT.lock().unwrap_or_else(|e| e.into_inner()) = r;
}
pub(crate) fn vault_root() -> Option<String> {
    VAULT_ROOT.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

// Binary resolution — mirror lib.rs resolve_prevail_bin() /
// resolve_bin_abs() style: check ~/.local/bin, /opt/homebrew/bin,
// /usr/local/bin, then fall back to the bare name (PATH resolution).

pub(crate) fn resolve_prevail_bin() -> String {
    // 1. Bundled engine sidecar — the app ships its own `prevail` engine
    //    (Tauri `externalBin`) so a fresh download is fully self-contained
    //    and never depends on a separately-installed CLI. Tauri places the
    //    sidecar next to the app's main executable (Contents/MacOS/prevail,
    //    target-triple stripped at bundle time).
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.join("prevail")));
    if let Some(sidecar) = &bundled {
        if sidecar.exists() {
            return sidecar.to_string_lossy().to_string();
        }
    }
    // SECURITY — fail closed in release builds. The sidecar is handed the
    // decrypted vault key (PREVAIL_VAULT_KEY). A packaged build ALWAYS ships the
    // sidecar next to the app binary (step 1), so if that missed we must NOT
    // fall through to user-writable dirs (~/.local/bin, ~/.bun/bin) or a bare
    // $PATH lookup: a `prevail` planted there would capture the vault key.
    // Return the expected bundled path so the spawn fails loudly at the right
    // location rather than silently running an attacker binary.
    #[cfg(not(debug_assertions))]
    {
        return bundled
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "prevail".to_string());
    }
    // 2. Dev only (`tauri dev`, debug build): no bundled sidecar sits next to
    //    the debug binary, so fall back to a locally installed CLI.
    #[cfg(debug_assertions)]
    {
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
}

/// Where the bundled engine looks for (and auto-installs, on first browser use)
/// its Chromium for browser connectors. Injected as PLAYWRIGHT_BROWSERS_PATH on
/// every engine spawn. Chromium is NOT bundled in the signed app — the engine
/// downloads it here on demand, which deliberately avoids deep-signing/
/// notarizing Chromium's helper apps. Needs the hardened-runtime entitlement
/// `com.apple.security.cs.allow-dyld-environment-variables` to survive the spawn.
pub(crate) fn playwright_browsers_path() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    Some(
        Path::new(&home)
            .join("Library/Application Support/sh.prevail.desktop/playwright-browsers")
            .to_string_lossy()
            .to_string(),
    )
}

/// Where the bundled engine finds the default skill packs (domains/<d>/_skills,
/// apps/<id>/skills) it seeds into new domains/apps. Shipped as a Tauri resource;
/// injected as PREVAIL_SKILL_PACKS_DIR on every engine spawn so the sidecar in the
/// packaged app can locate it. Returned ONLY when the dir actually exists — in dev
/// there is no bundled resource, and the sidecar finds skill-packs by repo
/// adjacency instead, so we must not point it at a missing path.
pub(crate) fn skill_packs_path() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for c in [
        dir.join("../Resources/skill-packs"), // macOS .app bundle (Contents/Resources)
        dir.join("skill-packs"),              // windows/linux: beside the exe
        dir.join("resources/skill-packs"),    // dev resource layout
    ] {
        if c.exists() {
            return Some(c.to_string_lossy().to_string());
        }
    }
    None
}

// ─────────────────────────────────────────────────────────────────────
// Generic helpers

/// Spawn `prevail <args>` (no `--json`), capture trimmed stdout as text.
/// For engine subcommands that emit plain logs rather than JSON (e.g. the
/// loop runner's `daemon --loops --once`). Same enriched env + vault key as
/// `run_engine_json`. Empty stdout is allowed (returns "").
pub fn run_engine_raw(args: &[&str]) -> Result<String, String> {
    use std::process::Command;

    let bin = resolve_prevail_bin();
    let (combined_path, user, logname) = crate::build_cli_env();

    let mut cmd = Command::new(&bin);
    cmd.args(args)
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        .stdin(std::process::Stdio::null());
    if let Some(k) = vault_key() {
        cmd.env("PREVAIL_VAULT_KEY", k);
    }
    for (k, v) in provider_env_pairs() {
        cmd.env(k, v);
    }
    for (k, v) in gateway_env_pairs() {
        cmd.env(k, v);
    }
    if let Some(r) = vault_root() {
        cmd.env("PREVAIL_VAULT_ROOT", r);
    }
    if let Some(p) = playwright_browsers_path() {
        cmd.env("PLAYWRIGHT_BROWSERS_PATH", p);
    }
    if let Some(p) = skill_packs_path() {
        cmd.env("PREVAIL_SKILL_PACKS_DIR", p);
    }
    let out = cmd.output().map_err(|e| format!("spawn {bin} failed: {e}"))?;
    if !out.status.success() {
        let code = out.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("prevail exited {code}: {}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

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

    let mut cmd = Command::new(&bin);
    cmd.args(&full)
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        .stdin(std::process::Stdio::null());
    if let Some(k) = vault_key() {
        cmd.env("PREVAIL_VAULT_KEY", k);
    }
    for (k, v) in provider_env_pairs() {
        cmd.env(k, v);
    }
    for (k, v) in gateway_env_pairs() {
        cmd.env(k, v);
    }
    if let Some(r) = vault_root() {
        cmd.env("PREVAIL_VAULT_ROOT", r);
    }
    if let Some(p) = playwright_browsers_path() {
        cmd.env("PLAYWRIGHT_BROWSERS_PATH", p);
    }
    if let Some(p) = skill_packs_path() {
        cmd.env("PREVAIL_SKILL_PACKS_DIR", p);
    }
    let out = cmd.output().map_err(|e| format!("spawn {bin} failed: {e}"))?;

    if !out.status.success() {
        let code = out.status.code().unwrap_or(-1);
        // Fix #18 (opacity): surface the REAL cause. Prefer stderr, but many engine
        // failures (connect agent, connectors) write a JSON `{ ok:false, error }`
        // to STDOUT and exit nonzero with an empty stderr, so fall back to stdout
        // so the UI never shows a bare "prevail exited 1" with no reason.
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stderr = stderr.trim();
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stdout = stdout.trim();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("prevail exited {code}: {detail}"));
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

    let mut cmd = Command::new(&bin);
    cmd.args(&full)
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(k) = vault_key() {
        cmd.env("PREVAIL_VAULT_KEY", k);
    }
    for (k, v) in provider_env_pairs() {
        cmd.env(k, v);
    }
    for (k, v) in gateway_env_pairs() {
        cmd.env(k, v);
    }
    if let Some(r) = vault_root() {
        cmd.env("PREVAIL_VAULT_ROOT", r);
    }
    if let Some(p) = playwright_browsers_path() {
        cmd.env("PLAYWRIGHT_BROWSERS_PATH", p);
    }
    if let Some(p) = skill_packs_path() {
        cmd.env("PREVAIL_SKILL_PACKS_DIR", p);
    }
    let mut child = cmd.spawn().map_err(|e| format!("spawn {bin} failed: {e}"))?;

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
        // Fix #18 (opacity): prefer stderr, fall back to stdout (where the engine
        // often writes a JSON `{ ok:false, error }` on a nonzero exit).
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stderr = stderr.trim();
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stdout = stdout.trim();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("prevail exited {code}: {detail}"));
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
/// The seam for streaming engine commands. Wired to `engine_score_stream`
/// (`prevail score --all --stream`); reuse it for future streaming commands.
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

    let mut scmd = TokioCommand::new(&bin);
    scmd.args(&full)
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(k) = vault_key() {
        scmd.env("PREVAIL_VAULT_KEY", k);
    }
    for (k, v) in provider_env_pairs() {
        scmd.env(k, v);
    }
    for (k, v) in gateway_env_pairs() {
        scmd.env(k, v);
    }
    if let Some(r) = vault_root() {
        scmd.env("PREVAIL_VAULT_ROOT", r);
    }
    if let Some(p) = playwright_browsers_path() {
        scmd.env("PLAYWRIGHT_BROWSERS_PATH", p);
    }
    if let Some(p) = skill_packs_path() {
        scmd.env("PREVAIL_SKILL_PACKS_DIR", p);
    }
    let mut child = scmd.spawn().map_err(|e| format!("spawn {bin} failed: {e}"))?;

    // Track the child by session so the UI can stop it (abort_sessions). This is
    // what makes a streamed loop run killable: "Stop" / "Stop run" SIGTERMs the
    // pid registered here, the child exits, and `<prefix>:done` fires as usual.
    if let Some(pid) = child.id() {
        crate::children::register_child(&session, pid);
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
        crate::children::unregister_child(&session_done);
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

/// Fire a native OS notification (e.g. "Loops finished on Calendar"). Thin
/// wrapper over the notification plugin so the frontend can notify without a
/// separate JS plugin dependency. Best-effort: a failure to notify never errors.
#[tauri::command]
pub fn notify_user(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
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
    // Vault Lock: orthogonal to Bunker. Tell the engine to keep all file access
    // inside the vault directory.
    if crate::vault_lock::vault_lock_enabled() {
        cmd.env("PREVAIL_VAULT_LOCK", "1");
    }
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
        // Direct single-vendor providers (G1): inject each configured key as
        // PREVAIL_<ID>_KEY (the PREVAIL_ prefix dodges the engine's scrubbedEnv
        // strip list). The engine's DIRECT_PROVIDERS table reads these to make
        // the provider available + route to it.
        for (id, env_key) in DIRECT_PROVIDER_ENVS {
            if let Ok(key) = crate::ingestion::keychain::get("prevail.providers", id) {
                if !key.is_empty() {
                    cmd.env(env_key, key);
                }
            }
        }
        // App connector secrets (PayPal Client ID/Secret, etc.): each app's
        // auth_env_vars are stored in the Keychain (service "prevail.appsecrets")
        // and injected here by exact env-var name so the engine's connectors can
        // authenticate + fetch. Index of names lives at ~/.prevail/appsecrets.index
        // (names only, never values). Cloud creds → gated by Bunker, like above.
        for (k, v) in app_secret_env_pairs() {
            cmd.env(k, v);
        }
        // Gateway connector keys (Composio / Nango) so the engine can authenticate
        // its gateway calls. Cloud creds, so gated by Bunker like the keys above.
        for (k, v) in gateway_env_pairs() {
            cmd.env(k, v);
        }
    }
    // Per-call env overrides (e.g. PREVAIL_OLLAMA_URL redirect so the engine's
    // local provider path reaches LM Studio / MLX instead of Ollama). Local-only,
    // so safe under Bunker Mode.
    for (k, v) in &extra_env {
        cmd.env(k, v);
    }
    if let Some(k) = vault_key() {
        cmd.env("PREVAIL_VAULT_KEY", k);
    }
    if let Some(r) = vault_root() {
        cmd.env("PREVAIL_VAULT_ROOT", r);
    }
    if let Some(p) = playwright_browsers_path() {
        cmd.env("PLAYWRIGHT_BROWSERS_PATH", p);
    }
    if let Some(p) = skill_packs_path() {
        cmd.env("PREVAIL_SKILL_PACKS_DIR", p);
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

/// The user's REAL connected apps as the engine sees them (community apps under
/// ~/.prevail/apps + vault apps), with connection + sync state. This is the
/// live counterpart to the static connector catalog: what is actually wired up.
#[tauri::command]
pub fn engine_apps_list(vault: Option<String>) -> Result<serde_json::Value, String> {
    // Scope the listing to the SAME vault the UI adds into. engine_app_add passes
    // --vault explicitly; if the list relied only on the ambient env it could
    // resolve a DIFFERENT vault (the user may have several), so a just-added app
    // would never appear and the UI would treat it as not-connected. Pass --vault
    // when we have it so add and list always agree.
    match vault.filter(|v| !v.trim().is_empty()) {
        Some(v) => run_engine_json(&["connectors", "list", "--vault", &v, "--json"]),
        None => run_engine_json(&["connectors", "list", "--json"]),
    }
}

/// Probe one app's connectivity/auth (api/oauth/browser/mcp/cli/manual).
/// Returns the structured ProbeResult: { ok, status, message, fixHint?, ... }.
#[tauri::command]
pub fn engine_app_probe(id: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "test", &id, "--json"])
}

/// Composio gateway: register it in the vault's agent .mcp.json + scaffold the
/// "composio" app. After this the user authorizes once (engine_composio_authorize).
#[tauri::command]
pub fn engine_composio_connect() -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "composio", "--json"])
}

/// Composio status: { configured, authorized }.
#[tauri::command]
pub fn engine_composio_status() -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "composio", "--status", "--json"])
}

/// Drive the one-time Composio OAuth. Long-running: spawns the engine which
/// spawns `npx mcp-remote`, opening the browser for the user to sign in; returns
/// when the connection is authorized (or times out). Runs off the UI thread.
#[tauri::command]
pub async fn engine_composio_authorize() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        run_engine_json(&["connectors", "composio", "--auth", "--json"])
    })
    .await
    .map_err(|e| format!("composio auth task failed: {e}"))?
}

/// Manual fallback: mark Composio authorized after the user confirms they signed
/// in (mcp-remote has cached the token). Used if auto-detection misses.
#[tauri::command]
pub fn engine_composio_confirm() -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "composio", "--confirm", "--json"])
}

// ── Composio CLI (browser-OAuth setup, an alternative to the MCP key) ──────
// These shell out to the official `composio` CLI rather than the prevail engine.
// They are pure SETUP helpers: the agent still uses the Composio MCP under the
// hood, so connecting an app stays on the existing composio_connect_app path.
// PATH is built the same way build_cli_env() does (so a Finder-launched app can
// find binaries) plus ~/.composio/bin where the official installer drops it.

/// PATH enriched with ~/.composio/bin (where the official installer puts the
/// `composio` binary) on top of the well-known CLI dirs from build_cli_env().
fn composio_cli_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let (base, _user, _logname) = crate::build_cli_env();
    if home.is_empty() {
        base
    } else {
        format!("{home}/.composio/bin:{base}")
    }
}

/// Resolve the `composio` binary: `which` first, then the well-known install
/// locations. Returns the full path, or None when nothing is found.
fn resolve_composio_bin() -> Option<String> {
    use std::process::Command;
    let path = composio_cli_path();
    // `which composio` honoring our enriched PATH.
    if let Ok(out) = Command::new("which")
        .arg("composio")
        .env("PATH", &path)
        .stdin(std::process::Stdio::null())
        .output()
    {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() && Path::new(&p).exists() {
                return Some(p);
            }
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.composio/bin/composio"),
        "/opt/homebrew/bin/composio".to_string(),
        "/usr/local/bin/composio".to_string(),
        format!("{home}/.local/bin/composio"),
    ];
    for c in &candidates {
        if Path::new(c).exists() {
            return Some(c.clone());
        }
    }
    None
}

/// Cap process output so a chatty installer/login can't blow up the JSON payload.
pub(crate) fn cap_output(s: &str) -> String {
    let s = s.trim();
    if s.len() <= 4000 {
        s.to_string()
    } else {
        let head: String = s.chars().take(4000).collect();
        format!("{head}\n… (truncated)")
    }
}

/// Composio CLI status: is the `composio` binary installed, and is it logged in?
/// Defensive — any failure resolves to installed/loggedIn false, never an Err.
/// Returns { installed, loggedIn, account, bin }.
#[tauri::command]
pub fn composio_cli_status() -> Result<serde_json::Value, String> {
    use std::process::Command;
    let bin = match resolve_composio_bin() {
        Some(b) => b,
        None => {
            return Ok(serde_json::json!({
                "installed": false, "loggedIn": false, "account": null, "bin": null
            }));
        }
    };
    let path = composio_cli_path();
    // Prefer `whoami`; fall back to `--version` just to confirm the binary runs.
    let mut logged_in = false;
    let mut account: Option<String> = None;
    let whoami = Command::new(&bin)
        .arg("whoami")
        .env("PATH", &path)
        .stdin(std::process::Stdio::null())
        .output();
    if let Ok(out) = whoami {
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        let lower = text.to_lowercase();
        // Treat a clean exit that doesn't read like "not logged in" as logged in.
        let looks_logged_out = lower.contains("not logged in")
            || lower.contains("please login")
            || lower.contains("please log in")
            || lower.contains("no active")
            || lower.contains("unauthenticated")
            || lower.contains("login required");
        if out.status.success() && !looks_logged_out {
            logged_in = true;
            // Best-effort account extraction: first email-looking token.
            let acct = text
                .split_whitespace()
                .find(|t| t.contains('@') && t.contains('.'))
                .map(|t| t.trim_matches(|c: char| !c.is_ascii_graphic()).to_string())
                .filter(|s| !s.is_empty());
            account = acct;
        }
    }
    Ok(serde_json::json!({
        "installed": true,
        "loggedIn": logged_in,
        "account": account,
        "bin": bin,
    }))
}

/// Install the Composio CLI via the official installer. Long-ish but finite;
/// runs off the UI thread. Returns { ok, output } (output capped).
#[tauri::command]
pub async fn composio_cli_install(_app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use std::process::Command;
        let path = composio_cli_path();
        let (_p, user, logname) = crate::build_cli_env();
        let out = Command::new("bash")
            .arg("-lc")
            // Download the installer to a temp file, then run it — don't pipe
            // remote code straight into bash (O37). The script never bypasses
            // disk, so it's inspectable and the download can fail cleanly.
            // (Cryptographic SHA-pinning awaits an upstream-published checksum.)
            .arg("set -euo pipefail; t=\"$(mktemp -t composio-install.XXXXXX)\"; curl -fsSL https://composio.dev/install -o \"$t\"; bash \"$t\"; rm -f \"$t\"")
            .env_clear()
            .envs(crate::scrubbed_env_pairs())
            .env("PATH", path)
            .env("USER", user)
            .env("LOGNAME", logname)
            .stdin(std::process::Stdio::null())
            .output();
        match out {
            Ok(o) => {
                let combined = format!(
                    "{}{}",
                    String::from_utf8_lossy(&o.stdout),
                    String::from_utf8_lossy(&o.stderr)
                );
                serde_json::json!({ "ok": o.status.success(), "output": cap_output(&combined) })
            }
            Err(e) => serde_json::json!({ "ok": false, "output": format!("install failed: {e}") }),
        }
    })
    .await
    .map_err(|e| format!("composio install task failed: {e}"))
}

/// Run `composio login` (browser OAuth). Interactive + long-running: opens a
/// browser and waits for the user, so it uses a generous timeout. Returns
/// { ok, output } (output capped). If the binary is missing, returns ok:false.
#[tauri::command]
pub async fn composio_cli_login(_app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use std::process::Command;
        let bin = match resolve_composio_bin() {
            Some(b) => b,
            None => {
                return serde_json::json!({ "ok": false, "output": "Composio CLI not installed" });
            }
        };
        let path = composio_cli_path();
        let (_p, user, logname) = crate::build_cli_env();
        // Wrap in `timeout` so a never-completing browser auth can't hang the
        // child forever. macOS lacks GNU coreutils `timeout` by default, so run
        // the binary directly and rely on the child finishing once the user
        // signs in (or closes the tab). The 300s budget is the user's window.
        let out = Command::new(&bin)
            .arg("login")
            .env_clear()
            .envs(crate::scrubbed_env_pairs())
            .env("PATH", path)
            .env("USER", user)
            .env("LOGNAME", logname)
            .stdin(std::process::Stdio::null())
            .output();
        match out {
            Ok(o) => {
                let combined = format!(
                    "{}{}",
                    String::from_utf8_lossy(&o.stdout),
                    String::from_utf8_lossy(&o.stderr)
                );
                serde_json::json!({ "ok": o.status.success(), "output": cap_output(&combined) })
            }
            Err(e) => serde_json::json!({ "ok": false, "output": format!("login failed: {e}") }),
        }
    })
    .await
    .map_err(|e| format!("composio login task failed: {e}"))
}

/// Scaffold a new app from a catalog pick — writes ~/.prevail/apps/<id>/ so it
/// becomes a real connectable App. Returns { ok, path?, error? }.
#[tauri::command]
pub fn engine_app_add(
    vault: String,
    id: String,
    title: String,
    integration: String,
    domains: Vec<String>,
    mcp_command: Option<String>,
    mcp_install: Option<String>,
) -> Result<serde_json::Value, String> {
    let doms = domains.join(",");
    // Pass --vault explicitly: `connectors add` resolves the vault from this
    // flag first, so the scaffold lands in the real vault even if the engine's
    // PREVAIL_VAULT_ROOT env wasn't set for this call (which otherwise made it
    // fall back to a bogus default path and fail with EROFS).
    let mut args: Vec<String> = vec![
        "connectors".into(), "add".into(), "--id".into(), id, "--title".into(), title,
        "--integration".into(), integration, "--domains".into(), doms,
        "--vault".into(), vault,
    ];
    // MCP servers carry their stdio spawn command (and optional one-time install)
    // so the connector knows how to launch the server. Only forwarded when set.
    if let Some(c) = mcp_command { if !c.trim().is_empty() { args.push("--mcp-command".into()); args.push(c); } }
    if let Some(i) = mcp_install { if !i.trim().is_empty() { args.push("--mcp-install".into()); args.push(i); } }
    args.push("--json".into());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_engine_json(&refs)
}

/// Scaffold a GATEWAY app (Composio / Nango) for a toolkit pick. Unlike
/// engine_app_add (a generic catalog scaffold), this tags the app as a gateway
/// app wired to the given provider so syncs run through the gateway connection.
/// Returns { ok, path?, error? }.
#[tauri::command]
pub fn engine_gateway_app_add(
    provider: String,
    toolkit: String,
    id: String,
    title: String,
) -> Result<serde_json::Value, String> {
    run_engine_json(&[
        "connectors", "gateway-add",
        "--provider", &provider,
        "--toolkit", &toolkit,
        "--id", &id,
        "--title", &title,
        "--json",
    ])
}

/// Rewrite an app's many-to-many domain binding. Pass the full desired list;
/// the engine normalizes/validates/dedups and writes only the manifest's
/// `domains` array. Returns { ok, path?, domains?, error? }.
#[tauri::command]
pub fn engine_app_set_domains(id: String, domains: Vec<String>) -> Result<serde_json::Value, String> {
    let doms = domains.join(",");
    run_engine_json(&["connectors", "set", &id, "domains", &doms, "--json"])
}

/// A2: change how a connected app connects (api | oauth | browser | mcp | manual).
#[tauri::command]
pub fn engine_app_set_integration(id: String, integration: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "set", &id, "integration", &integration, "--json"])
}

/// APP-4: set (or clear) an app's autonomous-sync schedule. `every` is the
/// cadence the engine validates (hourly | <2-23>h | daily | weekly), with an
/// optional HH:MM `at` and weekday `on`; "off"/"none"/"" clears the schedule.
/// Returns { ok, path?, refresh?, error? }.
#[tauri::command]
pub fn engine_app_set_schedule(
    id: String,
    every: String,
    at: Option<String>,
    on: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<String> = vec![
        "connectors".into(), "set".into(), id, "refresh".into(), every,
    ];
    if let Some(a) = at { if !a.trim().is_empty() { args.push("at".into()); args.push(a); } }
    if let Some(o) = on { if !o.trim().is_empty() { args.push("on".into()); args.push(o); } }
    args.push("--json".into());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_engine_json(&refs)
}

/// Set (or clear) an app's "what to pull" instruction, which the gateway sync
/// injects so the user controls exactly what each sync fetches. Empty clears it.
#[tauri::command]
pub fn engine_app_set_pull_instructions(id: String, instructions: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "set", &id, "instructions", &instructions, "--json"])
}

/// Read an app's soul note (apps/<id>/soul.md) — the same construct domains use,
/// declaring WHY the app is in the user's harness. The agent reads it on every
/// run. Returns { ok, soul, path? }.
#[tauri::command]
pub fn engine_app_get_soul(id: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "soul", &id, "--json"])
}

/// Write (or clear, when empty) an app's soul note. Returns { ok, path?, soul? }.
#[tauri::command]
pub fn engine_app_set_soul(id: String, soul: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "set", &id, "soul", &soul, "--json"])
}

/// AI-draft an app's Ideal State (its soul.md) from the app's real context —
/// catalog description, existing note, domains it feeds, skills, connection
/// method — optionally web-researching the app for best-practice capabilities.
/// Mirrors `domain_draft_ideal` (the per-domain drafter) for apps, but shells
/// the sidecar (which owns the app catalog + CLI detection) rather than calling
/// the model in-process. Returns the drafted markdown for the editor to show;
/// the user reviews, edits, and Saves — which writes the SAME soul.md the chat
/// and agent read, so drafting here or from chat lands on one file.
/// Returns the raw draft string (not JSON) so the UI can drop it straight into
/// the editor.
#[tauri::command]
pub fn engine_app_draft_ideal(id: String, provider: String, model: String) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["connectors", "draft-ideal", &id];
    if !provider.trim().is_empty() {
        args.push("--cli");
        args.push(&provider);
    }
    if !model.trim().is_empty() {
        args.push("--model");
        args.push(&model);
    }
    // run_engine_json appends --json, so the sidecar emits { ok, draft } | { ok:false, error }.
    let v = run_engine_json(&args)?;
    if v.get("ok").and_then(|b| b.as_bool()) == Some(false) {
        return Err(v.get("error").and_then(|e| e.as_str()).unwrap_or("draft failed").to_string());
    }
    let draft = v.get("draft").and_then(|d| d.as_str()).unwrap_or("").trim().to_string();
    if draft.is_empty() {
        return Err("the model returned an empty draft".into());
    }
    Ok(draft)
}

/// AI-draft a complete, valid SKILL.md for a domain from a plain-language
/// description. Shells the sidecar `skill-draft --json`, which gathers the
/// domain's real context (ideal state, memory, state, goals, recent decisions
/// and intents) and drafts a full skill in the SKILL.md format (frontmatter +
/// heading + prompt body). Mirrors `engine_app_draft_ideal` / `domain_draft_ideal`:
/// the desktop drops the returned body into the NewSkillForm editor for review,
/// and the existing `skill_create` Save writes it. Bunker-mode aware in the CLI.
/// Returns the full SKILL.md text so the editor can show it verbatim.
#[tauri::command]
pub fn engine_skill_draft(
    vault: String,
    domain: String,
    name: String,
    describe: String,
    provider: String,
    model: String,
) -> Result<String, String> {
    let mut args: Vec<&str> = vec![
        "skill-draft",
        "--domain",
        &domain,
        "--name",
        &name,
        "--describe",
        &describe,
        "--vault",
        &vault,
    ];
    if !provider.trim().is_empty() {
        args.push("--cli");
        args.push(&provider);
    }
    if !model.trim().is_empty() {
        args.push("--model");
        args.push(&model);
    }
    // run_engine_json appends --json, so the sidecar emits
    // { ok, name, body } | { ok:false, error }.
    let v = run_engine_json(&args)?;
    if v.get("ok").and_then(|b| b.as_bool()) == Some(false) {
        return Err(v
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("draft failed")
            .to_string());
    }
    let body = v.get("body").and_then(|d| d.as_str()).unwrap_or("").trim().to_string();
    if body.is_empty() {
        return Err("the model returned an empty draft".into());
    }
    Ok(body)
}

/// AI-suggest a few skill IDEAS (name + one-line describe) for a domain, based
/// on its context. Shells the sidecar `skill-draft --ideas --json`. This never
/// writes anything: the user turns a chosen idea into a real draft via
/// `engine_skill_draft`. Returns the raw JSON value { ok, ideas: [{name, describe}] }
/// so the UI can render the suggestions without a second call.
#[tauri::command]
pub fn engine_skill_ideas(
    vault: String,
    domain: String,
    provider: String,
    model: String,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<&str> = vec!["skill-draft", "--domain", &domain, "--ideas", "--vault", &vault];
    if !provider.trim().is_empty() {
        args.push("--cli");
        args.push(&provider);
    }
    if !model.trim().is_empty() {
        args.push("--model");
        args.push(&model);
    }
    let v = run_engine_json(&args)?;
    if v.get("ok").and_then(|b| b.as_bool()) == Some(false) {
        return Err(v
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("suggest failed")
            .to_string());
    }
    Ok(v)
}

/// AI-curate a LIBRARY of Arena presets over the model universe the desktop
/// enumerated. Shells the sidecar `bench preset-suggest --json`, passing the
/// available-model list (each: { key: "cli::model", label, provider, validated,
/// local, tier }) on STDIN so a large list never blows the argv limit. The
/// sidecar grounds every returned key against that list, so a hallucinated model
/// can never reach the UI. Mirrors `engine_skill_ideas`: never writes anything;
/// the desktop renders the returned presets as cards the user can Apply / Run /
/// Save. Bunker-mode aware in the CLI. Returns { ok, presets: [{ name, rationale,
/// models }] } so the UI can render without a second call.
#[tauri::command]
pub fn engine_bench_preset_suggest(
    models_json: String,
    provider: String,
    model: String,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<&str> = vec!["bench", "preset-suggest"];
    if !provider.trim().is_empty() {
        args.push("--cli");
        args.push(&provider);
    }
    if !model.trim().is_empty() {
        args.push("--model");
        args.push(&model);
    }
    // The available-model list rides on stdin (see run_engine_json_stdin); the
    // sidecar reads it when --models-json is absent. run_engine_json_stdin
    // appends --json, so the sidecar emits { ok, presets } | { ok:false, error }.
    let v = run_engine_json_stdin(&args, &models_json)?;
    if v.get("ok").and_then(|b| b.as_bool()) == Some(false) {
        return Err(v
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("preset suggest failed")
            .to_string());
    }
    Ok(v)
}

// ─────────────────────────────────────────────────────────────────────
// Autonomy controls (the global brake) + playbooks (the orchestrator).

/// Global autonomy state + per-action-class policy. Returns
/// { state: "active"|"paused", policy: {...}, monthlyFinancialCapUsd }.
#[tauri::command]
pub fn engine_autonomy_status() -> Result<serde_json::Value, String> {
    run_engine_json(&["autonomy", "status", "--json"])
}

/// Set the master autonomy mode: "paused" (kill switch) | "ask" (propose, you
/// approve) | "auto" (run allow-policy actions unattended). Legacy "pause"/
/// "resume" are accepted by the engine too.
#[tauri::command]
pub fn engine_autonomy_set(state: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["autonomy", &state, "--json"])
}

/// Set (or clear, with "off") the monthly financial spend cap in USD.
#[tauri::command]
pub fn engine_autonomy_cap(cap: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["autonomy", "cap", &cap, "--json"])
}

/// Set the pre-emptive policy for an action class: allow | ask | never.
#[tauri::command]
pub fn engine_autonomy_policy(class: String, decision: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["autonomy", "policy", &class, &decision, "--json"])
}

/// List available playbooks: [{ id, name, goal }].
#[tauri::command]
pub fn engine_list_playbooks() -> Result<serde_json::Value, String> {
    run_engine_json(&["playbooks", "--json"])
}

/// Run a playbook, streaming step progress as `playbook_run:line` /
/// `playbook_run:done` events the desktop renders as a live timeline.
#[tauri::command]
pub async fn engine_run_playbook_stream(
    app: tauri::AppHandle,
    id: String,
    session: String,
) -> Result<(), String> {
    let args = vec!["run-playbook".to_string(), id, "--stream".to_string()];
    run_engine_stream(app, session, args, "playbook_run").await
}

/// Discover what data a gateway app CAN provide (one agent turn over the
/// gateway). Long-running like a sync; returns { ok, markdown?, error? }.
#[tauri::command]
pub fn engine_app_gateway_capabilities(id: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "gateway-capabilities", &id, "--json"])
}

/// Enable / disable an app's autonomous sync. A disabled app stays configured
/// and chattable; only the sync daemon's scheduled tick skips it (an explicit
/// "Sync now" still runs). Returns { ok, path?, enabled?, error? }.
#[tauri::command]
pub fn engine_app_set_enabled(id: String, enabled: bool) -> Result<serde_json::Value, String> {
    run_engine_json(&[
        "connectors", "set", &id, "enabled",
        if enabled { "true" } else { "false" }, "--json",
    ])
}

/// Sync one app on demand ("Sync now"). Returns { ok, artifacts, error? }.
#[tauri::command]
pub fn engine_app_sync(id: String, vault: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "sync", &id, "--vault", &vault, "--json"])
}

/// Fully delete a user-installed connector (removes its whole folder). Bundled
/// connectors are refused by the engine. Returns { ok, removed?, error? }.
#[tauri::command]
pub fn engine_app_remove(id: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "remove", &id, "--json"])
}

/// List the data files a connector has actually loaded (apps redesign: "showcase
/// what data has been loaded in the app's folder"). Reads <vault>/data/apps/<id>/
/// data/** recursively → [{ path, name, bytes, mtime }], newest first. Empty when
/// nothing's been synced yet.
#[tauri::command]
pub fn app_data_files(vault: String, app_id: String) -> Result<Vec<serde_json::Value>, String> {
    let base = crate::paths::data_root(&vault).join("apps").join(&app_id).join("data");
    fn walk(dir: &std::path::Path, base: &std::path::Path, out: &mut Vec<serde_json::Value>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { walk(&p, base, out); continue; }
            if !p.is_file() { continue; }
            let meta = e.metadata().ok();
            let bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let mtime = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let rel = p.strip_prefix(base).unwrap_or(&p).to_string_lossy().to_string();
            out.push(serde_json::json!({ "path": p.to_string_lossy(), "name": rel, "bytes": bytes, "mtime": mtime }));
        }
    }
    let mut out = Vec::new();
    walk(&base, &base, &mut out);
    out.sort_by(|a, b| b["mtime"].as_u64().unwrap_or(0).cmp(&a["mtime"].as_u64().unwrap_or(0)));
    Ok(out)
}

/// Run an OAuth app's sign-in flow (`connectors oauth <id>`): opens the browser
/// to the provider's consent screen, captures the loopback redirect, and persists
/// the refresh token. Blocks until the flow completes. The desktop then runs a
/// verify sync. Used by the per-app "Sign in" button.
#[tauri::command]
pub fn engine_app_oauth(id: String, vault: String) -> Result<serde_json::Value, String> {
    let out = run_engine_raw(&["--vault", &vault, "connectors", "oauth", &id])?;
    Ok(serde_json::json!({ "ok": true, "output": out }))
}

/// Agentic browser login: opens a real browser to the connector's login page so
/// the user does only their own login, then persists the session for headless
/// reuse. Long-running + interactive (like oauth), so it uses the raw spawn.
#[tauri::command]
pub fn engine_app_browser_login(id: String) -> Result<serde_json::Value, String> {
    let out = run_engine_raw(&["connectors", "browser-login", &id])?;
    Ok(serde_json::json!({ "ok": true, "output": out }))
}

/// The proactive Recommendations feed: domains to create (from recurring
/// intents), best model per benchmarked domain, and domains with no app feeding
/// them. Computed from existing vault signals. Returns { ok, recommendations }.
#[tauri::command]
pub fn engine_recommendations(vault: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["recommendations", "--vault", &vault, "--json"])
}

/// Read the stored per-domain app suggestions (the learning layer's output).
/// Reads the file directly (build-first, legacy fallback) so it's cheap to call
/// on every Apps view mount. Returns {} when none generated yet.
#[tauri::command]
pub fn app_suggestions_read(vault: String) -> Result<serde_json::Value, String> {
    let p = crate::paths::runtime_path(&vault, "_meta").join("app_suggestions.json");
    match crate::read_to_string_retry(&p) {
        Ok(raw) => Ok(serde_json::from_str(&raw).unwrap_or(serde_json::json!({}))),
        Err(_) => Ok(serde_json::json!({})),
    }
}

/// Generate app suggestions for a domain (or "all") by learning from its signals,
/// then return the full suggestions map. This is a model call, so it blocks until
/// the CLI finishes; the UI awaits it. A daily daemon can call the same path.
#[tauri::command]
pub fn app_suggestions_generate(
    vault: String,
    domain: String,
    cli: Option<String>,
    model: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<String> = vec![
        "suggest-apps".into(),
        "--domain".into(), domain,
        "--vault".into(), vault,
    ];
    if let Some(c) = cli.filter(|s| !s.is_empty()) { args.push("--cli".into()); args.push(c); }
    if let Some(m) = model.filter(|s| !s.is_empty()) { args.push("--model".into()); args.push(m); }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_engine_json(&refs)
}

/// Read the Model Scout's latest web-search results (models worth adding to the
/// Arena benchmark). Cheap file read; returns {} when the scout hasn't run yet.
#[tauri::command]
pub fn model_suggestions_read(vault: String) -> Result<serde_json::Value, String> {
    let p = crate::paths::runtime_path(&vault, "_meta").join("model_suggestions.json");
    match crate::read_to_string_retry(&p) {
        Ok(raw) => Ok(serde_json::from_str(&raw).unwrap_or(serde_json::json!({}))),
        Err(_) => Ok(serde_json::json!({})),
    }
}

/// Force a Model Scout pass now (web search). The CLI scan (web search + model
/// call) is slow, so it runs on a blocking thread via spawn_blocking: the command
/// is async and never blocks the main/UI thread, so the app stays responsive while
/// it scans. `known` is a comma-joined list of models already in the benchmark, so
/// the scout proposes only NEW ones.
#[tauri::command]
pub async fn model_scout_run(
    vault: String,
    known: Option<String>,
    cli: Option<String>,
    model: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args: Vec<String> = vec![
            "scout-models".into(),
            "--vault".into(), vault,
            "--json".into(),
        ];
        if let Some(k) = known.filter(|s| !s.is_empty()) { args.push("--known".into()); args.push(k); }
        if let Some(c) = cli.filter(|s| !s.is_empty()) { args.push("--cli".into()); args.push(c); }
        if let Some(m) = model.filter(|s| !s.is_empty()) { args.push("--model".into()); args.push(m); }
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_engine_json(&refs)
    })
    .await
    .map_err(|e| format!("model scout task failed: {e}"))?
}

/// Run one autonomous-sync pass over every DUE app (the in-app scheduler calls
/// this on a tick; the headless `daemon --sync` runs the same on a loop).
/// Returns { ran, ok, failed }.
#[tauri::command]
pub fn engine_apps_sync_due(vault: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "sync-due", "--vault", &vault, "--json"])
}

/// Connection Agent: given an app name + a plain-language goal, research the best
/// available connection method (MCP/API/CLI/Composio/browser), scaffold the app,
/// and return a plan { ok, plan:{integration, why, auth_step, schedule, domains,
/// data}, error? }. This is the describe-the-goal alternative to catalog forms.
#[tauri::command]
pub fn engine_app_connect(
    name: String,
    goal: String,
    vault: String,
    provider: Option<String>,
    model: Option<String>,
    reevaluate: Option<bool>,
    current: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<String> = vec![
        "connectors".into(), "connect".into(),
        "--name".into(), name,
        "--goal".into(), goal,
        "--vault".into(), vault,
    ];
    if let Some(p) = provider { if !p.trim().is_empty() { args.push("--cli".into()); args.push(p); } }
    if let Some(m) = model { if !m.trim().is_empty() { args.push("--model".into()); args.push(m); } }
    // Re-evaluate mode: research-only (don't re-scaffold an existing app), and
    // tell the agent the current method so the comparison is meaningful.
    if reevaluate.unwrap_or(false) {
        args.push("--reevaluate".into());
        if let Some(c) = current { if !c.trim().is_empty() { args.push("--current".into()); args.push(c); } }
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_engine_json(&refs)
}

/// Ideal-state alignment report: per-pillar fit score + rationale + actions.
/// Signal mode (no model) by default; fast + side-effect-light.
#[tauri::command]
pub fn engine_alignment(vault: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["--vault", &vault, "alignment", "--json"])
}

/// One app's runnable skills (id/runner/trigger) for the per-app detail view.
#[tauri::command]
pub fn engine_app_skills(id: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "skills", &id, "--json"])
}

/// One app's skill FILES as attachable context: the primary SKILL.md plus every
/// file under skills/, each with { id, name, path, summary, body, primary }.
/// Powers the chat "attach this app's skill" suggestions when chatting in an
/// app's context. Returns [] when the app has no skills.
#[tauri::command]
pub fn engine_app_skill_files(id: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "skill-files", &id, "--json"])
}

/// One app's run history (last ~20 runs) for the per-app Runs facet. Returns
/// { lastRunTs, lastOkTs, lastRunOk, lastError, nextDueTs, consecutiveFailures,
/// runs: [{ ts, ok, skill, summary?, error?, duration_ms, artifacts }] }.
#[tauri::command]
pub fn engine_app_runs(id: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["connectors", "runs", &id, "--json"])
}

/// App lock (Phase 0 passcode). The passcode is sent on the child's STDIN so it
/// never appears in argv/process list. Desktop-only — deliberately NOT in
/// WEBUI_ALLOWED; the WebUI has its own login.
#[tauri::command]
pub fn engine_lock_status() -> Result<serde_json::Value, String> {
    run_engine_json(&["lock", "status"])
}
#[tauri::command]
pub fn engine_lock_set(passcode: String) -> Result<serde_json::Value, String> {
    run_engine_json_stdin(&["lock", "set"], &passcode)
}
#[tauri::command]
pub fn engine_lock_verify(passcode: String) -> Result<serde_json::Value, String> {
    run_engine_json_stdin(&["lock", "verify"], &passcode)
}
#[tauri::command]
pub fn engine_lock_clear(passcode: String) -> Result<serde_json::Value, String> {
    run_engine_json_stdin(&["lock", "clear"], &passcode)
}
#[tauri::command]
pub fn engine_lock_reset() -> Result<serde_json::Value, String> {
    // Recovery path for "forgot passcode" — deletes the lock file without
    // requiring the existing passcode. The lock file is at:
    //   $PREVAIL_CONFIG_DIR/lock.json  or  ~/.prevail/lock.json
    let lock_path = if let Ok(d) = std::env::var("PREVAIL_CONFIG_DIR") {
        std::path::PathBuf::from(d).join("lock.json")
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        std::path::PathBuf::from(home).join(".prevail").join("lock.json")
    };
    if lock_path.exists() {
        std::fs::remove_file(&lock_path)
            .map_err(|e| format!("could not remove lock file: {e}"))?;
    }
    Ok(serde_json::json!({ "ok": true }))
}

// ── Touch ID (biometric unlock for the app lock) ──
// Prompts the OS biometric (Touch ID on macOS), falling back to the device
// password. Returns whether the user authenticated. Used only as a convenience
// gate for the Phase-0 app lock — it does NOT release any encryption key.
#[tauri::command]
pub fn engine_biometric_authenticate(reason: String) -> Result<bool, String> {
    use robius_authentication::{AndroidText, BiometricStrength, Context, PolicyBuilder, Text, WindowsText};
    let policy = PolicyBuilder::new()
        .biometrics(Some(BiometricStrength::Strong))
        .password(true)
        .build()
        .ok_or("could not build authentication policy")?;
    let text = Text {
        android: AndroidText { title: &reason, subtitle: None, description: None },
        apple: &reason,
        windows: WindowsText::new(&reason, &reason).ok_or("prompt text too long")?,
    };
    let context = Context::new(());
    Ok(context.blocking_authenticate(text, &policy).is_ok())
}

// ── Vault encryption (F4 Phase 1) ──
// Passcode is sent on the child's STDIN (never argv). Desktop-only; the unlocked
// DEK is held in this process (set_vault_key) and injected into every engine
// spawn as PREVAIL_VAULT_KEY — it never crosses to the JS layer.

// ── Vault crypto (desktop-native twin of the engine's vault-session) ──────
// The engine encrypts vault files as JSON SealedBlobs ({iv, ct, tag}, all
// base64, AES-256-GCM, 32-byte DEK). The desktop holds the DEK after unlock
// (vault_key) but used to read vault files RAW, so an encrypted vault
// rendered as ciphertext and crashed views. These helpers make every desktop
// read/write transparently crypto-aware; plaintext vaults pass through
// untouched.
#[derive(serde::Serialize, serde::Deserialize)]
struct SealedBlob {
    iv: String,
    ct: String,
    tag: String,
}

/// Env pairs every engine spawn needs: the Bunker flag when locked down,
/// else gateway provider keys (OpenRouter). Previously only run_engine
/// injected the OpenRouter key, so streaming chat and benchmark spawns hit
/// 401 "missing authentication header" despite a configured key.
pub(crate) fn provider_env_pairs() -> Vec<(String, String)> {
    let mut out = Vec::new();
    if crate::vault_lock::vault_lock_enabled() {
        out.push(("PREVAIL_VAULT_LOCK".to_string(), "1".to_string()));
    }
    if crate::bunker::bunker_enabled() {
        out.push(("PREVAIL_BUNKER".to_string(), "1".to_string()));
        return out;
    }
    if let Ok(key) = crate::ingestion::keychain::get("prevail.providers", "openrouter") {
        if !key.is_empty() {
            out.push(("PREVAIL_OPENROUTER_KEY".to_string(), key));
        }
    }
    for (id, env_key) in DIRECT_PROVIDER_ENVS {
        if let Ok(key) = crate::ingestion::keychain::get("prevail.providers", id) {
            if !key.is_empty() {
                out.push((env_key.to_string(), key));
            }
        }
    }
    out
}

/// Gateway connector keys (Composio / Nango) read from the Keychain, returned as
/// engine env-var pairs. Only present, non-empty entries are returned. The engine
/// reads COMPOSIO_API_KEY / NANGO_SECRET_KEY to authenticate its gateway calls.
/// Applied to every engine spawn (including the long-running daemon spawns that
/// run scheduled syncs) the same way provider_env_pairs() is.
pub(crate) fn gateway_env_pairs() -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    // Bunker / local-only mode must not hand cloud-gateway secrets to any
    // subprocess — injecting them unconditionally leaks Composio/Nango keys
    // while the user believes the app is offline. Gated here so all five spawn
    // sites are covered at once. (Critical: audit B4 / O14.)
    if crate::bunker::bunker_enabled() {
        return out;
    }
    if let Ok(key) = crate::ingestion::keychain::get("prevail.ingestion", "composio") {
        if !key.is_empty() {
            out.push(("COMPOSIO_API_KEY", key));
        }
    }
    if let Ok(key) = crate::ingestion::keychain::get("prevail.ingestion", "nango") {
        if !key.is_empty() {
            out.push(("NANGO_SECRET_KEY", key));
        }
    }
    out
}

/// Direct single-vendor providers (G1): (Keychain provider id, engine env var).
/// Mirrors the engine's DIRECT_PROVIDERS table. The PREVAIL_ prefix keeps these
/// out of the engine's scrubbedEnv strip list.
pub(crate) const DIRECT_PROVIDER_ENVS: &[(&str, &str)] = &[
    ("anthropic", "PREVAIL_ANTHROPIC_KEY"),
    ("openai", "PREVAIL_OPENAI_KEY"),
    ("xai", "PREVAIL_XAI_KEY"),
    ("kimi", "PREVAIL_KIMI_KEY"),
    ("deepseek", "PREVAIL_DEEPSEEK_KEY"),
    ("google", "PREVAIL_GOOGLE_KEY"),
];

/// Path to the app-secret name index (env-var NAMES only, never values).
pub(crate) fn app_secret_index_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::Path::new(&home).join(".prevail").join("appsecrets.index"))
}

/// The engine's config file (~/.prevail/config.json). This is the SINGLE source
/// of truth for the active vault: the headless daemons and every engine spawn
/// that doesn't get an explicit --vault read it. The desktop keeps the UI in
/// lockstep with this file (read on boot, written on vault switch) so the UI,
/// the engine, and the daemons never diverge onto different vault folders.
fn engine_config_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::Path::new(&home).join(".prevail").join("config.json"))
}

/// Read the engine's configured vault path (the authoritative active vault).
#[tauri::command]
pub fn engine_config_vault() -> Option<String> {
    let p = engine_config_path()?;
    let raw = std::fs::read_to_string(p).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("vaultPath").and_then(|x| x.as_str()).map(|s| s.to_string())
}

/// Point the engine's config at `path`, preserving every other field. Called by
/// the desktop whenever the active vault changes so the daemons + engine follow
/// the UI instead of stranding on a stale vault.
#[tauri::command]
pub fn engine_set_config_vault(path: String) -> Result<(), String> {
    // Mirror the configured vault into the in-memory VAULT_ROOT so EVERY engine
    // call (including no-arg ones like `connectors list` / `connectors composio`)
    // injects PREVAIL_VAULT_ROOT and resolves the real vault, not a dev fallback.
    // Encrypted vaults also set this on unlock; plaintext vaults rely on this hook.
    set_vault_root(Some(path.clone()));
    let p = engine_config_path().ok_or("no HOME")?;
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut v: serde_json::Value = std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    v["vaultPath"] = serde_json::Value::String(path);
    let body = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    std::fs::write(&p, body).map_err(|e| format!("write config.json failed: {e}"))
}

/// Every stored app-connector secret as (env-var name, value) pairs, read from
/// the Keychain via the name index. Spawn-type agnostic so both the tokio and
/// std engine spawns can inject them.
pub(crate) fn app_secret_env_pairs() -> Vec<(String, String)> {
    let mut out = Vec::new();
    let Some(p) = app_secret_index_path() else { return out };
    let Ok(txt) = std::fs::read_to_string(&p) else { return out };
    for name in txt.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
        if let Ok(v) = crate::ingestion::keychain::get("prevail.appsecrets", name) {
            if !v.is_empty() {
                out.push((name.to_string(), v));
            }
        }
    }
    out
}

/// The session DEK, iff `path` is inside the unlocked, encrypted vault.
fn session_key_for(path: &std::path::Path) -> Option<[u8; 32]> {
    use base64::Engine as _;
    let root = vault_root()?;
    if !path.starts_with(&root) {
        return None;
    }
    if !std::path::Path::new(&root).join(".prevail-encrypted").exists() {
        return None;
    }
    let k = vault_key()?;
    base64::engine::general_purpose::STANDARD
        .decode(k)
        .ok()?
        .try_into()
        .ok()
}

/// Decrypt raw file content when it is a sealed blob from this vault;
/// passthrough otherwise (plaintext vaults, foreign files, no session key).
pub(crate) fn maybe_decrypt(path: &std::path::Path, raw: String) -> String {
    use aes_gcm::aead::Aead;
    use aes_gcm::KeyInit;
    use base64::Engine as _;
    let t = raw.trim_start();
    if !(t.starts_with('{') && t.contains("\"iv\"") && t.contains("\"ct\"")) {
        return raw;
    }
    let Some(key) = session_key_for(path) else { return raw };
    let Ok(blob) = serde_json::from_str::<SealedBlob>(t) else { return raw };
    let b64 = base64::engine::general_purpose::STANDARD;
    let (Ok(iv), Ok(ct), Ok(tag)) = (b64.decode(&blob.iv), b64.decode(&blob.ct), b64.decode(&blob.tag)) else {
        return raw;
    };
    let Ok(cipher) = aes_gcm::Aes256Gcm::new_from_slice(&key) else { return raw };
    let mut ct_tag = ct;
    ct_tag.extend_from_slice(&tag);
    match cipher.decrypt(aes_gcm::Nonce::from_slice(&iv), ct_tag.as_ref()) {
        Ok(pt) => String::from_utf8(pt).unwrap_or(raw),
        Err(_) => raw, // wrong key / tampered: surface the raw blob rather than lying
    }
}

/// Encrypt content for `path` when the session vault is encrypted; passthrough
/// otherwise. The write-side twin of maybe_decrypt.
pub(crate) fn maybe_encrypt(path: &std::path::Path, content: &str) -> String {
    use aes_gcm::aead::Aead;
    use aes_gcm::KeyInit;
    use base64::Engine as _;
    use rand::RngCore;
    let Some(key) = session_key_for(path) else { return content.to_string() };
    let Ok(cipher) = aes_gcm::Aes256Gcm::new_from_slice(&key) else { return content.to_string() };
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let Ok(mut ct_tag) = cipher.encrypt(aes_gcm::Nonce::from_slice(&iv), content.as_bytes()) else {
        return content.to_string();
    };
    let tag = ct_tag.split_off(ct_tag.len().saturating_sub(16));
    let b64 = base64::engine::general_purpose::STANDARD;
    serde_json::to_string(&SealedBlob {
        iv: b64.encode(iv),
        ct: b64.encode(ct_tag),
        tag: b64.encode(tag),
    })
    .unwrap_or_else(|_| content.to_string())
}

/// Append a line to a vault ledger. You can't append to an AES-GCM blob, so
/// under encryption this is decrypt + append + re-encrypt (single user, low
/// contention — mirrors the engine's vappendLine). Plain append otherwise.
pub(crate) fn vault_append_line(path: &std::path::Path, line: &str) -> std::io::Result<()> {
    use std::io::Write;
    if session_key_for(path).is_some() {
        let existing = std::fs::read_to_string(path)
            .map(|r| maybe_decrypt(path, r))
            .unwrap_or_default();
        return std::fs::write(path, maybe_encrypt(path, &format!("{existing}{line}")));
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    f.write_all(line.as_bytes())
}

/// Spawn `prevail mcp --vault <vault>`, send a JSON-RPC initialize request, and
/// confirm a well-formed response — the desktop's 'Test handshake' button. Lets
/// the user verify the MCP server actually answers before wiring it into an
/// external agent. Returns { ok, info } / { ok:false, error }.
#[tauri::command]
pub async fn mcp_test_handshake(vault: String) -> Result<serde_json::Value, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let bin = resolve_prevail_bin();
    let (combined_path, user, logname) = crate::build_cli_env();
    // MCP-4: spawn with --unsafe-detach so the server's parent-process check
    // (verifyParentProcess) doesn't reject us — the desktop IS the parent here,
    // and it isn't a TTY or a known IDE binary, so without this the server would
    // exit before answering and the test reports "no valid initialize response".
    // The server runs in stdio mode (no --network) so no per-request token is
    // needed for the handshake (MCP-1).
    let mut child = tokio::process::Command::new(&bin)
        .args(["mcp", "--vault", &vault, "--unsafe-detach"])
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn {bin} failed: {e}"))?;
    let req = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": { "name": "prevail-desktop-test", "version": "1" } }
    });
    if let Some(mut stdin) = child.stdin.take() {
        let line = format!("{}\n", serde_json::to_string(&req).unwrap_or_default());
        let _ = stdin.write_all(line.as_bytes()).await;
        let _ = stdin.flush().await;
    }
    // Read the response with a timeout.
    let result = tokio::time::timeout(std::time::Duration::from_secs(12), async {
        let mut out = child.stdout.take().ok_or("no stdout")?;
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = out.read(&mut chunk).await.map_err(|e| e.to_string())?;
            if n == 0 { break; }
            buf.extend_from_slice(&chunk[..n]);
            if buf.contains(&b'\n') { break; }
        }
        Ok::<String, String>(String::from_utf8_lossy(&buf).to_string())
    }).await;
    let _ = child.kill().await;
    match result {
        Ok(Ok(text)) => {
            for line in text.lines() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    if v.get("result").is_some() {
                        let name = v.pointer("/result/serverInfo/name").and_then(|x| x.as_str()).unwrap_or("prevail");
                        return Ok(serde_json::json!({ "ok": true, "info": format!("Handshake OK — server '{name}' responded.") }));
                    }
                    if let Some(err) = v.get("error") {
                        return Ok(serde_json::json!({ "ok": false, "error": format!("server returned an error: {err}") }));
                    }
                }
            }
            Ok(serde_json::json!({ "ok": false, "error": "no valid initialize response from the server" }))
        }
        Ok(Err(e)) => Ok(serde_json::json!({ "ok": false, "error": e })),
        Err(_) => Ok(serde_json::json!({ "ok": false, "error": "timed out waiting for the server (12s)" })),
    }
}

/// Path to the headless-learn launchd plist (mirrors prevail-cli daemon-launchd).
fn learn_agent_plist() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::Path::new(&home).join("Library/LaunchAgents/sh.prevail.learn.plist"))
}

/// Is the headless self-learning launchd agent installed?
#[tauri::command]
pub fn headless_learn_status() -> bool {
    learn_agent_plist().map(|p| p.exists()).unwrap_or(false)
}

/// Install or remove the headless-learn launchd agent by driving the engine's
/// own `daemon install|uninstall` (so the plist/launchctl logic lives in one
/// place). Returns the engine's stdout/stderr summary.
#[tauri::command]
pub async fn headless_learn_set(vault: String, enabled: bool) -> Result<String, String> {
    let bin = resolve_prevail_bin();
    let (combined_path, user, logname) = crate::build_cli_env();
    let sub = if enabled { "install" } else { "uninstall" };
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.args(["daemon", sub, "--vault", &vault])
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
        .env("PATH", combined_path)
        .env("USER", user)
        .env("LOGNAME", logname)
        // Tell the engine the absolute bin to put in the plist (resolve_prevail_bin
        // gives the bundled sidecar; the agent must launch that exact path).
        .env("PREVAIL_BIN", &bin);
    let out = cmd.output().await.map_err(|e| format!("spawn {bin} failed: {e}"))?;
    let txt = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    if out.status.success() { Ok(txt.trim().to_string()) } else { Err(txt.trim().to_string()) }
}

/// Is this vault encrypted, and is the session currently unlocked?
#[tauri::command]
pub fn engine_vault_status(vault: String) -> Result<serde_json::Value, String> {
    let encrypted = std::path::Path::new(&vault).join(".prevail-encrypted").exists();
    Ok(serde_json::json!({ "encrypted": encrypted, "unlocked": vault_key().is_some() }))
}

/// Extract the DEK from a `vault unlock` response. O69: prefer the file handoff —
/// the engine writes the DEK to a 0600 temp file and returns only its path, so the
/// key never rides on stdout; read it, then delete the file. Falls back to an
/// inline `key` for resilience.
fn read_dek_from_unlock(r: &serde_json::Value) -> Result<Option<String>, String> {
    if let Some(kf) = r.get("keyFile").and_then(|v| v.as_str()) {
        let k = std::fs::read_to_string(kf).map_err(|e| format!("read key handoff: {e}"))?;
        let _ = std::fs::remove_file(kf);
        Ok(Some(k.trim().to_string()))
    } else {
        Ok(r.get("key").and_then(|v| v.as_str()).map(|s| s.to_string()))
    }
}

/// Unlock the session: verify the passcode, hold the returned DEK in memory.
/// Returns { ok } only — the key stays in Rust, never reaching JS.
#[tauri::command]
pub fn engine_vault_unlock(vault: String, passcode: String) -> Result<serde_json::Value, String> {
    let r = run_engine_json_stdin(&["--vault", &vault, "vault", "unlock"], &passcode)?;
    if r.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        if let Some(k) = read_dek_from_unlock(&r)? {
            set_vault_key(Some(k));
            set_vault_root(Some(vault.clone()));
        }
        return Ok(serde_json::json!({ "ok": true }));
    }
    Ok(r)
}

/// Clear the in-memory DEK (re-lock the session).
#[tauri::command]
pub fn engine_vault_lock_session() -> Result<(), String> {
    set_vault_key(None);
    set_vault_root(None);
    Ok(())
}

/// Encrypt the vault in place (self-verifying + auto-rollback in the engine).
/// Returns { ok, recoveryCode, ... }. Caller should then unlock to set the
/// session DEK.
#[tauri::command]
pub fn engine_vault_encrypt(vault: String, passcode: String) -> Result<serde_json::Value, String> {
    run_engine_json_stdin(&["--vault", &vault, "vault", "encrypt"], &passcode)
}

/// Decrypt the vault back to plaintext, then clear the session DEK.
#[tauri::command]
pub fn engine_vault_decrypt(vault: String, passcode: String) -> Result<serde_json::Value, String> {
    let r = run_engine_json_stdin(&["--vault", &vault, "vault", "decrypt"], &passcode)?;
    if r.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        set_vault_key(None);
        set_vault_root(None);
    }
    Ok(r)
}

/// `prevail appmode get` — the demo vs production flag (engine config, global).
#[tauri::command]
pub fn engine_appmode_get() -> Result<serde_json::Value, String> {
    run_engine_json(&["appmode", "get"])
}

/// `prevail appmode set --mode demo|production [--vault <path>]`. The optional
/// `vault` is forwarded so a first-launch `set --mode demo` (before any engine
/// config exists) seeds the config pointed at the seeded sandbox rather than the
/// bundled demo default.
#[tauri::command]
pub fn engine_appmode_set(
    mode: String,
    vault: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut a: Vec<String> = vec!["appmode".into(), "set".into(), "--mode".into(), mode];
    if let Some(v) = vault.filter(|s| !s.is_empty()) {
        a.push("--vault".into());
        a.push(v);
    }
    let refs: Vec<&str> = a.iter().map(|s| s.as_str()).collect();
    run_engine_json(&refs)
}

/// `prevail appmode init` — prepare a clean production workspace and switch to
/// it. `vault` is the clean target (empty default: the embedded vault).
/// `clear_demo`, when set, is emptied ONLY if it carries the demo marker — an
/// unmarked (possibly real) vault is never deleted (engine-side guard).
#[tauri::command]
pub fn engine_production_init(
    vault: Option<String>,
    clear_demo: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut a: Vec<String> = vec!["appmode".into(), "init".into()];
    if let Some(v) = vault.filter(|s| !s.is_empty()) {
        a.push("--vault".into());
        a.push(v);
    }
    if let Some(d) = clear_demo.filter(|s| !s.is_empty()) {
        a.push("--clear-demo".into());
        a.push(d);
    }
    let refs: Vec<&str> = a.iter().map(|s| s.as_str()).collect();
    run_engine_json(&refs)
}

/// `prevail appmode mark-demo --vault <path>` — tag a seeded sandbox as demo so a
/// later production switch may safely clear it.
#[tauri::command]
pub fn engine_appmode_mark_demo(vault: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["appmode", "mark-demo", "--vault", &vault])
}

/// `prevail models <provider> --json` — live model discovery so newly released
/// models surface without a code change (ollama/lmstudio/openrouter query a real
/// catalog; subscription CLIs return []). Returns { provider, models: [...] }.
#[tauri::command]
pub fn engine_discover_models(provider: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["models", &provider])
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

/// W4 — `prevail --vault <vault> vault migrate-data --json`
/// Relocate the whole vault under <vault>/data (non-destructive copy + verify),
/// then the engine repoints config.vaultPath to <vault>/data. Returns
/// { dataDir, ok, repointed, ... }; the desktop repoints its own vaultPath to
/// `dataDir` on success, exactly like the embed flow.
#[tauri::command]
pub fn engine_vault_migrate_data(vault: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["--vault", &vault, "vault", "migrate-data"])
}

/// W4 — `prevail --vault <dataDir> vault archive-data --force --json`
/// AFTER migration + repoint, move the orphaned originals at the true root into a
/// timestamped backup (never deletes). `vault` is the repointed data dir.
#[tauri::command]
pub fn engine_vault_archive_data(vault: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["--vault", &vault, "vault", "archive-data", "--force"])
}

/// B2-12 — `prevail --vault <vault> vault migrate-build --json`
/// Tidy the General/root SUPPORTING runtime files into <vault>/build/
/// (non-destructive copy + verify, originals left). No config repoint needed —
/// buildRoot()/runtime_file() resolve to build/ once it exists.
#[tauri::command]
pub fn engine_vault_migrate_build(vault: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["--vault", &vault, "vault", "migrate-build"])
}

/// B2-12 — `prevail --vault <vault> vault archive-build --force --json`
/// AFTER a verified build/ migration, move the duplicated root originals into a
/// timestamped `_pre-build-*` backup (never deletes).
#[tauri::command]
pub fn engine_vault_archive_build(vault: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["--vault", &vault, "vault", "archive-build", "--force"])
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

/// Async audit re-scan. Same result as `engine_score(audit=true)`, but runs the
/// blocking engine subprocess on a blocking thread instead of the main thread,
/// so the LLM audit (which can take many seconds) never freezes the UI. The
/// audit just recomputes and rewrites the score, so it is idempotent: running it
/// repeatedly has no cumulative effect beyond a fresh score.
#[tauri::command]
pub async fn engine_score_audit(
    vault: String,
    domain: String,
) -> Result<ContextScore, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let value = run_engine_json(&["--vault", &vault, "score", &domain, "--audit"])?;
        serde_json::from_value::<ContextScore>(value)
            .map_err(|e| format!("failed to decode ContextScore: {e}"))
    })
    .await
    .map_err(|e| format!("score audit task failed: {e}"))?
}

/// Pull Google Calendar events (READ-ONLY) into the vault's plaintext
/// `calendar-external.json`, which the Calendar view reads. Runs the engine off
/// the main thread so the network round-trip never freezes the UI. Always
/// returns parseable JSON: `{ ok, count, reason? }` - `ok:false` with a reason
/// when Google is not connected, instead of failing. Stage A (one-way) only.
#[tauri::command]
pub async fn engine_calendar_pull(vault: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_engine_json(&["--vault", &vault, "calendar", "pull-google"])
    })
    .await
    .map_err(|e| format!("calendar pull task failed: {e}"))?
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

/// Streaming life-readiness score. Emits one `score:line` event per domain as it
/// is computed (`{ session, data: { type: "domain", score } }`) and a final
/// `{ type: "done", lifeReadiness, count }`, then `score:done` on child exit.
/// Lets the readiness UI fill in progressively on a large vault instead of
/// blocking on the whole `score --all` roll-up. Uses the run_engine_stream seam.
#[tauri::command]
pub async fn engine_score_stream(
    app: tauri::AppHandle,
    vault: String,
    session: String,
) -> Result<(), String> {
    run_engine_stream(
        app,
        session,
        vec![
            "--vault".to_string(),
            vault,
            "score".to_string(),
            "--all".to_string(),
            "--stream".to_string(),
        ],
        "score",
    )
    .await
}

/// Streaming agentic browser LEARN run for a connector. Drives a HEADED Chromium
/// (the user watches + completes 2FA); the engine emits NDJSON progress
/// (`{phase:"step"|"await_user"|"download"|"complete", ...}`) which
/// run_engine_stream relays as `connector_learn:line`, then `connector_learn:done`
/// on child exit. PLAYWRIGHT_BROWSERS_PATH is injected by run_engine_stream so the
/// engine finds (or auto-downloads) Chromium. Session id makes the run killable
/// via abort_sessions.
#[tauri::command]
pub async fn engine_connector_learn_stream(
    app: tauri::AppHandle,
    id: String,
    session: String,
    goal: Option<String>,
    url: Option<String>,
) -> Result<(), String> {
    let mut args = vec![
        "connectors".to_string(),
        "browser-learn".to_string(),
        id,
        "--stream".to_string(),
    ];
    if let Some(g) = goal {
        if !g.trim().is_empty() {
            args.push("--goal".to_string());
            args.push(g);
        }
    }
    if let Some(u) = url {
        if !u.trim().is_empty() {
            args.push("--url".to_string());
            args.push(u);
        }
    }
    run_engine_stream(app, session, args, "connector_learn").await
}

/// Streaming browser sync for a connector. `mode = "replay"` runs the recorded
/// skill fast (headless, no model); `mode = "relearn"` re-runs the agentic learn
/// (headed) to repair a drifted recipe. Emits `connector_run:line` /
/// `connector_run:done`.
#[tauri::command]
pub async fn engine_connector_run_stream(
    app: tauri::AppHandle,
    id: String,
    session: String,
    mode: String,
    url: Option<String>,
) -> Result<(), String> {
    let sub = if mode == "relearn" { "browser-learn" } else { "browser-replay" };
    let mut args = vec![
        "connectors".to_string(),
        sub.to_string(),
        id,
        "--stream".to_string(),
    ];
    if mode == "relearn" {
        if let Some(u) = url {
            if !u.trim().is_empty() {
                args.push("--url".to_string());
                args.push(u);
            }
        }
    }
    run_engine_stream(app, session, args, "connector_run").await
}

/// One-time convenience: copy the user's EXISTING Chrome login cookies for this
/// app's site into the connector's dedicated profile (Chrome must be quit).
/// Scoped to the site host only — never the whole browser. Returns the CLI's
/// JSON result ({ ok, imported, message }).
#[tauri::command]
pub fn engine_connector_import_login(id: String, host: Option<String>) -> Result<serde_json::Value, String> {
    let mut args: Vec<String> = vec!["connectors".into(), "import-login".into(), id];
    if let Some(h) = host {
        if !h.trim().is_empty() {
            args.push("--host".into());
            args.push(h);
        }
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_engine_json(&refs)
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

/// Default backup directory: app-support/backups (outside the vault).
fn default_backup_dir() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::Path::new(&home).join("Library/Application Support/sh.prevail.desktop/backups"))
}

/// The directory backups are written to right now: the saved override if set,
/// else the default. Lets the UI show the user exactly where backups live.
#[tauri::command]
pub fn vault_backup_dir(dest_dir: Option<String>) -> Result<String, String> {
    let dir = match dest_dir.filter(|d| !d.trim().is_empty()) {
        Some(d) => std::path::PathBuf::from(d),
        None => default_backup_dir().ok_or("no HOME")?,
    };
    Ok(dir.to_string_lossy().to_string())
}

/// Back up the whole vault into a directory (default: app-support/backups) as a
/// timestamped archive, then prune old ones. Returns the engine BackupResult
/// plus the archive path. Used by manual + scheduled + pre-event backups.
#[tauri::command]
pub fn vault_backup_to(
    vault: String,
    dest_dir: Option<String>,
    keep: Option<usize>,
) -> Result<serde_json::Value, String> {
    let dir = match dest_dir.filter(|d| !d.is_empty()) {
        Some(d) => std::path::PathBuf::from(d),
        None => default_backup_dir().ok_or("no HOME")?,
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir backups: {e}"))?;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = crate::secs_to_ymdhms(secs);
    let out = dir.join(format!("prevail-backup-{y:04}{mo:02}{d:02}_{h:02}{mi:02}{s:02}.tar.gz"));
    let out_str = out.to_string_lossy().to_string();
    let res = run_engine_json(&["--vault", &vault, "vault", "backup", "--output", &out_str])?;
    prune_backups(&dir, keep.unwrap_or(10));
    Ok(res)
}

/// Keep the newest `keep` backups plus the newest one from each ISO week, prune
/// the rest, so backups never silently fill the disk.
fn prune_backups(dir: &std::path::Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(String, std::path::PathBuf, u64)> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let name = p.file_name()?.to_str()?.to_string();
            if !name.starts_with("prevail-backup-") || !name.ends_with(".tar.gz") {
                return None;
            }
            let mtime = e.metadata().ok()?.modified().ok()?
                .duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
            Some((name, p, mtime))
        })
        .collect();
    files.sort_by(|a, b| b.2.cmp(&a.2)); // newest first
    let mut kept_weeks: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for (idx, (_, path, mtime)) in files.iter().enumerate() {
        let week = (*mtime as i64) / (7 * 86_400);
        let keep_recent = idx < keep;
        let keep_weekly = kept_weeks.insert(week); // true if this week not yet kept
        if !keep_recent && !keep_weekly {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// List backup archives in `dest_dir` (default app-support/backups), newest
/// first, with size and timestamp for the restore picker.
#[tauri::command]
pub fn vault_backups_list(dest_dir: Option<String>) -> Result<Vec<serde_json::Value>, String> {
    let dir = match dest_dir.filter(|d| !d.is_empty()) {
        Some(d) => std::path::PathBuf::from(d),
        None => default_backup_dir().ok_or("no HOME")?,
    };
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            let Some(name) = p.file_name().and_then(|s| s.to_str()) else { continue };
            if !name.starts_with("prevail-backup-") || !name.ends_with(".tar.gz") {
                continue;
            }
            let meta = e.metadata().ok();
            let bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let mtime = meta.and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()).unwrap_or(0);
            out.push(serde_json::json!({
                "name": name, "path": p.to_string_lossy(), "bytes": bytes, "mtime": mtime,
            }));
        }
    }
    out.sort_by(|a, b| b["mtime"].as_u64().cmp(&a["mtime"].as_u64()));
    Ok(out)
}

/// Restore the whole vault from a backup archive (`prevail vault restore <path>`).
#[tauri::command]
pub fn vault_restore_archive(vault: String, archive: String) -> Result<serde_json::Value, String> {
    run_engine_json(&["--vault", &vault, "vault", "restore", &archive, "--json", "--force"])
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
    // Per-turn web access (the chat "Web access" Modes toggle). Some(false) =>
    // the engine hard-blocks web for this turn (--web deny). None => the engine
    // falls back to its own global setting.
    web: Option<bool>,
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
    // Forward the per-turn web-access decision so the engine can hard-block web
    // (remove Claude's WebSearch/WebFetch, refuse providers it can't gate). Only
    // sent when the caller is explicit; absent => engine uses its global setting.
    match web {
        Some(true) => { args.push("--web".to_string()); args.push("allow".to_string()); }
        Some(false) => { args.push("--web".to_string()); args.push("deny".to_string()); }
        None => {}
    }

    run_engine_stream_stdin(app, session, args, message, "engine-chat", extra_env).await
}

/// `prevail --vault <vault> agent-run --domain <domain> --goal <goal>
///  [--cli X] [--model Y] [--task id] [--autonomy safe|auto] --json`.
///
/// Hands a single task to an agent runtime (typically a harness like Hermes/Pi/
/// OpenCode). The harness runs its own tool/agent loop; this streams the same
/// ChatEvent NDJSON shape as `engine_chat`, on `engine-agent:line` and
/// `engine-agent:done`, so the frontend reuses its existing stream parser.
#[tauri::command]
pub async fn engine_agent_run(
    app: tauri::AppHandle,
    session: String,
    vault: String,
    domain: String,
    goal: String,
    cli: Option<String>,
    model: Option<String>,
    #[allow(non_snake_case)] taskId: Option<String>,
    autonomy: Option<String>,
) -> Result<(), String> {
    // A harness agent reaches the network and may take actions; Bunker Mode's
    // no-network guarantee forbids that outright.
    if crate::bunker::bunker_enabled() {
        return Err("Agent runs are disabled in Bunker Mode (a harness agent reaches the network).".to_string());
    }
    let mut args: Vec<String> = vec![
        "--vault".to_string(),
        vault,
        "agent-run".to_string(),
        "--domain".to_string(),
        domain,
        "--goal".to_string(),
        goal,
    ];
    if let Some(c) = cli.filter(|s| !s.is_empty()) {
        args.push("--cli".to_string());
        args.push(c);
    }
    if let Some(m) = model.filter(|s| !s.is_empty()) {
        args.push("--model".to_string());
        args.push(m);
    }
    if let Some(t) = taskId.filter(|s| !s.is_empty()) {
        args.push("--task".to_string());
        args.push(t);
    }
    // Default to the safe (read-and-propose) autonomy; the engine's broker gate
    // is the real guardrail for consequential actions.
    let auto = match autonomy.as_deref() {
        Some("auto") => "auto",
        _ => "safe",
    };
    args.push("--autonomy".to_string());
    args.push(auto.to_string());

    run_engine_stream(app, session, args, "engine-agent").await
}

/// Run one of an app's skills, streaming progress to the frontend.
///
/// `prevail connectors skill-run --app <app> --skill <skill> --vault <vault>
///  [--cli <provider>] --json`. The browser-method skill performs its
/// first-time login on the first run, so this also covers setup. Streams the
/// same ChatEvent NDJSON shape as `engine_chat` / `engine_agent_run`, on
/// `engine-skill:line` and `engine-skill:done`, so the UI reuses its existing
/// stream parser. Mirrors `engine_agent_run`'s spawn/stream/emit path.
#[tauri::command]
pub async fn engine_app_run_skill(
    handle: tauri::AppHandle,
    session: String,
    vault: String,
    app: String,
    skill: String,
    cli: Option<String>,
) -> Result<(), String> {
    let mut args: Vec<String> = vec![
        "connectors".to_string(),
        "skill-run".to_string(),
        "--app".to_string(),
        app,
        "--skill".to_string(),
        skill,
        "--vault".to_string(),
        vault,
    ];
    if let Some(c) = cli.filter(|s| !s.is_empty()) {
        args.push("--cli".to_string());
        args.push(c);
    }
    run_engine_stream(handle, session, args, "engine-skill").await
}

// ─────────────────────────────────────────────────────────────────────
// Google Workspace (gws) write approvals. Reads run automatically inside
// chat and need no UI. WRITES are queued by the CLI to
// <vault>/_meta/pending_gws.json as [{ id, domain, summary, args, ts }] and
// must wait for the user to approve them under "Needs you". The approve path
// reuses the existing token spine: loop_request_approval mints a single-use
// token bound to (domain, summary), and authorize_action verifies it here so
// a gws write only ever runs with a valid, single-use approval.

/// List the queued gws write actions awaiting approval.
/// `prevail --vault <vault> gws pending-list --json` -> the pending array.
#[tauri::command]
pub async fn engine_gws_pending_list(vault: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_engine_json(&["--vault", &vault, "gws", "pending-list"])
    })
    .await
    .map_err(|e| format!("gws pending-list task failed: {e}"))?
}

/// Execute ONE user-approved gws write for real. Requires a valid single-use
/// `approval` token bound to this exact (domain, summary) — minted by
/// loop_request_approval — so a UI bug or injected invoke can't drive a gws
/// write without real approval. Mirrors loop_execute_action's single
/// authorization checkpoint, then runs the exact stored command by id.
/// Returns the engine's `{ ok, output?, error? }`.
#[tauri::command]
pub async fn engine_gws_approve(
    vault: String,
    id: String,
    domain: String,
    summary: String,
    approval: String,
) -> Result<serde_json::Value, String> {
    // Single authorization checkpoint: the broker verifies the approval token is
    // valid, single-use, and bound to this exact (domain, summary). Do NOT weaken.
    crate::broker::authorize_action(&domain, &summary, &approval)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_engine_json(&["--vault", &vault, "gws", "run", "--id", &id])
    })
    .await
    .map_err(|e| format!("gws run task failed: {e}"))?
}

#[cfg(test)]
mod vault_key_state_tests {
    use super::*;

    #[test]
    fn vault_crypto_round_trip_and_passthrough() {
        let _g = KEY_STATE_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("prevail-enc-rt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".prevail-encrypted"), "1").unwrap();
        let p = dir.join("wealth.md");
        use base64::Engine as _;
        let key = base64::engine::general_purpose::STANDARD.encode([7u8; 32]);
        set_vault_root(Some(dir.to_string_lossy().to_string()));
        set_vault_key(Some(key));
        let sealed = maybe_encrypt(&p, "hello vault");
        assert!(sealed.contains("\"iv\"") && sealed.contains("\"tag\""));
        assert_eq!(maybe_decrypt(&p, sealed), "hello vault");
        assert_eq!(maybe_decrypt(&p, "plain".into()), "plain");
        let outside = std::env::temp_dir().join("not-in-vault.md");
        assert_eq!(maybe_encrypt(&outside, "x"), "x");
        set_vault_key(None);
        set_vault_root(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Verifies the desktop's in-memory encryption key + vault-root holding logic
    // (what gets injected as PREVAIL_VAULT_KEY / PREVAIL_VAULT_ROOT into the
    // sidecar). This is the cross-process key-passing state at the heart of an
    // unlocked encrypted-vault session.
    #[test]
    fn vault_key_and_root_round_trip() {
        let _g = KEY_STATE_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        set_vault_key(Some("dGVzdC1rZXk=".into()));
        set_vault_root(Some("/Users/x/vault".into()));
        assert_eq!(vault_key().as_deref(), Some("dGVzdC1rZXk="));
        assert_eq!(vault_root().as_deref(), Some("/Users/x/vault"));

        // Re-locking clears both — a locked session injects nothing.
        set_vault_key(None);
        set_vault_root(None);
        assert_eq!(vault_key(), None);
        assert_eq!(vault_root(), None);
    }

    #[test]
    fn unlock_dek_file_handoff_is_read_then_deleted() {
        // O69: the engine returns the DEK via a temp file; we read it and delete it.
        let dir = std::env::temp_dir().join(format!("prevail-dek-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let kf = dir.join("dek");
        std::fs::write(&kf, "BASE64DEK==\n").unwrap();
        let r = serde_json::json!({ "ok": true, "keyFile": kf.to_string_lossy() });
        assert_eq!(read_dek_from_unlock(&r).unwrap().as_deref(), Some("BASE64DEK=="));
        assert!(!kf.exists(), "handoff file is deleted after read");
        // Resilience: fall back to an inline key when no keyFile is present.
        let r2 = serde_json::json!({ "ok": true, "key": "INLINE==" });
        assert_eq!(read_dek_from_unlock(&r2).unwrap().as_deref(), Some("INLINE=="));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
