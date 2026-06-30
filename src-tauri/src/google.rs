// Google Workspace connector — one connector for the whole Google ecosystem
// (Gmail, Calendar, Drive, Docs, Sheets, Tasks, People, Meet, …) via the
// official `gws` CLI (github.com/googleworkspace/cli).
//
// Multi-profile is the headline feature: `gws` auth is single-account, but it
// honors GOOGLE_WORKSPACE_CLI_CONFIG_DIR, so each Google profile lives in its
// own config dir (~/.config/gws, ~/.config/gws-<label>, …). We enumerate those
// dirs, probe each for its live auth state, and let the agent fan out across all
// of them (pull / summarize / respond per profile) by setting that env var.

use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Emitter;

// Bundle identifier (matches tauri.conf.json). Used to locate the app-local
// data dir purely from the filesystem, so resolve_gws_bin() can find a CLI we
// installed ourselves WITHOUT needing an AppHandle (status / profile probes
// have none).
const APP_IDENTIFIER: &str = "sh.prevail.desktop";

/// The Prevail-managed dir for CLIs we install ourselves (off the user's PATH).
/// Path-derivable (no AppHandle) so the install side and the resolve side always
/// agree. Mirrors Tauri's app-local-data dir layout per OS.
fn app_managed_bin_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    #[cfg(target_os = "macos")]
    let base = PathBuf::from(&home)
        .join("Library")
        .join("Application Support")
        .join(APP_IDENTIFIER);
    #[cfg(target_os = "linux")]
    let base = match std::env::var("XDG_DATA_HOME").ok().filter(|s| !s.is_empty()) {
        Some(x) => PathBuf::from(x).join(APP_IDENTIFIER),
        None => PathBuf::from(&home).join(".local").join("share").join(APP_IDENTIFIER),
    };
    #[cfg(target_os = "windows")]
    let base = PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join(APP_IDENTIFIER);
    base.join("bin")
}

/// The full path to the gws binary inside the Prevail-managed bin dir.
fn app_managed_gws() -> PathBuf {
    let name = if cfg!(target_os = "windows") { "gws.exe" } else { "gws" };
    app_managed_bin_dir().join(name)
}

// The Google services the `gws` CLI fronts. Surfaced as the connector's "covers"
// list so one Google connection clearly unlocks the whole ecosystem.
pub const GOOGLE_SERVICES: &[&str] = &[
    "gmail", "calendar", "drive", "docs", "sheets", "slides", "tasks", "people",
    "chat", "meet", "forms", "keep", "classroom",
];

fn gws_path() -> String {
    let (base, _u, _l) = crate::build_cli_env();
    base
}

/// Resolve the `gws` binary: `which` first, then well-known install locations.
fn resolve_gws_bin() -> Option<String> {
    let path = gws_path();
    if let Ok(out) = Command::new("which")
        .arg("gws")
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
    // Include the Prevail-managed bin dir so a CLI we installed ourselves (off
    // PATH) is found by status/auth afterwards.
    let managed = app_managed_gws();
    let mut candidates = vec![
        "/opt/homebrew/bin/gws".to_string(),
        "/usr/local/bin/gws".to_string(),
        format!("{home}/.local/bin/gws"),
        format!("{home}/.cargo/bin/gws"),
    ];
    candidates.push(managed.to_string_lossy().to_string());
    for c in candidates {
        if Path::new(&c).exists() {
            return Some(c);
        }
    }
    None
}

/// Is the Google Workspace CLI installed? Returns { installed, version, bin }.
#[tauri::command]
pub fn google_cli_status() -> Result<serde_json::Value, String> {
    let bin = match resolve_gws_bin() {
        Some(b) => b,
        None => return Ok(serde_json::json!({ "installed": false, "version": null, "bin": null })),
    };
    let version = Command::new(&bin)
        .arg("--version")
        .env("PATH", gws_path())
        .stdin(std::process::Stdio::null())
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(serde_json::json!({ "installed": true, "version": version, "bin": bin }))
}

// One Google profile = one gws config dir. The label is the human handle (the
// dir suffix after "gws", or "default" for the base dir).
fn profile_label(dir: &Path) -> String {
    let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    match name.strip_prefix("gws-") {
        Some(rest) if !rest.is_empty() => rest.to_string(),
        _ => "default".to_string(),
    }
}

