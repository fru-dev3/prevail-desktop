// ─────────────────────────────────────────────────────────────────────────
// Bunker Mode — the app-wide local-only trust guarantee.
//
// This is the SINGLE SOURCE OF TRUTH for whether the application may touch the
// network. It is NOT a UI preference: every network-capable command consults
// `guard_cloud()` (network actions) or `resolve_cli()` (model invocations)
// before doing anything that could transmit user data off the device. When
// Bunker Mode is on:
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

// Default endpoints for the local OpenAI-compatible model servers. Ollama is the
// engine's native default; LM Studio and MLX (mlx_lm.server) speak the same
// /v1/chat/completions schema, so the engine reaches them by overriding its
// PREVAIL_OLLAMA_URL to the right port (see `local_endpoint_url`). Ports are the
// product defaults: Ollama 11434, LM Studio 1234, mlx_lm.server 8080.
const OLLAMA_HOSTPORT: &str = "127.0.0.1:11434";
const LMSTUDIO_HOSTPORT: &str = "127.0.0.1:1234";
const MLX_HOSTPORT: &str = "127.0.0.1:8080";

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

/// Gate a model invocation by provider on a path that can't auto-switch (the
/// provider is fixed by config: Telegram bridge, distillation, surface
/// generation). Cloud providers are refused while Bunker Mode is active; local
/// providers always pass. Unlike `resolve_cli`, this does not substitute a local
/// provider — these background jobs simply don't run cloud under Bunker.
pub fn guard_cli(cli: &str) -> Result<(), String> {
    if bunker_enabled() && !is_local_cli(cli) {
        return Err(BLOCKED.to_string());
    }
    Ok(())
}

/// TCP reachability probe with a short connect timeout — "is something
/// listening on this host:port right now?". Used to detect whether a local
/// model server is actually up.
fn tcp_up(host_port: &str) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;
    let addr = match host_port.to_socket_addrs().ok().and_then(|mut a| a.next()) {
        Some(a) => a,
        None => return false,
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// Is a specific local provider reachable right now? Each maps to the product's
/// default port: Ollama → 11434, LM Studio → 1234, MLX (mlx_lm.server) → 8080.
/// Anything not a known local provider is never "available" here.
pub fn local_cli_available(cli: &str) -> bool {
    match cli.trim().to_lowercase().as_str() {
        "ollama" => tcp_up(OLLAMA_HOSTPORT),
        "lmstudio" => tcp_up(LMSTUDIO_HOSTPORT),
        "mlx" => tcp_up(MLX_HOSTPORT),
        _ => false,
    }
}

/// The base URL to point the engine's OpenAI-compatible client at for a local
/// provider it doesn't natively distinguish. The engine reaches LM Studio / MLX
/// through its `ollama` provider path by overriding PREVAIL_OLLAMA_URL — so this
/// returns `Some(url)` for those, and `None` for Ollama (the engine's default)
/// and anything else.
pub fn local_endpoint_url(cli: &str) -> Option<&'static str> {
    match cli.trim().to_lowercase().as_str() {
        "lmstudio" => Some("http://127.0.0.1:1234"),
        "mlx" => Some("http://127.0.0.1:8080"),
        _ => None,
    }
}

/// Best-effort check that *some* local model provider is reachable, so the
/// status card / banner can report whether local models are actually available.
fn local_provider_available() -> bool {
    LOCAL_CLIS.iter().any(|c| local_cli_available(c))
}

/// The local provider to fall back to when Bunker Mode must serve a model
/// request the caller aimed at a cloud CLI. Returns the first *available* local
/// provider, probed for real, in `LOCAL_CLIS` order (Ollama first — it works on
/// both the native and engine chat paths; LM Studio / MLX are engine-path only).
/// `None` when nothing local is up.
pub fn preferred_local_cli() -> Option<&'static str> {
    LOCAL_CLIS.iter().copied().find(|c| local_cli_available(c))
}

