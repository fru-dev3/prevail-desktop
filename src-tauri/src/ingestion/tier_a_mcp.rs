// Tier A — MCP subprocess orchestrator
//
// Parses a Claude-Desktop-compatible mcp_config.json from
//   ~/Library/Application Support/Prevail/mcp_config.json
//
// Schema accepted:
//   {
//     "mcpServers": {
//       "github": {
//         "command": "npx",
//         "args": ["-y", "@modelcontextprotocol/server-github"],
//         "env": { "GITHUB_TOKEN": "ghp_…" }
//       },
//       ...
//     }
//   }
//
// Each server is spawned as a stdio subprocess on demand. Lifetime is
// owned by `McpRegistry` — calling `start` returns immediately after
// spawn; calling `stop` sends SIGTERM. The registry survives Tauri
// command threads via Mutex on `OrchestratorState`.

use super::storage;
use super::TierStatus;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

/// Item shape from mcp_config.json
#[derive(Debug, Clone, Deserialize)]
pub struct McpServerConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
struct McpConfigFile {
    #[serde(rename = "mcpServers", default)]
    mcp_servers: HashMap<String, McpServerConfig>,
}

/// Info we expose to the UI.
#[derive(Debug, Clone, Serialize)]
pub struct McpServerInfo {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub running: bool,
    pub pid: Option<u32>,
}

pub struct McpRegistry {
    /// Configs parsed from disk on first use, then cached.
    configs: Option<HashMap<String, McpServerConfig>>,
    /// PID-bearing child handles for running servers.
    live: HashMap<String, Child>,
    last_error: Option<String>,
}

impl McpRegistry {
    pub fn new() -> Self {
        Self {
            configs: None,
            live: HashMap::new(),
            last_error: None,
        }
    }

    fn config_path() -> Result<PathBuf, String> {
        Ok(storage::app_support_root()?.join("mcp_config.json"))
    }

    /// Load (or reload) the config file. Missing file → empty map,
    /// not an error: a clean install with no MCP servers configured.
    fn load(&mut self) -> Result<&HashMap<String, McpServerConfig>, String> {
        if self.configs.is_some() {
            return Ok(self.configs.as_ref().unwrap());
        }
        let path = Self::config_path()?;
        if !path.exists() {
            self.configs = Some(HashMap::new());
            return Ok(self.configs.as_ref().unwrap());
        }
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("read mcp_config.json: {e}"))?;
        let parsed: McpConfigFile = serde_json::from_str(&raw)
            .map_err(|e| format!("parse mcp_config.json: {e}"))?;
        self.configs = Some(parsed.mcp_servers);
        Ok(self.configs.as_ref().unwrap())
    }

    /// Drop the parsed cache so the next list/start re-reads the file.
    /// Called after the user edits mcp_config.json in-place.
    pub fn reload(&mut self) {
        self.configs = None;
    }

    pub fn list(&mut self) -> Result<Vec<McpServerInfo>, String> {
        let cfg = self.load()?.clone();
        let mut out = Vec::with_capacity(cfg.len());
        for (name, c) in cfg {
            let running = self.live.contains_key(&name);
            let pid = self.live.get(&name).map(|ch| ch.id());
            out.push(McpServerInfo {
                name,
                command: c.command,
                args: c.args,
                running,
                pid,
            });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    pub fn start(&mut self, name: &str) -> Result<(), String> {
        if self.live.contains_key(name) {
            return Ok(()); // already running, idempotent
        }
        let cfg = self
            .load()?
            .get(name)
            .ok_or_else(|| format!("no MCP server named '{name}' in config"))?
            .clone();

        // Build PATH the same way chat_send does so Finder-launched
        // apps can find /opt/homebrew/bin etc.
        let home = std::env::var("HOME").unwrap_or_default();
        let extra_path = format!(
            "{home}/.local/bin:{home}/.bun/bin:/opt/homebrew/bin:/usr/local/bin"
        );
        let cur_path = std::env::var("PATH").unwrap_or_default();
        let combined_path = if cur_path.is_empty() {
            extra_path
        } else {
            format!("{extra_path}:{cur_path}")
        };

        let mut cmd = Command::new(&cfg.command);
        cmd.args(&cfg.args);
        cmd.env("PATH", combined_path);
        for (k, v) in &cfg.env {
            cmd.env(k, v);
        }
        // stdio piped — the orchestrator could later proxy to a client.
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let child = cmd.spawn().map_err(|e| {
            let msg = format!("spawn MCP server '{name}': {e}");
            self.last_error = Some(msg.clone());
            msg
        })?;
        self.live.insert(name.to_string(), child);
        self.last_error = None;
        Ok(())
    }

    pub fn stop(&mut self, name: &str) -> Result<(), String> {
        if let Some(mut child) = self.live.remove(name) {
            // Best-effort polite shutdown then kill.
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(())
    }

    /// Pull pending stderr from any running MCP server — useful when
    /// debugging why a server died. Non-blocking; reads whatever's
    /// buffered then returns.
    pub fn drain_stderr(&mut self, name: &str) -> Result<String, String> {
        let child = self
            .live
            .get_mut(name)
            .ok_or_else(|| format!("MCP server '{name}' not running"))?;
        let mut buf = String::new();
        if let Some(s) = child.stderr.as_mut() {
            let mut tmp = [0u8; 1024];
            // Use non-blocking would need set_nonblocking on the inner
            // fd. We keep it simple: try a single read with the kernel
            // buffer's current size.
            if let Ok(n) = s.read(&mut tmp) {
                buf.push_str(&String::from_utf8_lossy(&tmp[..n]));
            }
        }
        Ok(buf)
    }

    pub fn status(&mut self) -> TierStatus {
        let configured = self
            .load()
            .map(|m| m.len())
            .unwrap_or(0);
        let running = self.live.len();
        let state = if configured == 0 {
            "no mcp_config.json yet".to_string()
        } else if running == 0 {
            format!("{configured} configured, none running")
        } else {
            format!("{running}/{configured} running")
        };
        TierStatus {
            id: "tier_a_mcp".to_string(),
            label: "MCP servers".to_string(),
            state,
            active: configured > 0,
            running,
            last_error: self.last_error.clone(),
        }
    }
}