// A config dir counts as a profile once gws has written its token cache there.
fn is_gws_profile_dir(dir: &Path) -> bool {
    dir.is_dir()
        && (dir.join("token_cache.json").exists()
            || dir.join("credentials.enc").exists()
            || dir.join("client_secret.json").exists())
}

fn list_profile_dirs() -> Vec<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    let base = PathBuf::from(&home).join(".config");
    let mut out: Vec<PathBuf> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&base) {
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if (name == "gws" || name.starts_with("gws-")) && is_gws_profile_dir(&p) {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

// The OAuth client material gws reads per config dir. `gws auth status` reports
// this exact path as its `client_config`, and when it is absent in a profile dir
// `gws auth login` fails ("No OAuth client configured"). The default profile
// ships/owns a client; a freshly created labeled profile dir has none of its own,
// so a SECOND Google account cannot authenticate. We fix that by seeding the new
// profile dir with the default profile's client BEFORE its `gws auth login`.
//
// NOTE: this file lives under the gws config dir (~/.config/gws*), never inside
// the synced vault, so reusing it copies no OAuth secret into the vault.
const GWS_CLIENT_FILE: &str = "client_secret.json";

/// The default profile's gws config dir (~/.config/gws).
fn default_profile_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(&home).join(".config").join("gws")
}

/// Locate an existing gws OAuth client (`client_secret.json`) to seed a new
/// profile with. Prefers the default profile's client; if that is missing, falls
/// back to the first OTHER profile dir that has one (excluding `exclude`, the dir
/// we are about to seed). Returns None when no profile on this machine has a
/// client yet, so callers can fail honestly instead of launching a doomed login.
fn find_oauth_client_source(exclude: &Path) -> Option<PathBuf> {
    let default = default_profile_dir().join(GWS_CLIENT_FILE);
    if default.exists() {
        return Some(default);
    }
    for dir in list_profile_dirs() {
        if dir == exclude {
            continue;
        }
        let cand = dir.join(GWS_CLIENT_FILE);
        if cand.exists() {
            return Some(cand);
        }
    }
    None
}

/// Ensure `dir` has an OAuth client before `gws auth login` runs there.
///
/// - The DEFAULT profile uses gws's own built-in/provisioned client, so it is
///   left untouched (gws materializes its client there itself).
/// - A profile that already has its own `client_secret.json` is left untouched.
/// - A NEW labeled profile that lacks one is seeded by copying the default
///   profile's `client_secret.json` in, so the new account can complete OAuth
///   against the same registered client. Google's consent screen still prompts
///   `select_account`, so each profile authorizes its own distinct account; only
///   the client material is copied, never `credentials.enc` / `token_cache.json`,
///   which are per-account tokens.
///
/// Returns Ok(true) when it actually copied a client (so callers can log it),
/// Ok(false) when nothing needed doing, and Err with a clear message when a new
/// profile needs a client but none can be found.
fn ensure_oauth_client(dir: &Path) -> Result<bool, String> {
    // The default profile owns/provisions its own client; never touch it.
    if dir == default_profile_dir().as_path() {
        return Ok(false);
    }
    let target = dir.join(GWS_CLIENT_FILE);
    if target.exists() {
        return Ok(false); // this profile already has its own client
    }
    let src = find_oauth_client_source(dir).ok_or_else(|| {
        "Could not find an existing Google OAuth client to reuse for the new account. Connect your first Google account before adding another.".to_string()
    })?;
    std::fs::create_dir_all(dir).map_err(|e| format!("create profile dir: {e}"))?;
    std::fs::copy(&src, &target)
        .map_err(|e| format!("copy OAuth client to new profile: {e}"))?;
    Ok(true)
}

// Probe one profile's live Gmail auth so the UI shows an honest state, not a
// hopeful "connected". A quick getProfile is the cheapest authoritative check.
fn probe_profile(bin: &str, dir: &Path) -> (String, Option<String>) {
    let out = Command::new(bin)
        .args(["gmail", "users", "getProfile", "--params", "{\"userId\":\"me\"}"])
        .env("PATH", gws_path())
        .env("GOOGLE_WORKSPACE_CLI_CONFIG_DIR", dir)
        .stdin(std::process::Stdio::null())
        .output();
    let Ok(out) = out else { return ("unknown".into(), None) };
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    // gws prints diagnostics (e.g. "Using keyring backend: keyring") alongside
    // the JSON, so the combined stream is NOT valid JSON on its own. Slice out
    // the JSON object before parsing, otherwise a genuinely connected account
    // fails to parse and reads as "unknown" / "Not verified".
    let json_slice = match (text.find('{'), text.rfind('}')) {
        (Some(a), Some(b)) if b > a => &text[a..=b],
        _ => text.as_str(),
    };
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_slice) {
        if let Some(email) = v.get("emailAddress").and_then(|e| e.as_str()) {
            return ("connected".into(), Some(email.to_string()));
        }
        if let Some(err) = v.get("error") {
            let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
            let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("").to_lowercase();
            if code == 401 || msg.contains("invalid_grant") || msg.contains("authentication failed") {
                return ("expired".into(), None);
            }
            if code == 403 || msg.contains("insufficient") || msg.contains("scope") {
                return ("needs_scope".into(), None);
            }
        }
    }
    let lower = text.to_lowercase();
    if lower.contains("invalid_grant") || lower.contains("401") { return ("expired".into(), None); }
    if lower.contains("insufficient") || lower.contains("scope") || lower.contains("403") { return ("needs_scope".into(), None); }
    ("unknown".into(), None)
}

