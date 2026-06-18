// Desktop bridge for the Domain Loops runner.
use serde_json::Value;
//
// The loop-running logic lives in the engine (daemon-loops.ts) so there is a
// single source of truth. This command just triggers one pass on demand from
// the UI ("Run loops now"): it shells to the bundled engine with
// `--vault <path> daemon --loops --once`, which advances every due loop and
// rewrites their actions. The long-running background daemon is the same engine
// command without `--once`.
use crate::engine;

#[tauri::command]
pub(crate) async fn loops_run_once(
    vault: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args: Vec<String> = vec![
            "--vault".into(),
            vault,
            "daemon".into(),
            "--loops".into(),
            "--once".into(),
        ];
        if let Some(p) = provider {
            if !p.trim().is_empty() {
                args.push("--cli".into());
                args.push(p);
            }
        }
        if let Some(m) = model {
            if !m.trim().is_empty() {
                args.push("--model".into());
                args.push(m);
            }
        }
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        engine::run_engine_raw(&refs)
    })
    .await
    .map_err(|e| format!("loops task failed: {e}"))?
}

/// Execute ONE user-approved loop action for real, via the engine agent's tools
/// and connectors (`daemon --loops --exec`). Returns the agent's report of what
/// it did. The action was explicitly approved in the UI before reaching here.
#[tauri::command]
pub(crate) async fn loop_execute_action(
    vault: String,
    domain: String,
    action: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args: Vec<String> = vec![
            "--vault".into(),
            vault,
            "daemon".into(),
            "--loops".into(),
            "--exec".into(),
            "--domain".into(),
            domain,
            "--action".into(),
            action,
        ];
        if let Some(p) = provider {
            if !p.trim().is_empty() {
                args.push("--cli".into());
                args.push(p);
            }
        }
        if let Some(m) = model {
            if !m.trim().is_empty() {
                args.push("--model".into());
                args.push(m);
            }
        }
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        engine::run_engine_raw(&refs)
    })
    .await
    .map_err(|e| format!("loop exec task failed: {e}"))?
}

/// Drop one queued pending approval from a domain's `_loops_runtime.json`
/// (matched by loop id + exact text). Used by the cross-domain Decision Inbox to
/// dismiss/clear an item after it's been approved or declined — the per-domain
/// loopspanel does the same write locally. Re-reads fresh before writing so a
/// concurrent daemon pass isn't clobbered. No-op (Ok) if nothing matches.
#[tauri::command]
pub(crate) fn loop_pending_drop(
    vault: String,
    domain: String,
    loop_id: String,
    text: String,
) -> Result<(), String> {
    let path = crate::paths::domain_dir_pub(&vault, &domain).join("_loops_runtime.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Ok(()), // no runtime yet → nothing to drop
    };
    let mut doc: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(entry) = doc.get_mut("loops").and_then(|l| l.get_mut(&loop_id)) {
        if let Some(pending) = entry.get_mut("pending").and_then(|p| p.as_array_mut()) {
            pending.retain(|p| p.get("text").and_then(|v| v.as_str()) != Some(text.as_str()));
        }
    }
    let body = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())
}