/// Resolve the CLI to actually run under Bunker Mode. This is the auto-switch
/// refinement: rather than hard-blocking a stale cloud default, transparently
/// fall back to an available local provider. The returned string is what the
/// caller should invoke.
///
///   • Bunker off          → the requested CLI, unchanged.
///   • requested is local  → unchanged (local always runs).
///   • requested is cloud  → swapped for the preferred available local CLI;
///     `Err(BLOCKED)` ONLY when no local provider exists to switch to (so the
///     UI can prompt the user to install/start one).
///
/// Note: this applies to *model invocations* only. Network actions with no
/// local equivalent (web search, Telegram, Composio) stay hard-blocked via
/// `guard_cloud` — there is nothing local to switch them to.
pub fn resolve_cli(requested: &str) -> Result<String, String> {
    if !bunker_enabled() || is_local_cli(requested) {
        return Ok(requested.to_string());
    }
    match preferred_local_cli() {
        Some(local) => Ok(local.to_string()),
        None => Err(BLOCKED.to_string()),
    }
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
    fn guard_cloud_blocks_network_when_enabled() {
        // Force enabled in-process (don't touch the real flag file). Network
        // actions with no local equivalent stay hard-blocked.
        *CACHE.lock().unwrap() = Some(true);
        assert_eq!(guard_cloud(), Err(BLOCKED.to_string()));
        // And allow when disabled.
        *CACHE.lock().unwrap() = Some(false);
        assert_eq!(guard_cloud(), Ok(()));
        *CACHE.lock().unwrap() = None; // reset cache for other tests
    }

    #[test]
    fn guard_cli_blocks_cloud_allows_local_under_bunker() {
        // The fixed-provider guard used by distill / surface / telegram run_cli.
        *CACHE.lock().unwrap() = Some(true);
        assert_eq!(guard_cli("claude"), Err(BLOCKED.to_string()));
        assert_eq!(guard_cli("codex"), Err(BLOCKED.to_string()));
        assert_eq!(guard_cli("ollama"), Ok(()));
        assert_eq!(guard_cli("lmstudio"), Ok(()));
        // Disabled → everything passes.
        *CACHE.lock().unwrap() = Some(false);
        assert_eq!(guard_cli("claude"), Ok(()));
        *CACHE.lock().unwrap() = None; // reset cache for other tests
    }

    #[test]
    fn resolve_cli_passes_through_when_disabled_or_local() {
        // Bunker off → requested CLI is returned verbatim, cloud or not.
        *CACHE.lock().unwrap() = Some(false);
        assert_eq!(resolve_cli("claude"), Ok("claude".to_string()));
        assert_eq!(resolve_cli("ollama"), Ok("ollama".to_string()));
        // Bunker on but the request is already local → unchanged, no probe.
        *CACHE.lock().unwrap() = Some(true);
        assert_eq!(resolve_cli("ollama"), Ok("ollama".to_string()));
        assert_eq!(resolve_cli("MLX"), Ok("MLX".to_string()));
        *CACHE.lock().unwrap() = None; // reset cache for other tests
    }

    #[test]
    fn local_endpoint_url_maps_only_redirected_providers() {
        // Ollama is the engine's native local path → no redirect.
        assert_eq!(local_endpoint_url("ollama"), None);
        // LM Studio / MLX are reached by overriding the engine's local URL.
        assert_eq!(local_endpoint_url("lmstudio"), Some("http://127.0.0.1:1234"));
        assert_eq!(local_endpoint_url("MLX"), Some("http://127.0.0.1:8080"));
        // Cloud / unknown providers never redirect.
        assert_eq!(local_endpoint_url("claude"), None);
        // Every redirected provider must classify as local (so guards pass it).
        assert!(is_local_cli("lmstudio") && is_local_cli("mlx"));
    }

    #[test]
    fn resolve_cli_cloud_under_bunker_switches_or_blocks() {
        // Bunker on + cloud request: the result depends on whether a local
        // provider is actually reachable on this machine. Either way it must
        // NEVER return a cloud CLI — that is the whole guarantee.
        *CACHE.lock().unwrap() = Some(true);
        match resolve_cli("claude") {
            Ok(chosen) => assert!(
                is_local_cli(&chosen),
                "auto-switch must land on a local CLI, got {chosen}"
            ),
            Err(e) => assert_eq!(e, BLOCKED, "no local provider → canonical block"),
        }
        *CACHE.lock().unwrap() = None; // reset cache for other tests
    }
}
