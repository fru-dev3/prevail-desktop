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

// Claude Code: `claude mcp list` (account + local servers, with live health).
fn discover_claude() -> Vec<RuntimeConnector> {
    let Some(bin) = resolve_bin("claude") else { return vec![] };
    let (path, user, logname) = crate::chat::build_cli_env();
    let out = match Command::new(&bin)
        .args(["mcp", "list"])
        .env("PATH", &path)
        .env("USER", &user)
        .env("LOGNAME", &logname)
        .stdin(std::process::Stdio::null())
        .output()
    {
        Ok(o) => o,
        Err(_) => return vec![],
    };
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    text.lines().filter_map(parse_line).collect()
}

// Codex: `~/.codex/config.toml` has `[mcp_servers.<name>]` sections (plus
// `.tools.*` / `.env` subsections we skip). No live health, so status is
// "configured". Parsed without a TOML crate — we only need the server names.
fn discover_codex() -> Vec<RuntimeConnector> {
    let home = std::env::var("HOME").unwrap_or_default();
    let p = Path::new(&home).join(".codex").join("config.toml");
    let text = match std::fs::read_to_string(&p) { Ok(t) => t, Err(_) => return vec![] };
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in text.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("[mcp_servers.") {
            if let Some(name) = rest.strip_suffix(']') {
                if name.contains('.') { continue; } // a .tools.* / .env subsection
                let name = name.trim().trim_matches('"').to_string();
                if name.is_empty() || !seen.insert(name.clone()) { continue; }
                out.push(RuntimeConnector { runtime: "codex".into(), id: slug(&name), name, endpoint: String::new(), status: "configured".into(), connected: true, source: "local".into() });
            }
        }
    }
    out
}

// Gemini CLI: `~/.gemini/settings.json` -> `mcpServers` object keys.
fn discover_gemini() -> Vec<RuntimeConnector> {
    let home = std::env::var("HOME").unwrap_or_default();
    let p = Path::new(&home).join(".gemini").join("settings.json");
    let text = match std::fs::read_to_string(&p) { Ok(t) => t, Err(_) => return vec![] };
    let v: serde_json::Value = match serde_json::from_str(&text) { Ok(v) => v, Err(_) => return vec![] };
    let mut out = Vec::new();
    if let Some(obj) = v.get("mcpServers").and_then(|m| m.as_object()) {
        for name in obj.keys() {
            out.push(RuntimeConnector { runtime: "gemini".into(), id: slug(name), name: name.clone(), endpoint: String::new(), status: "configured".into(), connected: true, source: "local".into() });
        }
    }
    out
}

/// Discover the MCP connectors already authorized across the user's AI runtimes.
/// `runtime` is claude|codex|gemini|all (default all). Reads each runtime's own
/// config (claude: `claude mcp list`; codex: config.toml; gemini: settings.json)
/// and returns one row per server. Never errors on a missing runtime — an absent
/// tool just contributes nothing, so the UI shows what you actually have.
#[tauri::command]
pub fn discover_runtime_connectors(runtime: Option<String>) -> Result<Vec<serde_json::Value>, String> {
    let rt = runtime.unwrap_or_else(|| "all".into());
    let mut rows: Vec<RuntimeConnector> = Vec::new();
    if rt == "all" || rt == "claude" { rows.extend(discover_claude()); }
    if rt == "all" || rt == "codex" { rows.extend(discover_codex()); }
    if rt == "all" || rt == "gemini" { rows.extend(discover_gemini()); }
    Ok(rows
        .into_iter()
        .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
        .filter(|v| !v.is_null())
        .collect())
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
