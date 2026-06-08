// ─────────────────────────────────────────────────────────────────────────
// Bunker Mode — the app-wide local-only trust guarantee.
//
// This is the SINGLE SOURCE OF TRUTH for whether the application may touch the
// network. It is NOT a UI preference: every network-capable command consults
// `guard_cloud()` / `guard_cli()` before doing anything that could transmit
// user data off the device. When Bunker Mode is on:
//   • only local model providers (Ollama / LM Studio / MLX) may run,
//   • cloud model invocations, web search, and external integrations are
//     refused with the canonical error "Blocked by Bunker Mode",
//   • no cloud provider API keys are injected into the engine subprocess, and
//   • the engine subprocess is told (PREVAIL_BUNKER=1) to self-enforce.
//
// Default is ON for new installs — the bunker-mode flag file being ABSENT means
// enabled. The user must explicitly opt out (and confirm) to leave Bunker Mode.
// ─────────────────────────────────────────────────────────────────────────

use std::path::PathBuf;
use std::sync::Mutex;

/// The canonical refusal string. Callers return this verbatim so the message is
/// identical everywhere a network action is blocked.
pub const BLOCKED: &str = "Blocked by Bunker Mode";

/// Providers that serve models from this machine only and never make an
/// off-device request. Everything else (claude, codex, antigravity, openrouter,
/// anthropic, gemini, deepseek, groq, together, fireworks, …) is cloud.
pub const LOCAL_CLIS: &[&str] = &["ollama", "lmstudio", "mlx"];

pub fn is_local_cli(cli: &str) -> bool {
    LOCAL_CLIS.contains(&cli.trim().to_lowercase().as_str())
}

fn bunker_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        std::path::Path::new(&home)
            .join("Library/Application Support/sh.prevail.desktop/bunker-mode.txt"),
    )
}

// Cache the flag so the per-call guards don't hit disk. `None` = not yet read.
static CACHE: Mutex<Option<bool>> = Mutex::new(None);

/// Is Bunker Mode currently active? Default ON: an absent flag file (fresh
/// install) means enabled. The file holds "1" (on) or "0" (off).
pub fn bunker_enabled() -> bool {
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(v) = *c {
        return v;
    }
    let v = match bunker_path().and_then(|p| std::fs::read_to_string(p).ok()) {
        Some(s) => s.trim() != "0", // anything but an explicit "0" stays locked down
        None => true,               // new install → Bunker Mode ON by default
    };
    *c = Some(v);
    v
}

fn set_bunker(enabled: bool) {
    if let Some(p) = bunker_path() {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&p, if enabled { "1" } else { "0" });
    }
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    *c = Some(enabled);
}

/// Gate a generic network/cloud action (web search, external MCP, telegram,
/// composio, browser automation). `Err(BLOCKED)` when Bunker Mode is active.
pub fn guard_cloud() -> Result<(), String> {
    if bunker_enabled() {
        Err(BLOCKED.to_string())
    } else {
        Ok(())
    }
}

/// Gate a model invocation by provider. Cloud providers are refused while
/// Bunker Mode is active; local providers always pass.
pub fn guard_cli(cli: &str) -> Result<(), String> {
    if bunker_enabled() && !is_local_cli(cli) {
        return Err(BLOCKED.to_string());
    }
    Ok(())
}

/// Best-effort check that a local model provider is reachable, so the status
/// card can report whether local models are actually available. Probes the
/// Ollama daemon (127.0.0.1:11434) with a short connect timeout.
fn local_provider_available() -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;
    let addr = match "127.0.0.1:11434".to_socket_addrs().ok().and_then(|mut a| a.next()) {
        Some(a) => a,
        None => return false,
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// Runtime enforcement state for the Status Verification Card. These flags
/// reflect what the policy layer ACTUALLY does, not a UI assumption: when
/// `enabled` is true the guards above are live, so network/web/cloud are blocked.
#[tauri::command]
pub fn bunker_status() -> serde_json::Value {
    let enabled = bunker_enabled();
    serde_json::json!({
        "enabled": enabled,
        "network_blocked": enabled,
        "web_blocked": enabled,
        "cloud_blocked": enabled,
        "local_available": local_provider_available(),
        "local_clis": LOCAL_CLIS,
    })
}

/// Flip Bunker Mode. Persists immediately. Returns the fresh status. (The
/// confirmation gate lives in the UI; this is the durable write.)
#[tauri::command]
pub fn bunker_set(enabled: bool) -> serde_json::Value {
    set_bunker(enabled);
    bunker_status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_cli_classification() {
        assert!(is_local_cli("ollama"));
        assert!(is_local_cli("LMStudio".to_lowercase().as_str()));
        assert!(is_local_cli("mlx"));
        assert!(!is_local_cli("claude"));
        assert!(!is_local_cli("codex"));
        assert!(!is_local_cli("openrouter"));
        assert!(!is_local_cli("anthropic"));
    }

    #[test]
    fn guard_cli_blocks_cloud_when_enabled() {
        // Force enabled in-process (don't touch the real flag file).
        *CACHE.lock().unwrap() = Some(true);
        assert_eq!(guard_cli("claude"), Err(BLOCKED.to_string()));
        assert_eq!(guard_cli("ollama"), Ok(()));
        assert_eq!(guard_cloud(), Err(BLOCKED.to_string()));
        // And allows everything when disabled.
        *CACHE.lock().unwrap() = Some(false);
        assert_eq!(guard_cli("claude"), Ok(()));
        assert_eq!(guard_cloud(), Ok(()));
        *CACHE.lock().unwrap() = None; // reset cache for other tests
    }
}