/// Every Google profile (one per gws config dir) with its live status. Status is
/// one of: connected | expired | needs_scope | unknown. `email` is set only when
/// connected. Powers the Google connector's per-profile health rows.
#[tauri::command]
pub fn google_profiles() -> Result<Vec<serde_json::Value>, String> {
    let Some(bin) = resolve_gws_bin() else { return Ok(vec![]) };
    let mut out = Vec::new();
    for dir in list_profile_dirs() {
        let (status, email) = probe_profile(&bin, &dir);
        out.push(serde_json::json!({
            "configDir": dir.to_string_lossy(),
            "label": profile_label(&dir),
            "email": email,
            "status": status,
        }));
    }
    Ok(out)
}

/// Authorize (or re-authorize) a Google profile: runs `gws auth login` with the
/// Gmail/Calendar/Drive scopes in that profile's config dir. Opens the browser;
/// long-running, so it runs off the UI thread. `config_dir` empty = a NEW profile
/// under ~/.config/gws-<label>. Returns { ok, output, configDir }.
#[tauri::command]
pub async fn google_profile_login(label: String, config_dir: Option<String>) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var("HOME").unwrap_or_default();
        let dir = match config_dir.filter(|d| !d.trim().is_empty()) {
            Some(d) => d,
            None => {
                let safe = label.trim().to_lowercase().chars()
                    .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                    .collect::<String>();
                let safe = safe.trim_matches('-').to_string();
                if safe.is_empty() || safe == "default" {
                    format!("{home}/.config/gws")
                } else {
                    format!("{home}/.config/gws-{safe}")
                }
            }
        };
        let bin = resolve_gws_bin().ok_or_else(|| "Google Workspace CLI (gws) not found".to_string())?;
        let _ = std::fs::create_dir_all(&dir);
        // Seed a NEW profile with the default profile's OAuth client so the new
        // account can actually complete OAuth (gws has no per-login client flag;
        // it reads client_secret.json from the config dir). Honest error if the
        // default client can't be located.
        ensure_oauth_client(Path::new(&dir))?;
        // Request the read+send scopes the connector needs across the ecosystem.
        let out = Command::new(&bin)
            .args(["auth", "login", "-s", "gmail,calendar,drive,docs,sheets,tasks,people"])
            .env("PATH", gws_path())
            .env("GOOGLE_WORKSPACE_CLI_CONFIG_DIR", &dir)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("gws auth login failed to start: {e}"))?;
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(serde_json::json!({ "ok": out.status.success(), "output": crate::engine::cap_output(&text), "configDir": dir }))
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

/// Remove a Google profile by deleting its gws config dir, so the user can clear
/// a stuck or half-set-up account and start fresh. Guarded: the directory must
/// live under ~/.config AND be a gws / gws-* profile dir, never anything else.
#[tauri::command]
pub fn google_profile_remove(config_dir: String) -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let base = PathBuf::from(&home).join(".config");
    let canon = PathBuf::from(&config_dir).canonicalize().map_err(|e| format!("resolve dir: {e}"))?;
    let base_canon = base.canonicalize().unwrap_or(base);
    if !canon.starts_with(&base_canon) {
        return Err("refusing to remove a directory outside ~/.config".into());
    }
    let name = canon.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if !(name == "gws" || name.starts_with("gws-")) {
        return Err("not a Google Workspace profile directory".into());
    }
    std::fs::remove_dir_all(&canon).map_err(|e| format!("remove profile: {e}"))?;
    Ok(serde_json::json!({ "ok": true }))
}

