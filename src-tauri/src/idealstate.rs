// Ideal State (the user's constitution at <vault>/ideal-state.md), the user
// profile (<vault>/user.md), and distilled long-term memory (<vault>/<domain>/
// _memory.md). Read/write commands + version history. Extracted from lib.rs.

use std::fs;
use std::path::PathBuf;

use crate::engine;
use crate::paths::domain_dir;
use crate::{read_dir_retry, read_to_string_retry, secs_to_ymdhms};

// Canonical layout keeps root-config (ideal-state.md, omega.md, user/profile.md)
// under <vault>/build/. Read prefers build/<f>, falling back to the legacy root
// <vault>/<f>; write goes to build/ when it exists (else root). Keeps the root
// clean (PREVAIL.md + data/ + build/ only) while staying back-compatible.
pub(crate) fn config_read_path(vault: &str, f: &str) -> PathBuf {
    let in_build = crate::paths::build_root(vault).join(f);
    if in_build.exists() {
        return in_build;
    }
    PathBuf::from(vault).join(f)
}
pub(crate) fn config_write_path(vault: &str, f: &str) -> PathBuf {
    crate::paths::build_root(vault).join(f)
}

// User-level context — a single `<vault>/user.md` that captures who
// the user is, persistent preferences, recurring details. Mirrors the
// OpenClaw / Hermes user-profile pattern. Read/write via these calls.
#[tauri::command]
pub(crate) fn read_user_md(vault: String) -> Result<String, String> {
    // profile.md is the canonical user-profile file (matches the vault layout and
    // the CLI, which reads profile.md first). user.md is honored only as a legacy
    // fallback for older vaults that used that name.
    let profile = config_read_path(&vault, "profile.md");
    if profile.exists() {
        return read_to_string_retry(&profile).map_err(|e| e.to_string());
    }
    let legacy = config_read_path(&vault, "user.md");
    if legacy.exists() {
        return read_to_string_retry(&legacy).map_err(|e| e.to_string());
    }
    Ok(String::new())
}
#[tauri::command]
pub(crate) fn write_user_md(vault: String, body: String) -> Result<(), String> {
    // Write the canonical profile.md (not the legacy user.md).
    let p = config_write_path(&vault, "profile.md");
    if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
    fs::write(&p, body).map_err(|e| format!("write profile.md: {e}"))
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
    let p = config_read_path(&vault, "ideal-state.md");
    if !p.exists() {
        return Ok(DEFAULT_IDEAL_STATE.to_string());
    }
    read_to_string_retry(&p).map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) fn write_ideal_state(vault: String, body: String) -> Result<(), String> {
    let p = config_write_path(&vault, "ideal-state.md");
    if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
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

