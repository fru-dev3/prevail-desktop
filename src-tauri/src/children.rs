// Registry of running spawned child processes — the `prevail` engine
// invocations that chat / council / benchmark launch, keyed by session id (or a
// session prefix for council slots/score). It lets the React side abort a
// long-running run and lets the memory watchdog measure each session's process
// subtree. Extracted from lib.rs; self-contained (no app helpers).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

fn child_registry() -> &'static Mutex<HashMap<String, u32>> {
    static REG: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn register_child(session: &str, pid: u32) {
    if let Ok(mut g) = child_registry().lock() {
        g.insert(session.to_string(), pid);
    }
}

pub(crate) fn unregister_child(session: &str) {
    if let Ok(mut g) = child_registry().lock() {
        g.remove(session);
    }
}

// Snapshot of (session key, pid) for every tracked child. Used by the memory
// watchdog to measure per-session process subtrees.
pub(crate) fn snapshot_children() -> Vec<(String, u32)> {
    match child_registry().lock() {
        Ok(g) => g.iter().map(|(k, v)| (k.clone(), *v)).collect(),
        Err(_) => Vec::new(),
    }
}

// Kill every running child whose registry key starts with `prefix`.
// Returns the number of processes signalled.
#[tauri::command]
pub(crate) fn abort_sessions(prefix: String) -> Result<usize, String> {
    let pids: Vec<(String, u32)> = match child_registry().lock() {
        Ok(g) => g
            .iter()
            .filter(|(k, _)| k.starts_with(&prefix))
            .map(|(k, v)| (k.clone(), *v))
            .collect(),
        Err(_) => return Err("registry poisoned".into()),
    };
    let mut killed = 0;
    for (key, pid) in &pids {
        // Use libc::kill on Unix; on Windows we'd use TerminateProcess.
        #[cfg(unix)]
        unsafe {
            // SIGTERM first; tokio's wait will pick up the exit and emit
            // benchmark:done / chat:done.
            libc::kill(*pid as i32, libc::SIGTERM);
        }
        unregister_child(key);
        killed += 1;
    }
    Ok(killed)
}
