// System Activity reader for the Automation tab. The engine (daemon-loops,
// briefings, sync) appends one JSON line per autonomous event to
// <vault>/_meta/activity.jsonl (resolved via runtime_path, mirroring the cli).
// This command reads that ledger, parses it tolerantly, and returns the most
// recent events newest-first so the desktop can render the feed.
use serde_json::Value;

use crate::paths::runtime_path;
use crate::read_to_string_retry;

#[tauri::command]
pub(crate) fn activity_read(vault: String, limit: Option<usize>) -> Result<Vec<Value>, String> {
    let path = runtime_path(&vault, "_meta").join("activity.jsonl");
    let raw = match read_to_string_retry(path.to_str().unwrap_or_default()) {
        Ok(s) => s,
        Err(_) => return Ok(vec![]), // no log yet → empty feed
    };
    let mut events: Vec<Value> = raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v.get("ts").and_then(|t| t.as_i64()).is_some())
        .collect();
    // Newest first.
    events.sort_by(|a, b| {
        let ta = a.get("ts").and_then(|t| t.as_i64()).unwrap_or(0);
        let tb = b.get("ts").and_then(|t| t.as_i64()).unwrap_or(0);
        tb.cmp(&ta)
    });
    events.truncate(limit.unwrap_or(200).max(1));
    Ok(events)
}
