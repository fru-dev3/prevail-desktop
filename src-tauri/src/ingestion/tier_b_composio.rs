// Tier B — Composio managed gateway
//
// When the user has a COMPOSIO_API_KEY configured, we spawn
//   npx @composio/mcp serve
// (or equivalent) as a long-running subprocess. The Composio key is
// kept in the system Keychain under service="prevail.ingestion",
// account="composio". We read it on `start()` and inject as an env
// variable for the child process.
//
// This is effectively a Tier A server with a hard-coded command +
// a Keychain-backed env var. We model it as its own type for clarity
// and so the settings UI can present an opinionated single-button
// "Start Composio" flow.

use super::keychain;
use super::TierStatus;
use std::process::{Child, Command, Stdio};

const COMPOSIO_SERVICE: &str = "prevail.ingestion";
const COMPOSIO_ACCOUNT: &str = "composio";

pub struct ComposioRuntime {
    child: Option<Child>,
    last_error: Option<String>,
}

impl ComposioRuntime {
    pub fn new() -> Self {
        Self {
            child: None,
            last_error: None,
        }
    }

    fn read_key(&self) -> Option<String> {
        keychain::get(COMPOSIO_SERVICE, COMPOSIO_ACCOUNT).ok()
    }

    pub fn set_key(&mut self, key: &str) -> Result<(), String> {
        if key.trim().is_empty() {
            keychain::del(COMPOSIO_SERVICE, COMPOSIO_ACCOUNT)?;
        } else {
            keychain::set(COMPOSIO_SERVICE, COMPOSIO_ACCOUNT, key.trim())?;
        }
        Ok(())
    }

    pub fn start(&mut self) -> Result<(), String> {
        if self.child.is_some() {
            return Ok(());
        }
        let key = self
            .read_key()
            .ok_or_else(|| "no COMPOSIO_API_KEY set".to_string())?;

        let home = std::env::var("HOME").unwrap_or_default();
        let extra_path = format!(
            "{home}/.local/bin:{home}/.bun/bin:/opt/homebrew/bin:/usr/local/bin"
        );
        let cur_path = std::env::var("PATH").unwrap_or_default();
        let combined = if cur_path.is_empty() {
            extra_path
        } else {
            format!("{extra_path}:{cur_path}")
        };

        let mut cmd = Command::new("npx");
        cmd.args(["-y", "@composio/mcp"])
            .env("PATH", combined)
            .env("COMPOSIO_API_KEY", key)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        match cmd.spawn() {
            Ok(child) => {
                self.child = Some(child);
                self.last_error = None;
                Ok(())
            }
            Err(e) => {
                let msg = format!("spawn @composio/mcp: {e}");
                self.last_error = Some(msg.clone());
                Err(msg)
            }
        }
    }

    pub fn stop(&mut self) -> Result<(), String> {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        Ok(())
    }

    pub fn status(&mut self) -> TierStatus {
        let has_key = self.read_key().is_some();
        let running = self.child.is_some();
        let state = match (has_key, running) {
            (false, _) => "no API key in keychain".to_string(),
            (true, false) => "key set; gateway not running".to_string(),
            (true, true) => "running".to_string(),
        };
        TierStatus {
            id: "tier_b_composio".to_string(),
            label: "Composio gateway".to_string(),
            state,
            active: has_key,
            running: if running { 1 } else { 0 },
            last_error: self.last_error.clone(),
        }
    }
}
