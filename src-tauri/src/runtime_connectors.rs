// Runtime connector discovery — the "pass-through" source in Prevail's Connections
// model. Instead of making the user re-authorize every app, we READ the MCP
// connectors they've already authorized in a model runtime (starting with Claude
// Code) and surface them so they're usable with their real logos and zero setup.
//
// Phase 1 (this file): DISCOVER + surface, read-only. `claude mcp list` prints one
// line per server — the account-managed `claude.ai <App>` connectors plus any
// local/user MCP servers — with a health status. We parse those into structured
// rows the Apps UI renders with a "via Claude Code" badge. Actually USING them in
// chat is Phase 2.

use std::path::Path;
use std::process::Command;

// Mirror clis.rs resolve_bin_path (private there): the well-known install spots a
// CLI lands in, checked before a bare PATH lookup.
fn resolve_bin(bin: &str) -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.local/bin/{bin}"),
        format!("{home}/.bun/bin/{bin}"),
        format!("/opt/homebrew/bin/{bin}"),
        format!("/usr/local/bin/{bin}"),
        format!("/usr/bin/{bin}"),
    ];
    if let Some(p) = candidates.into_iter().find(|p| Path::new(p).exists()) {
        return Some(p);
    }
    // Fall back to `which` with the enriched PATH (env-node shebangs etc.).
    let (path, _u, _l) = crate::chat::build_cli_env();
    if let Ok(out) = Command::new("which")
        .arg(bin)
        .env("PATH", &path)
        .stdin(std::process::Stdio::null())
        .output()
    {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() && Path::new(&p).exists() {
                return Some(p);
            }
        }
    }
    None
}

// One discovered connector row.
#[derive(serde::Serialize)]
struct RuntimeConnector {
    runtime: String,       // "claude"
    /// Stable id for logo/catalog matching, e.g. "alltrails".
    id: String,
    /// Human name as the runtime reports it, minus the "claude.ai " prefix.
    name: String,
    endpoint: String,
    status: String,
    connected: bool,
    /// "account" = claude.ai-managed connector; "local" = a user/project MCP.
    source: String,
}

fn slug(name: &str) -> String {
    let s: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    s.trim_matches('-')
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

// Parse one `claude mcp list` line: "<name>: <endpoint> - <status>".
// Endpoints don't contain " - "; status is the tail after the LAST " - ".
fn parse_line(line: &str) -> Option<RuntimeConnector> {
    let line = line.trim();
    if line.is_empty() || line.starts_with("Checking") {
        return None;
    }
    let (head, status) = line.rsplit_once(" - ")?;
    let (raw_name, endpoint) = head.split_once(": ")?;
    let raw_name = raw_name.trim();
    let (name, source) = match raw_name.strip_prefix("claude.ai ") {
        Some(app) => (app.trim().to_string(), "account"),
        None => (raw_name.to_string(), "local"),
    };
    // ✔ = healthy/connected; ! = needs attention (auth, tool fetch failed).
    let connected = status.contains('✔');
    Some(RuntimeConnector {
        runtime: "claude".into(),
        id: slug(&name),
        name,
        endpoint: endpoint.trim().to_string(),
        status: status.trim().to_string(),
        connected,
        source: source.into(),
    })
}

/// Discover the MCP connectors already authorized in the given runtime (only
/// "claude" is wired for now). Runs `claude mcp list` and returns one row per
/// server. Never errors on "claude not installed" — returns an empty list so the
/// UI just shows nothing rather than a scary error. A real spawn failure (claude
/// present but unrunnable) surfaces as Err so the UI can say so.
#[tauri::command]
pub fn discover_runtime_connectors(runtime: Option<String>) -> Result<Vec<serde_json::Value>, String> {
    let rt = runtime.unwrap_or_else(|| "claude".into());
    if rt != "claude" {
        // Gemini / Codex discovery is Phase 3.
        return Ok(vec![]);
    }
    let Some(bin) = resolve_bin("claude") else {
        return Ok(vec![]); // claude not installed — nothing to pass through
    };
    let (path, user, logname) = crate::chat::build_cli_env();
    let out = Command::new(&bin)
        .args(["mcp", "list"])
        .env("PATH", &path)
        .env("USER", &user)
        .env("LOGNAME", &logname)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("could not run `claude mcp list`: {e}"))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let rows: Vec<serde_json::Value> = text
        .lines()
        .filter_map(parse_line)
        .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
        .filter(|v| !v.is_null())
        .collect();
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_account_and_local_lines() {
        let a = parse_line("claude.ai AllTrails: https://www.alltrails.com/mcp - ✔ Connected").unwrap();
        assert_eq!(a.name, "AllTrails");
        assert_eq!(a.id, "alltrails");
        assert_eq!(a.source, "account");
        assert!(a.connected);

        let p = parse_line("prevail: /Users/x/dist/prevail mcp --unsafe-detach - ✔ Connected").unwrap();
        assert_eq!(p.name, "prevail");
        assert_eq!(p.source, "local");
        assert!(p.connected);

        let n = parse_line("claude.ai Privacy.com: https://mcp.privacy.com - ! Needs authentication").unwrap();
        assert_eq!(n.name, "Privacy.com");
        assert_eq!(n.id, "privacy-com");
        assert!(!n.connected);

        assert!(parse_line("Checking MCP server health…").is_none());
        assert!(parse_line("").is_none());
    }
}
