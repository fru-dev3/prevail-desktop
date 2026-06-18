// Ideal State (the user's constitution at <vault>/ideal-state.md), the user
// profile (<vault>/user.md), and distilled long-term memory (<vault>/<domain>/
// _memory.md). Read/write commands + version history. Extracted from lib.rs.

use std::fs;
use std::path::PathBuf;

use crate::engine;
use crate::paths::domain_dir;
use crate::{read_dir_retry, read_to_string_retry, secs_to_ymdhms};

// User-level context — a single `<vault>/user.md` that captures who
// the user is, persistent preferences, recurring details. Mirrors the
// OpenClaw / Hermes user-profile pattern. Read/write via these calls.
#[tauri::command]
pub(crate) fn read_user_md(vault: String) -> Result<String, String> {
    // Prefer user.md; fall back to profile.md (some vaults — incl. the demo —
    // keep the identity there) so the profile is auto-injected either way.
    let p = PathBuf::from(&vault).join("user.md");
    if p.exists() {
        return read_to_string_retry(&p).map_err(|e| e.to_string());
    }
    let profile = PathBuf::from(&vault).join("profile.md");
    if profile.exists() {
        return read_to_string_retry(&profile).map_err(|e| e.to_string());
    }
    Ok(String::new())
}
#[tauri::command]
pub(crate) fn write_user_md(vault: String, body: String) -> Result<(), String> {
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
pub(crate) fn read_ideal_state(vault: String) -> Result<String, String> {
    let p = PathBuf::from(&vault).join("ideal-state.md");
    if !p.exists() {
        return Ok(DEFAULT_IDEAL_STATE.to_string());
    }
    read_to_string_retry(&p).map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) fn write_ideal_state(vault: String, body: String) -> Result<(), String> {
    let p = PathBuf::from(&vault).join("ideal-state.md");
    // The constitution is never silently overwritten: every save that changes
    // it first snapshots the prior text into _meta/ideal-state-versions/, so
    // edits always leave a dated trace and nothing is ever lost.
    if let Ok(existing) = read_to_string_retry(&p) {
        if existing.trim() != body.trim() && !existing.trim().is_empty() {
            let vdir = crate::paths::build_root(&vault).join("_meta").join("ideal-state-versions");
            let _ = fs::create_dir_all(&vdir);
            let secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let (y, mo, d, h, mi, s) = secs_to_ymdhms(secs);
            let vp = vdir.join(format!("{y:04}-{mo:02}-{d:02}_{h:02}{mi:02}{s:02}.md"));
            let _ = fs::write(&vp, engine::maybe_encrypt(&vp, &existing));
        }
    }
    fs::write(&p, engine::maybe_encrypt(&p, &body)).map_err(|e| format!("write ideal-state.md: {e}"))
}

/// Dated snapshots of the constitution, newest first.
#[tauri::command]
pub(crate) fn ideal_state_versions(vault: String) -> Result<Vec<serde_json::Value>, String> {
    let vdir = crate::paths::build_root(&vault).join("_meta").join("ideal-state-versions");
    let mut out = Vec::new();
    if let Ok(it) = read_dir_retry(&vdir) {
        for e in it.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) == Some("md") {
                out.push(serde_json::json!({
                    "name": p.file_stem().and_then(|s| s.to_str()).unwrap_or(""),
                    "path": p.to_string_lossy(),
                }));
            }
        }
    }
    out.sort_by(|a, b| b["name"].as_str().cmp(&a["name"].as_str()));
    Ok(out)
}

// M6: per-domain Ideal State — a `<domain>/ideal-state.md` that targets ONE
// domain, layered under the global ideal-state.md (which still wins conflicts).
// The engine injects it whenever the chat's cwd is that domain (cli-bridge
// findDomainIdeal). domain_dir resolves the v3 (domains/<d>) or legacy layout.
#[tauri::command]
pub(crate) fn read_domain_ideal(vault: String, domain: Option<String>) -> Result<String, String> {
    let p = domain_dir(&vault, &domain).join("ideal-state.md");
    if !p.exists() {
        return Ok(String::new());
    }
    let raw = read_to_string_retry(&p).map_err(|e| e.to_string())?;
    Ok(engine::maybe_decrypt(&p, raw))
}
#[tauri::command]
pub(crate) fn write_domain_ideal(vault: String, domain: Option<String>, body: String) -> Result<(), String> {
    let dir = domain_dir(&vault, &domain);
    let _ = fs::create_dir_all(&dir);
    let p = dir.join("ideal-state.md");
    fs::write(&p, engine::maybe_encrypt(&p, &body)).map_err(|e| format!("write domain ideal: {e}"))
}

// Distilled long-term memory for a domain (vault root for General), written
// by the distill daemon. Prepended to prompts like user.md. Empty if none yet.
#[tauri::command]
pub(crate) fn read_memory_md(vault: String, domain: Option<String>) -> Result<String, String> {
    let p = domain_dir(&vault, &domain).join("_memory.md");
    if !p.exists() {
        return Ok(String::new());
    }
    read_to_string_retry(&p).map_err(|e| e.to_string())
}