/// Scaffold the Google connector as a first-class vault app (data/apps/google)
/// with a SKILL.md that teaches the agent the multi-profile fan-out: it lists the
/// live profiles (config dir + account) and the `gws` calling pattern, so chat
/// and the Inbox-Zero loop can pull / summarize / respond across all profiles.
/// Idempotent: rewrites the SKILL from the current profiles each call.
#[tauri::command]
pub fn google_scaffold(vault: String) -> Result<serde_json::Value, String> {
    let dir = crate::paths::data_root(&vault).join("apps").join("google");
    std::fs::create_dir_all(dir.join("data")).map_err(|e| format!("mkdir: {e}"))?;
    // Manifest: a Direct app connected via the gws CLI. Marked google_workspace
    // so the desktop renders the multi-profile panel for it.
    let manifest = dir.join("manifest.json");
    if !manifest.exists() {
        let m = serde_json::json!({
            "id": "google",
            "title": "Google",
            "integration": "cli",
            "google_workspace": true,
            "covers": GOOGLE_SERVICES,
            "domains": [],
            "refresh": { "every": "daily" }
        });
        std::fs::write(&manifest, format!("{}\n", serde_json::to_string_pretty(&m).unwrap_or_default()))
            .map_err(|e| format!("write manifest: {e}"))?;
    }
    let profiles = google_profiles().unwrap_or_default();
    let mut lines: Vec<String> = vec![
        "---".into(),
        "title: Google".into(),
        "---".into(),
        "# Google Workspace".into(),
        "".into(),
        "Google is connected through the `gws` CLI (Google Workspace CLI), which fronts the whole ecosystem: Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, People, Chat, Meet, Forms, Keep, Classroom.".into(),
        "".into(),
        "## Profiles".into(),
        "".into(),
        "Each Google account is a separate `gws` profile, selected with the `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` env var. To act for a profile, set that variable, then run `gws`.".into(),
        "".into(),
    ];
    if profiles.is_empty() {
        lines.push("(No profiles detected yet. Run `gws auth login` to authorize one.)".into());
    } else {
        for p in &profiles {
            let label = p.get("label").and_then(|v| v.as_str()).unwrap_or("default");
            let cfg = p.get("configDir").and_then(|v| v.as_str()).unwrap_or("");
            let email = p.get("email").and_then(|v| v.as_str()).unwrap_or("(authorize for email)");
            let status = p.get("status").and_then(|v| v.as_str()).unwrap_or("unknown");
            lines.push(format!("- **{label}** ({email}) — status: {status} — `GOOGLE_WORKSPACE_CLI_CONFIG_DIR={cfg}`"));
        }
    }
    lines.extend([
        "".into(),
        "## How to use".into(),
        "".into(),
        "For any Google task, pick the right profile (or ALL of them) and run gws with that profile's config dir. Always label results by profile/account so the user knows which inbox each item came from.".into(),
        "".into(),
        "Examples:".into(),
        "```bash".into(),
        "# Unread in one profile".into(),
        "GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<dir> gws gmail users messages list --params '{\"userId\":\"me\",\"q\":\"is:unread\",\"maxResults\":25}'".into(),
        "# A message's content".into(),
        "GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<dir> gws gmail users messages get --params '{\"userId\":\"me\",\"id\":\"<id>\"}'".into(),
        "# Send / reply".into(),
        "GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<dir> gws gmail users messages send --json '{\"raw\":\"<base64url-RFC822>\"}'".into(),
        "```".into(),
        "".into(),
        "To pull or summarize across ALL inboxes, loop every profile above, run the command per config dir, and merge the results labeled by account. Do not invent data; if a profile's token is expired or under-scoped, say so and skip it.".into(),
    ]);
    std::fs::write(dir.join("SKILL.md"), lines.join("\n") + "\n").map_err(|e| format!("write skill: {e}"))?;
    Ok(serde_json::json!({ "ok": true, "id": "google", "path": dir.to_string_lossy(), "profiles": profiles.len() }))
}

