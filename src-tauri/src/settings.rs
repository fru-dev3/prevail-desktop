// Settings — provider API-key storage (Keychain), UI settings/preferences JSON
// blobs (on disk, read by the frontend), and the close-to-tray marker. Extracted
// from lib.rs. close_to_tray_enabled is re-exported at the crate root because the
// window-close handler in run() reads it.

use std::fs;
use std::path::{Path, PathBuf};

use crate::ingestion;
use crate::read_to_string_retry;

// Provider API-key storage (Keychain service "prevail.providers"). Used by the
// Settings → Providers section + the AI-provider onboarding. get returns "" if
// unset (so the UI shows "not configured" without treating it as an error).
#[tauri::command]
pub(crate) fn provider_key_set(provider: String, key: String) -> Result<(), String> {
    ingestion::keychain::set("prevail.providers", &provider, &key)
}
// Presence check only — never returns the secret value to the frontend.
#[tauri::command]
pub(crate) fn provider_key_last4(provider: String) -> Option<String> {
    ingestion::keychain::get("prevail.providers", &provider)
        .ok()
        .filter(|k| k.len() >= 4)
        .map(|k| k[k.len() - 4..].to_string())
}

#[tauri::command]
pub(crate) fn provider_key_exists(provider: String) -> bool {
    ingestion::keychain::get("prevail.providers", &provider)
        .map(|k| !k.is_empty())
        .unwrap_or(false)
}
#[tauri::command]
pub(crate) fn provider_key_del(provider: String) -> Result<(), String> {
    ingestion::keychain::del("prevail.providers", &provider)
}

fn ui_settings_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(Path::new(&home).join("Library/Application Support/sh.prevail.desktop/ui-settings.json"))
}

/// Cross-device UI settings (theme, palette, …) persisted on the desktop as a
/// JSON blob so the WebUI inherits the same look-and-feel instead of starting
/// from a blank browser localStorage. Returns "{}" when nothing is saved yet.
#[tauri::command]
pub(crate) fn ui_settings_get() -> String {
    ui_settings_path()
        .and_then(|p| read_to_string_retry(&p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "{}".to_string())
}

/// Cross-device UI PREFERENCES blob (pinned domains, model picks, per-domain
/// toggles) — the broader sibling of ui_settings, so the WebUI mirrors the
/// desktop's working state instead of starting blank. Frontend owns the schema.
fn ui_prefs_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::Path::new(&home).join("Library/Application Support/sh.prevail.desktop/ui-prefs.json"))
}

#[tauri::command]
pub(crate) fn ui_prefs_get() -> String {
    ui_prefs_path()
        .and_then(|p| read_to_string_retry(&p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "{}".to_string())
}

#[tauri::command]
pub(crate) fn ui_prefs_set(json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid ui prefs json: {e}"))?;
    let p = ui_prefs_path().ok_or("no HOME directory")?;
    if let Some(dir) = p.parent() {
        let _ = fs::create_dir_all(dir);
    }
    fs::write(&p, json).map_err(|e| e.to_string())
}

/// Persist cross-device UI settings. The frontend owns the schema; we only
/// validate that it's well-formed JSON so we never write garbage to disk.
#[tauri::command]
pub(crate) fn ui_settings_set(json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid ui settings json: {e}"))?;
    let p = ui_settings_path().ok_or("no HOME directory")?;
    if let Some(dir) = p.parent() {
        let _ = fs::create_dir_all(dir);
    }
    fs::write(&p, json).map_err(|e| e.to_string())
}

// Close-to-tray flag — stored as a marker FILE (not localStorage) so the Rust
// window-close handler can read it without a webview round-trip. The frontend
// toggle calls set_close_to_tray to create/remove it.
fn close_to_tray_marker() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(Path::new(&home).join("Library/Application Support/sh.prevail.desktop/close-to-tray"))
}
pub(crate) fn close_to_tray_enabled() -> bool {
    close_to_tray_marker().map(|p| p.exists()).unwrap_or(false)
}
#[tauri::command]
pub(crate) fn set_close_to_tray(enabled: bool) -> Result<(), String> {
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
