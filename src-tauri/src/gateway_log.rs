// Persistent gateway/bridge activity log. The bridges (Telegram, Discord, WebUI)
// only tracked live status before; this KEEPS a durable, capped log on disk so the
// user can see what the gateway has been doing (started, inbound, errors) even
// after a restart. Stored under the vault's build/ bucket (B2-12) as _gateway.log,
// a simple line-per-event ring trimmed to MAX_LINES.

use std::io::Write;
use std::path::PathBuf;

const MAX_LINES: usize = 500;

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn log_path(vault: &str) -> PathBuf {
    // Lives at the vault root for now; once B2-12 (build/ layout) merges this moves
    // to crate::paths::build_root(vault).join("_gateway.log").
    PathBuf::from(vault).join("_gateway.log")
}

/// Append one timestamped event line, trimming to the last MAX_LINES. Best-effort:
/// never returns an error to callers (logging must never break the bridge).
pub(crate) fn append(vault: &str, line: &str) {
    if vault.is_empty() {
        return;
    }
    let path = log_path(vault);
    let (y, mo, d, h, mi, s) = crate::secs_to_ymdhms(now_secs());
    let stamped = format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}  {line}");
    let mut lines: Vec<String> = std::fs::read_to_string(&path)
        .map(|t| t.lines().map(String::from).collect())
        .unwrap_or_default();
    lines.push(stamped);
    let start = lines.len().saturating_sub(MAX_LINES);
    let body = lines[start..].join("\n");
    if let Some(p) = path.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    if let Ok(mut f) = std::fs::File::create(&path) {
        let _ = f.write_all(format!("{body}\n").as_bytes());
    }
}

/// Read recent gateway log lines, newest first, capped at `limit`.
#[tauri::command]
pub(crate) fn gateway_log_read(vault: String, limit: Option<usize>) -> Result<Vec<String>, String> {
    let path = log_path(&vault);
    let mut lines: Vec<String> = std::fs::read_to_string(&path)
        .map(|t| t.lines().filter(|l| !l.trim().is_empty()).map(String::from).collect())
        .unwrap_or_default();
    lines.reverse();
    if let Some(n) = limit {
        lines.truncate(n);
    }
    Ok(lines)
}

/// Clear the gateway log.
#[tauri::command]
pub(crate) fn gateway_log_clear(vault: String) -> Result<(), String> {
    let path = log_path(&vault);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