// ---------------------------------------------------------------------------
// One-click setup: streaming install + streaming browser OAuth.
//
// These mirror engine.rs `run_engine_stream`'s spawn/stream/emit contract:
// each child's stdout/stderr is forwarded line-by-line on `<channel>:line`
// (payload `{ session, data, stream? }`), and a final `<channel>:done`
// (payload `{ session, ok, code }`) fires on completion. The child is
// registered in the shared children registry so it stays killable.
// ---------------------------------------------------------------------------

/// Emit one streamed log line on `<event>` for `session`.
fn emit_line(app: &tauri::AppHandle, event: &str, session: &str, text: &str) {
    let _ = app.emit(event, serde_json::json!({ "session": session, "data": text }));
}

/// Emit the terminal `<event>` for `session`.
fn emit_done(app: &tauri::AppHandle, event: &str, session: &str, ok: bool, code: Option<i32>) {
    let _ = app.emit(event, serde_json::json!({ "session": session, "ok": ok, "code": code }));
}

/// Spawn a process and stream its stdout/stderr line-by-line on `line_event`
/// (stderr lines tagged `"stream":"stderr"`), returning the exit code. The
/// child is tracked in the children registry so Stop can SIGTERM it.
async fn stream_child(
    app: &tauri::AppHandle,
    session: &str,
    line_event: &'static str,
    mut scmd: tokio::process::Command,
) -> Result<Option<i32>, String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    scmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = scmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    if let Some(pid) = child.id() {
        crate::children::register_child(session, pid);
    }
    let mut tasks = Vec::new();
    if let Some(s) = child.stdout.take() {
        let app2 = app.clone();
        let session2 = session.to_string();
        tasks.push(tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit(line_event, serde_json::json!({ "session": session2, "data": line }));
            }
        }));
    }
    if let Some(s) = child.stderr.take() {
        let app2 = app.clone();
        let session2 = session.to_string();
        tasks.push(tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit(
                    line_event,
                    serde_json::json!({ "session": session2, "stream": "stderr", "data": line }),
                );
            }
        }));
    }
    let status = child.wait().await.map_err(|e| format!("wait failed: {e}"))?;
    for t in tasks {
        let _ = t.await;
    }
    crate::children::unregister_child(session);
    Ok(status.code())
}

// Platform asset-name tokens for matching a GitHub release asset to this build.
fn os_tokens() -> &'static [&'static str] {
    match std::env::consts::OS {
        "macos" => &["darwin", "macos", "apple-darwin", "apple"],
        "linux" => &["linux"],
        "windows" => &["windows", "win"],
        _ => &[],
    }
}
fn arch_tokens() -> &'static [&'static str] {
    match std::env::consts::ARCH {
        "aarch64" => &["arm64", "aarch64"],
        "x86_64" => &["x86_64", "amd64", "x64"],
        _ => &[],
    }
}

