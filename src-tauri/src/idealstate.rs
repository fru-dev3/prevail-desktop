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
    // The canonical user-profile file is `_profile.md`, which config_read_path
    // routes into build/ (build/_profile.md). profile.md / user.md are honored
    // only as legacy read fallbacks for older vaults.
    for name in ["_profile.md", "profile.md", "user.md"] {
        let p = config_read_path(&vault, name);
        if p.exists() {
            return read_to_string_retry(&p).map_err(|e| e.to_string());
        }
    }
    Ok(String::new())
}
#[tauri::command]
pub(crate) fn write_user_md(vault: String, body: String) -> Result<(), String> {
    // Write the canonical build/_profile.md (config_write_path is build-rooted).
    let p = config_write_path(&vault, "_profile.md");
    if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
    crate::vaultio::write_atomic(&p, &body).map_err(|e| format!("write _profile.md: {e}"))
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
            let _ = crate::vaultio::write_atomic(&vp, &existing);
        }
    }
    crate::vaultio::write_atomic(&p, &body).map_err(|e| format!("write ideal-state.md: {e}"))
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
    crate::vaultio::write_atomic(&p, &body).map_err(|e| format!("write domain ideal: {e}"))
}

// Distilled long-term memory for a domain (vault root for General), written
// by the distill daemon. Prepended to prompts like user.md. Empty if none yet.
#[tauri::command]
pub(crate) async fn read_memory_md(vault: String, domain: Option<String>) -> Result<String, String> {
    let p = crate::paths::v4_content_path(&domain_dir(&vault, &domain), "memory/memory.md", "_memory.md");
    if !p.exists() {
        return Ok(String::new());
    }
    read_to_string_retry(&p).map_err(|e| e.to_string())
}

/// X10: pin a fact into the domain's layered memory. Appends a dated bullet under
/// a "Pinned by you" section of `_memory.md` so it grounds every future answer
/// in that domain, alongside the daemon-distilled memory. User-authored, so it is
/// never overwritten by distillation (which manages its own section).
#[tauri::command]
pub(crate) fn append_memory_md(vault: String, domain: Option<String>, note: String) -> Result<(), String> {
    let note = note.trim();
    if note.is_empty() {
        return Err("nothing to pin".into());
    }
    let dir = domain_dir(&vault, &domain);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir domain: {e}"))?;
    let p = crate::paths::v4_content_path(&dir, "memory/memory.md", "_memory.md");
    let existing = if p.exists() { read_to_string_retry(&p).unwrap_or_default() } else { String::new() };
    const HEADER: &str = "## Pinned by you";
    let date = crate::tasks::today_ymd();
    // One-line bullets; collapse newlines so the entry stays a single item.
    let entry = format!("- {} ({})", note.replace('\n', " "), date);
    let next = if existing.contains(HEADER) {
        // Insert the new bullet right after the header line.
        let mut out = String::with_capacity(existing.len() + entry.len() + 1);
        let mut inserted = false;
        for line in existing.lines() {
            out.push_str(line);
            out.push('\n');
            if !inserted && line.trim() == HEADER {
                out.push_str(&entry);
                out.push('\n');
                inserted = true;
            }
        }
        out
    } else {
        let sep = if existing.is_empty() || existing.ends_with('\n') { "" } else { "\n" };
        format!("{existing}{sep}\n{HEADER}\n{entry}\n")
    };
    crate::vaultio::write_atomic(&p, &next).map_err(|e| format!("write _memory.md: {e}"))
}

