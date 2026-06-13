// Tier D — official CLI connectors
//
// The fourth ingestion pattern. Some apps ship a first-party command-line
// tool that is the natural integration: 1Password (`op`), GitHub (`gh`),
// Stripe (`stripe`), Google Cloud (`gcloud`). When the user has already
// installed and authenticated that CLI, Tier D runs a *read-only* command
// and ingests the captured stdout as an artifact into the matching domain.
//
// Safety model (deliberate, mirrors the rest of ingestion):
//   * No shell. We spawn the binary directly with explicit args; there is
//     never a `sh -c` and never any string interpolation of user input.
//   * Allowlist only. The binary + args come from a bundled provider file
//     (`resources/connectors/cli_providers.json`). The JS surface can only
//     pick a provider by id; it cannot supply arbitrary commands or flags.
//   * Binary names are validated to a bare `[A-Za-z0-9._-]+` token, so no
//     path separators, no `..`, no absolute paths.
//   * We do NOT bundle or install any CLI. The user installs + logs in
//     once, exactly like Tier C requires the user to install Node.
//   * Every run is wall-clock bounded and the captured output is size
//     capped before it is written to disk.

use super::TierStatus;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// One allowlisted CLI integration, loaded verbatim from the bundled
/// `cli_providers.json`. `fetch_args` must always be a read-only command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliProvider {
    pub id: String,
    pub label: String,
    /// Catalog app this maps to (e.g. "1Password").
    pub app: String,
    /// Domain the pulled artifact lands in (e.g. "security").
    pub domain: String,
    /// Bare executable name, resolved on PATH. Validated, never a path.
    pub binary: String,
    /// Read-only command that proves the CLI is installed (e.g. `--version`).
    pub version_args: Vec<String>,
    /// Read-only command whose stdout we ingest (e.g. `item list --format=json`).
    pub fetch_args: Vec<String>,
}

/// Result of a single CLI run, handed back to mod.rs for ingestion.
pub struct CliRunOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub code: Option<i32>,
}

pub struct CliRunner {
    last_error: Option<String>,
    runs: usize,
}

/// Max captured stdout we will persist (5 MiB). A read-only listing that
/// exceeds this is almost certainly the wrong command.
const MAX_OUTPUT: usize = 5 * 1024 * 1024;
/// Wall-clock budget for a single CLI invocation.
const RUN_TIMEOUT_SEC: u64 = 45;

impl CliRunner {
    pub fn new() -> Self {
        Self { last_error: None, runs: 0 }
    }

    /// A binary name is safe only if it is a single bare token — no slashes,
    /// no `..`, nothing that could escape PATH resolution.
    pub fn valid_binary(name: &str) -> bool {
        !name.is_empty()
            && name.len() <= 64
            && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
            && name != ".."
    }

    /// PATH augmented with the usual user/Homebrew install dirs so a CLI the
    /// user installed in a login shell still resolves under the app's env.
    fn augmented_path() -> String {
        let home = std::env::var("HOME").unwrap_or_default();
        let extra = format!(
            "{home}/.local/bin:{home}/.bun/bin:{home}/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        );
        match std::env::var("PATH") {
            Ok(p) if !p.is_empty() => format!("{extra}:{p}"),
            _ => extra,
        }
    }

    /// Spawn `binary args...` directly (no shell), drain both pipes on
    /// threads to avoid pipe-buffer deadlock, and enforce a timeout.
    fn exec(binary: &str, args: &[String]) -> Result<CliRunOutput, String> {
        if !Self::valid_binary(binary) {
            return Err(format!("refusing unsafe binary name: {binary:?}"));
        }
        let mut child = Command::new(binary)
            .args(args)
            .env("PATH", Self::augmented_path())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn {binary}: {e} (is it installed and on PATH?)"))?;

        let mut so = child.stdout.take().ok_or("no stdout pipe")?;
        let mut se = child.stderr.take().ok_or("no stderr pipe")?;
        let h_out = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = so.read_to_end(&mut b);
            b
        });
        let h_err = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = se.read_to_end(&mut b);
            b
        });

        let deadline = Instant::now() + Duration::from_secs(RUN_TIMEOUT_SEC);
        let code = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) => {
                    if Instant::now() > deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(format!("{binary} timed out after {RUN_TIMEOUT_SEC}s"));
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(format!("wait {binary}: {e}")),
            }
        };

        let mut stdout = h_out.join().unwrap_or_default();
        let stderr = String::from_utf8_lossy(&h_err.join().unwrap_or_default()).to_string();
        if stdout.len() > MAX_OUTPUT {
            stdout.truncate(MAX_OUTPUT);
        }
        Ok(CliRunOutput { stdout, stderr, code })
    }

    /// Is the provider's CLI installed? Runs its `version_args` (read-only).
    pub fn probe(&mut self, provider: &CliProvider) -> bool {
        match Self::exec(&provider.binary, &provider.version_args) {
            Ok(out) => out.code == Some(0),
            Err(_) => false,
        }
    }

    /// Run the provider's read-only `fetch_args` and return its output.
    /// A non-zero exit is surfaced as an error (with stderr) so the caller
    /// does not ingest a failed/auth-prompt body.
    pub fn run(&mut self, provider: &CliProvider) -> Result<CliRunOutput, String> {
        let out = Self::exec(&provider.binary, &provider.fetch_args).map_err(|e| {
            self.last_error = Some(e.clone());
            e
        })?;
        if out.code != Some(0) {
            let msg = format!(
                "{} exited with {}: {}",
                provider.binary,
                out.code.map(|c| c.to_string()).unwrap_or_else(|| "signal".into()),
                out.stderr.lines().next().unwrap_or("").trim()
            );
            self.last_error = Some(msg.clone());
            return Err(msg);
        }
        self.runs += 1;
        self.last_error = None;
        Ok(out)
    }

    pub fn status(&mut self) -> TierStatus {
        TierStatus {
            id: "tier_d_cli".to_string(),
            label: "CLI connectors".to_string(),
            state: "ready — run an installed CLI to pull data".to_string(),
            // Tier D is stateless: it is always available to attempt a run.
            active: true,
            running: 0,
            last_error: self.last_error.clone(),
        }
    }
}