/// One-click install of the `gws` CLI, streaming progress on
/// `google_install:line` / `google_install:done`.
///
/// Idempotent: if gws already resolves, emits one line and a successful done.
/// Otherwise prefers Homebrew (`brew install googleworkspace-cli`); if brew is
/// absent, downloads the matching release binary from GitHub into the
/// Prevail-managed bin dir. If no asset can be confidently matched, it does NOT
/// fabricate a URL: it tells the user the manual `brew` command and finishes
/// with a non-fatal done.
#[tauri::command]
pub async fn google_cli_install_stream(app: tauri::AppHandle, session: String) -> Result<(), String> {
    const LINE: &str = "google_install:line";
    const DONE: &str = "google_install:done";

    // Idempotent fast-path.
    if let Some(bin) = resolve_gws_bin() {
        emit_line(&app, LINE, &session, &format!("Google Workspace CLI already installed ({bin})"));
        emit_done(&app, DONE, &session, true, Some(0));
        return Ok(());
    }

    let (path, user, logname) = crate::build_cli_env();

    // Prefer Homebrew when present.
    let brew_present = Command::new("which")
        .arg("brew")
        .env("PATH", &path)
        .stdin(std::process::Stdio::null())
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if brew_present {
        emit_line(&app, LINE, &session, "Installing the Google Workspace CLI with Homebrew. This can take a minute.");
        let mut scmd = tokio::process::Command::new("brew");
        scmd.args(["install", "googleworkspace-cli"])
            .env_clear()
            .envs(crate::scrubbed_env_pairs())
            .env("PATH", &path)
            .env("USER", &user)
            .env("LOGNAME", &logname);
        let code = match stream_child(&app, &session, LINE, scmd).await {
            Ok(c) => c,
            Err(e) => {
                emit_line(&app, LINE, &session, &format!("Homebrew install could not start: {e}"));
                emit_line(&app, LINE, &session, "You can install it yourself with: brew install googleworkspace-cli");
                emit_done(&app, DONE, &session, false, None);
                return Ok(());
            }
        };
        if let Some(bin) = resolve_gws_bin() {
            emit_line(&app, LINE, &session, &format!("Installed. Found gws at {bin}"));
            emit_done(&app, DONE, &session, true, code);
        } else {
            emit_line(&app, LINE, &session, "Homebrew finished but gws was not found on your PATH.");
            emit_line(&app, LINE, &session, "Try again, or install manually with: brew install googleworkspace-cli");
            emit_done(&app, DONE, &session, false, code);
        }
        return Ok(());
    }

    // No Homebrew: download the matching release binary from GitHub.
    emit_line(&app, LINE, &session, "Homebrew was not found. Downloading the Google Workspace CLI from GitHub.");
    match install_via_download(&app, &session, LINE).await {
        Ok(true) => {
            if let Some(bin) = resolve_gws_bin() {
                emit_line(&app, LINE, &session, &format!("Installed. Found gws at {bin}"));
                emit_done(&app, DONE, &session, true, Some(0));
            } else {
                emit_line(&app, LINE, &session, "Download finished but gws still could not be resolved.");
                emit_line(&app, LINE, &session, "Manual install: brew install googleworkspace-cli");
                emit_done(&app, DONE, &session, false, None);
            }
        }
        Ok(false) => {
            // Honest non-fatal fallback (no asset matched / could not extract).
            emit_done(&app, DONE, &session, false, None);
        }
        Err(e) => {
            emit_line(&app, LINE, &session, &format!("Download failed: {e}"));
            emit_line(&app, LINE, &session, "Manual install: brew install googleworkspace-cli");
            emit_done(&app, DONE, &session, false, None);
        }
    }
    Ok(())
}

