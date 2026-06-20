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
    for c in [
        "/opt/homebrew/bin/gws".to_string(),
        "/usr/local/bin/gws".to_string(),
        format!("{home}/.local/bin/gws"),
        format!("{home}/.cargo/bin/gws"),
    ] {
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
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
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
