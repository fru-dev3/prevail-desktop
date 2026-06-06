// Tier C — Headed browser automation via Playwright sidecar
//
// We ship a Node script (`resources/automation/playwright_runner.js`)
// that drives Playwright in headed mode with a persistent profile.
// Rust spawns it via tokio::Command, passes the request JSON over
// stdin, and re-emits the script's stdout JSON lines as tauri events
// so the UI can show progress (MFA pause, navigation, downloads).
//
// We deliberately do NOT bundle Playwright with Tauri — the user runs
// `npx playwright install chromium` once. The runner script uses
// `playwright-core` so the npx-bootstrapped install resolves it.
//
// Persistent state per (domain, portal):
//   ~/Library/Application Support/Prevail/automation/profiles/<domain>/<portal>/
//
// Downloads:
//   captured via `page.on("download")`, suggested filename cleaned,
//   moved into `domains/<domain>/imports/` via storage::ingest_artifact.

use super::{storage, BrowserRunRequest, TierStatus};
use std::process::Child;

pub struct BrowserRunner {
    /// The most recent runner subprocess (if any). We keep a single
    /// slot — running multiple automations concurrently is possible
    /// but out of scope for v1 of this engine.
    child: Option<Child>,
    last_error: Option<String>,
    last_run_summary: Option<String>,
}

impl BrowserRunner {
    pub fn new() -> Self {
        Self {
            child: None,
            last_error: None,
            last_run_summary: None,
        }
    }

    /// Path to the bundled Node runner script. Lives under
    /// `src-tauri/resources/automation/` and is copied into the
    /// .app's Resources/ folder at bundle time via tauri.conf.json.
    fn runner_script(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
        use tauri::Manager;
        let resource = app
            .path()
            .resolve(
                "resources/automation/playwright_runner.js",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|e| format!("resolve playwright_runner.js: {e}"))?;
        Ok(resource)
    }

    pub fn run(
        &mut self,
        app: tauri::AppHandle,
        req: BrowserRunRequest,
    ) -> Result<(), String> {
        // Guarantee profile dir exists before the runner needs it.
        let profile = storage::browser_profile_dir(&req.domain, &req.portal)?;
        let imports = storage::imports_dir(&req.domain)?;
        let script = Self::runner_script(&app)?;

        // Spawn via std::process — we don't need tokio here since the
        // runner already streams its own progress and we forward those
        // lines on a worker thread.
        use std::process::{Command, Stdio};
        use std::io::{BufRead, BufReader, Write};

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

        let mut cmd = Command::new("node");
        cmd.arg(&script)
            .env("PATH", combined)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            let msg = format!("spawn playwright runner: {e}");
            self.last_error = Some(msg.clone());
            msg
        })?;

        // Send the request payload over stdin.
        let payload = serde_json::json!({
            "domain": req.domain,
            "portal": req.portal,
            "startUrl": req.start_url,
            "mfaTimeoutSec": req.mfa_timeout_sec,
            "successSelector": req.success_selector,
            "successUrlContains": req.success_url_contains,
            "profileDir": profile.to_string_lossy(),
            "downloadsDir": imports.to_string_lossy(),
        });
        if let Some(mut s) = child.stdin.take() {
            let line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
            let _ = s.write_all(line.as_bytes());
            let _ = s.write_all(b"\n");
        }

        // Stream stdout JSON lines as tauri events. Each line is one
        // event of shape {"type": "...", "...": ...}.
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let app2 = app.clone();
        let app3 = app.clone();
        let domain = req.domain.clone();
        let portal = req.portal.clone();

        if let Some(out) = stdout {
            std::thread::spawn(move || {
                use tauri::Emitter;
                let reader = BufReader::new(out);
                for line in reader.lines().flatten() {
                    // Re-emit verbatim; UI parses the shape.
                    let _ = app2.emit(
                        "ingestion:browser",
                        serde_json::json!({
                            "domain": domain,
                            "portal": portal,
                            "line": line,
                        }),
                    );
                }
            });
        }
        if let Some(err) = stderr {
            std::thread::spawn(move || {
                use tauri::Emitter;
                let reader = BufReader::new(err);
                for line in reader.lines().flatten() {
                    let _ = app3.emit(
                        "ingestion:browser",
                        serde_json::json!({
                            "stream": "stderr",
                            "line": line,
                        }),
                    );
                }
            });
        }

        self.child = Some(child);
        self.last_error = None;
        self.last_run_summary = Some(format!("{} → {}", req.portal, req.start_url));
        Ok(())
    }

    pub fn status(&mut self) -> TierStatus {
        let running = self
            .child
            .as_mut()
            .map(|c| c.try_wait().ok().flatten().is_none())
            .unwrap_or(false);
        let state = if running {
            self.last_run_summary
                .clone()
                .unwrap_or_else(|| "running".to_string())
        } else if let Some(s) = &self.last_run_summary {
            format!("idle (last: {s})")
        } else {
            "idle".to_string()
        };
        TierStatus {
            id: "tier_c_browser".to_string(),
            label: "Browser automation".to_string(),
            state,
            active: true, // always available; no config gate
            running: if running { 1 } else { 0 },
            last_error: self.last_error.clone(),
        }
    }
}