/// Best-effort GitHub-release download path for `google_cli_install_stream`.
/// Returns Ok(true) if a binary was installed, Ok(false) for an honest
/// no-match / unsupported-archive fallback (message already streamed), Err for
/// hard failures.
async fn install_via_download(
    app: &tauri::AppHandle,
    session: &str,
    line: &'static str,
) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .user_agent("Prevail-Desktop")
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let api = "https://api.github.com/repos/googleworkspace/cli/releases/latest";
    let resp = client
        .get(api)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("releases query: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub releases API returned {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("parse releases: {e}"))?;
    let assets = json.get("assets").and_then(|a| a.as_array()).cloned().unwrap_or_default();

    let oss = os_tokens();
    let arches = arch_tokens();
    if oss.is_empty() || arches.is_empty() {
        emit_line(app, line, session, "This platform is not recognized for auto-download.");
        emit_line(app, line, session, "Manual install: brew install googleworkspace-cli");
        return Ok(false);
    }

    // Skip detached signatures / checksums; match an asset carrying both an OS
    // and an arch token.
    let is_aux = |name: &str| {
        let n = name.to_lowercase();
        n.ends_with(".sha256") || n.ends_with(".asc") || n.ends_with(".sig")
            || n.ends_with(".pem") || n.ends_with(".txt") || n.contains("checksum")
    };
    let mut chosen: Option<(String, String)> = None; // (name, url)
    for a in &assets {
        let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let url = a.get("browser_download_url").and_then(|v| v.as_str()).unwrap_or("");
        if name.is_empty() || url.is_empty() || is_aux(name) {
            continue;
        }
        let low = name.to_lowercase();
        let os_ok = oss.iter().any(|t| low.contains(t));
        let arch_ok = arches.iter().any(|t| low.contains(t));
        if os_ok && arch_ok {
            chosen = Some((name.to_string(), url.to_string()));
            break;
        }
    }

    let Some((name, url)) = chosen else {
        emit_line(app, line, session, "Could not confidently match a release asset for this OS/arch.");
        emit_line(app, line, session, "Manual install: brew install googleworkspace-cli");
        return Ok(false);
    };

    emit_line(app, line, session, &format!("Downloading {name} ..."));
    let bytes = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("download: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("download body: {e}"))?;

    let bin_dir = app_managed_bin_dir();
    std::fs::create_dir_all(&bin_dir).map_err(|e| format!("create bin dir: {e}"))?;
    let target = app_managed_gws();
    let low = name.to_lowercase();

    if low.ends_with(".tar.gz") || low.ends_with(".tgz") || low.ends_with(".zip") {
        // Archive: extract with the system tar/unzip (best-effort), then locate gws.
        let tmp = std::env::temp_dir().join(format!("gws-dl-{session}-{name}"));
        std::fs::write(&tmp, &bytes).map_err(|e| format!("write archive: {e}"))?;
        emit_line(app, line, session, "Extracting ...");
        let ok = if low.ends_with(".zip") {
            Command::new("unzip")
                .args(["-o"]) // overwrite
                .arg(&tmp)
                .arg("-d")
                .arg(&bin_dir)
                .stdin(std::process::Stdio::null())
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        } else {
            Command::new("tar")
                .arg("-xzf")
                .arg(&tmp)
                .arg("-C")
                .arg(&bin_dir)
                .stdin(std::process::Stdio::null())
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        };
        let _ = std::fs::remove_file(&tmp);
        if !ok {
            emit_line(app, line, session, "Could not extract the downloaded archive automatically.");
            emit_line(app, line, session, "Manual install: brew install googleworkspace-cli");
            return Ok(false);
        }
        // Locate the extracted gws binary and move it to the canonical target.
        if let Some(found) = find_file(&bin_dir, if cfg!(target_os = "windows") { "gws.exe" } else { "gws" }) {
            if found != target {
                let _ = std::fs::rename(&found, &target);
            }
        }
    } else {
        // Plain binary (or .exe): write straight to the canonical target.
        std::fs::write(&target, &bytes).map_err(|e| format!("write binary: {e}"))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }
    emit_line(app, line, session, &format!("Installed to {}", target.display()));
    Ok(true)
}

/// Shallow recursive search for a file named `name` under `root` (depth-limited
/// so an extracted archive's gws can be found wherever it landed).
fn find_file(root: &Path, name: &str) -> Option<PathBuf> {
    fn walk(dir: &Path, name: &str, depth: usize, out: &mut Option<PathBuf>) {
        if out.is_some() || depth > 4 {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, name, depth + 1, out);
            } else if p.file_name().map(|n| n == name).unwrap_or(false) {
                *out = Some(p);
                return;
            }
        }
    }
    let mut out = None;
    walk(root, name, 0, &mut out);
    out
}

