// Tauri commands backing the Integrations panel. Thin orchestration: capture
// status/install/sync delegate to the bundled prevail engine (which owns the
// schema, vault resolution, dedup, and OS wiring), and the one-click MCP
// registration drives the target CLI's own `mcp add` so the user never copies
// a config by hand.

use std::process::Command;

/// `prevail capture status --json` - stream counts + per-harness wiring.
#[tauri::command]
pub fn capture_status(vault: String) -> Result<serde_json::Value, String> {
    crate::engine::run_engine_json(&["--vault", &vault, "capture", "status"])
}

/// `prevail capture install --json` - wire push hooks + stage the sync backstop.
#[tauri::command]
pub fn capture_install(vault: String) -> Result<serde_json::Value, String> {
    crate::engine::run_engine_json(&["--vault", &vault, "capture", "install"])
}

/// `prevail capture sync --json` - pull prompts from every CLI's transcripts.
/// Can take a moment on the first run (it scans whole transcript trees); Tauri
/// runs sync commands off the UI thread so the cockpit stays responsive.
#[tauri::command]
pub fn capture_sync(vault: String) -> Result<serde_json::Value, String> {
    crate::engine::run_engine_json(&["--vault", &vault, "capture", "sync"])
}

/// One-click: register Prevail as an MCP server in Claude Code via its own CLI.
/// Idempotent (remove-then-add). Flag-less `mcp` invocation so the server follows
/// the saved vault (move-proof) rather than pinning a path. `vault` is accepted
/// for parity/future use but intentionally not pinned into the registration.
#[tauri::command]
pub fn mcp_install_claude(vault: String) -> Result<serde_json::Value, String> {
    let _ = &vault; // registration is flag-less by design; see doc comment
    let engine = crate::engine::resolve_prevail_bin();
    let (path, user, logname) = crate::build_cli_env();

    let run = |args: &[&str]| -> std::io::Result<std::process::Output> {
        Command::new("claude")
            .args(args)
            .env_clear()
            .envs(crate::scrubbed_env_pairs())
            .env("PATH", &path)
            .env("USER", &user)
            .env("LOGNAME", &logname)
            .stdin(std::process::Stdio::null())
            .output()
    };

    // Best-effort remove so a re-install refreshes the command rather than
    // erroring with "already exists". Ignore its result.
    let _ = run(&["mcp", "remove", "prevail"]);

    let out = run(&["mcp", "add", "prevail", "--", &engine, "mcp"])
        .map_err(|e| format!("could not run `claude` - is Claude Code installed and on PATH? ({e})"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Ok(serde_json::json!({
        "ok": out.status.success(),
        "stdout": stdout,
        "stderr": stderr,
    }))
}
