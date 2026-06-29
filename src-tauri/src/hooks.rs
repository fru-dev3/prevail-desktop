// User-defined hooks (2026 redesign). A hook runs a shell command when a system
// event fires — e.g. a task is created or a chat reply is saved — mirroring the
// Claude-Code-style hook concept but pointed at your life-OS events.
//
// Hooks are stored as <vault>/hooks.json. Execution is fire-and-forget via bash;
// the event context is passed to the command as environment variables:
//   PREVAIL_HOOK_EVENT, PREVAIL_HOOK_NAME, PREVAIL_HOOK_DOMAIN, PREVAIL_VAULT.
//
// Events that currently fire are wired at their source:
//   • task.created  → tasks::tasks_add
//   • chat.reply    → threads::save_thread (only when a real assistant reply lands)
// A hook with event "manual" never fires automatically — it's run on demand via
// hooks_run (the "Run now" button), useful for testing a command.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Hook {
    pub id: String,
    pub name: String,
    /// "task.created" | "chat.reply" | "manual"
    pub event: String,
    /// The shell command to run.
    pub command: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Optional domain scope. None / "" means the hook fires for every domain.
    #[serde(default)]
    pub domain: Option<String>,
}

fn hooks_path(vault: &str) -> PathBuf {
    PathBuf::from(vault).join("hooks.json")
}

pub fn load_hooks(vault: &str) -> Vec<Hook> {
    match std::fs::read_to_string(hooks_path(vault)) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
pub fn hooks_read(vault: String) -> Result<Vec<Hook>, String> {
    Ok(load_hooks(&vault))
}

#[tauri::command]
pub fn hooks_write(vault: String, hooks: Vec<Hook>) -> Result<(), String> {
    let body = serde_json::to_string_pretty(&hooks).map_err(|e| e.to_string())?;
    std::fs::write(hooks_path(&vault), body).map_err(|e| format!("write hooks: {e}"))
}

/// Run one hook's command now and return combined stdout/stderr (manual test).
#[tauri::command]
pub fn hooks_run(vault: String, id: String) -> Result<String, String> {
    let hook = load_hooks(&vault)
        .into_iter()
        .find(|h| h.id == id)
        .ok_or_else(|| "hook not found".to_string())?;
    let out = std::process::Command::new("bash")
        .arg("-lc")
        .arg(&hook.command)
        .env("PREVAIL_HOOK_EVENT", &hook.event)
        .env("PREVAIL_HOOK_NAME", &hook.name)
        .env("PREVAIL_VAULT", &vault)
        .env("PREVAIL_HOOK_DOMAIN", hook.domain.clone().unwrap_or_default())
        .output()
        .map_err(|e| format!("run hook: {e}"))?;
    let mut s = String::from_utf8_lossy(&out.stdout).to_string();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        s.push_str("\n[stderr]\n");
        s.push_str(&err);
    }
    if s.trim().is_empty() {
        s = format!("(exit {}, no output)", out.status.code().unwrap_or(-1));
    }
    Ok(s)
}

/// Fire every enabled hook matching `event` (respecting domain scope) for a
/// vault. Fire-and-forget: each command is spawned detached so callers never
/// block on it. Safe to call from any command's success path.
pub fn fire_hooks(vault: &str, event: &str, domain: Option<&str>) {
    for h in load_hooks(vault)
        .into_iter()
        .filter(|h| h.enabled && h.event == event)
    {
        // A domain-scoped hook only fires for its domain.
        if let Some(hd) = h.domain.as_deref() {
            if !hd.is_empty() && Some(hd) != domain {
                continue;
            }
        }
        let _ = std::process::Command::new("bash")
            .arg("-lc")
            .arg(&h.command)
            .env("PREVAIL_HOOK_EVENT", event)
            .env("PREVAIL_HOOK_NAME", &h.name)
            .env("PREVAIL_VAULT", vault)
            .env("PREVAIL_HOOK_DOMAIN", domain.unwrap_or_default())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
}