/// One-click browser OAuth: runs `gws auth login` with the connector's scopes,
/// streaming output on `google_auth:line` / `google_auth:done`. `config_dir`
/// selects a profile (same env mechanism as `google_profile_login`); empty/None
/// uses the default profile (~/.config/gws). When the gws auth URL appears, it
/// is ALSO opened in the browser via the opener plugin as a backup, in case gws
/// did not auto-open. Success is derived from the output ("status": "success" /
/// "Authentication successful").
#[tauri::command]
pub async fn google_auth_login_stream(
    app: tauri::AppHandle,
    session: String,
    config_dir: Option<String>,
    label: Option<String>,
) -> Result<(), String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, BufReader};

    const LINE: &str = "google_auth:line";
    const DONE: &str = "google_auth:done";

    let bin = match resolve_gws_bin() {
        Some(b) => b,
        None => {
            emit_line(&app, LINE, &session, "Google Workspace CLI is not installed yet.");
            emit_done(&app, DONE, &session, false, None);
            return Ok(());
        }
    };

    let home = std::env::var("HOME").unwrap_or_default();
    // An explicit config_dir wins (re-authorizing an existing profile). Otherwise
    // derive the dir from the label for a NEW named profile (same scheme as
    // google_profile_login), falling back to the default profile.
    let dir = match config_dir.filter(|d| !d.trim().is_empty()) {
        Some(d) => d,
        None => {
            let safe: String = label.unwrap_or_default().trim().to_lowercase().chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect();
            let safe = safe.trim_matches('-').to_string();
            if safe.is_empty() || safe == "default" { format!("{home}/.config/gws") }
            else { format!("{home}/.config/gws-{safe}") }
        }
    };
    let _ = std::fs::create_dir_all(&dir);

    // Seed a NEW labeled profile with the default profile's OAuth client before
    // login (gws reads client_secret.json from the config dir and has no flag to
    // point a login at an existing client). Without this, a second account fails
    // with "No OAuth client configured". The default profile is left untouched.
    match ensure_oauth_client(Path::new(&dir)) {
        Ok(true) => emit_line(&app, LINE, &session, "Reusing your existing Google OAuth client for this account."),
        Ok(false) => {}
        Err(e) => {
            emit_line(&app, LINE, &session, &format!("Cannot start sign-in: {e}"));
            emit_done(&app, DONE, &session, false, None);
            return Ok(());
        }
    }

    let (path, user, logname) = crate::build_cli_env();
    emit_line(&app, LINE, &session, "Starting Google sign-in. Your browser will open to approve access.");

    let mut scmd = tokio::process::Command::new(&bin);
    scmd.args(["auth", "login", "-s", "gmail,calendar,drive,docs,sheets,tasks,people"])
        .env_clear()
        .envs(crate::scrubbed_env_pairs())
        .env("PATH", &path)
        .env("USER", &user)
        .env("LOGNAME", &logname)
        .env("GOOGLE_WORKSPACE_CLI_CONFIG_DIR", &dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = scmd.spawn().map_err(|e| format!("gws auth login failed to start: {e}"))?;
    if let Some(pid) = child.id() {
        crate::children::register_child(&session, pid);
    }

    let success = Arc::new(AtomicBool::new(false));
    let mut tasks = Vec::new();

    // stdout: the auth URL + the final JSON success blob arrive here. When the
    // accounts.google.com URL appears, open it as a browser backup.
    if let Some(s) = child.stdout.take() {
        let app2 = app.clone();
        let session2 = session.clone();
        let success2 = success.clone();
        let opened = Arc::new(AtomicBool::new(false));
        tasks.push(tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit(LINE, serde_json::json!({ "session": session2, "data": line }));
                if line.contains("\"status\": \"success\"")
                    || line.contains("\"status\":\"success\"")
                    || line.to_lowercase().contains("authentication successful")
                {
                    success2.store(true, Ordering::SeqCst);
                }
                if !opened.load(Ordering::SeqCst) {
                    if let Some(url) = extract_oauth_url(&line) {
                        opened.store(true, Ordering::SeqCst);
                        open_in_browser(&app2, &url);
                        let _ = app2.emit(
                            LINE,
                            serde_json::json!({ "session": session2, "data": "Opened your browser to approve access. Waiting for you to approve in your browser..." }),
                        );
                    }
                }
            }
        }));
    }
    if let Some(s) = child.stderr.take() {
        let app2 = app.clone();
        let session2 = session.clone();
        let success2 = success.clone();
        tasks.push(tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit(
                    LINE,
                    serde_json::json!({ "session": session2, "stream": "stderr", "data": line }),
                );
                if line.to_lowercase().contains("authentication successful")
                    || line.contains("\"status\": \"success\"")
                {
                    success2.store(true, Ordering::SeqCst);
                }
            }
        }));
    }

    let status = child.wait().await.map_err(|e| format!("wait failed: {e}"))?;
    for t in tasks {
        let _ = t.await;
    }
    crate::children::unregister_child(&session);

    let ok = success.load(Ordering::SeqCst) || status.success();
    if ok {
        emit_line(&app, LINE, &session, "Google sign-in complete.");
    } else {
        emit_line(&app, LINE, &session, "Sign-in did not complete. You can try Connect again.");
    }
    emit_done(&app, DONE, &session, ok, status.code());
    Ok(())
}

/// Pull the gws OAuth consent URL out of a streamed line, if present.
fn extract_oauth_url(line: &str) -> Option<String> {
    let marker = "https://accounts.google.com/o/oauth2/";
    let start = line.find(marker)?;
    let tail = &line[start..];
    let end = tail.find(|c: char| c.is_whitespace() || c == '"' || c == '\'').unwrap_or(tail.len());
    Some(tail[..end].to_string())
}

/// Open a URL in the user's default browser via the opener plugin (backup in
/// case gws did not auto-open). Best-effort.
fn open_in_browser(app: &tauri::AppHandle, url: &str) {
    use tauri_plugin_opener::OpenerExt;
    let _ = app.opener().open_url(url, None::<&str>);
}
