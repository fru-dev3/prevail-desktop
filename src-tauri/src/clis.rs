// CLI / provider detection — which model backends are available on this
// machine: the spawnable binaries (claude / codex / antigravity / ollama), the
// OpenRouter HTTP gateway (available iff a Keychain key is stored), and local
// OpenAI-compatible servers (LM Studio / MLX, probed by port). Extracted from
// lib.rs; uses the shared env builders and the bunker/ingestion sibling modules.

use serde::Serialize;
use std::path::Path;

use crate::{build_cli_env, bunker, ingestion, scrubbed_env_pairs};

#[derive(Serialize, Clone)]
pub struct CliInfo {
    pub id: String,
    pub label: String,
    pub bin: String,
    pub available: bool,
    pub version: Option<String>,
    // Set when the binary is present on disk but couldn't actually run — e.g. a
    // wrapper script whose target is missing (the `~/.local/bin/hermes` →
    // `~/.hermes/.../venv/bin/hermes` case). `available` is false in that state,
    // so the runtime reads as broken (needs reinstall) rather than ready.
    pub error: Option<String>,
}

// Every CLI runtime family Prevail knows about. Detection is a PATH lookup on
// the binary; families that aren't installed are still returned (available=false)
// so the Runtimes page can list them all and prompt the user to set them up.
// (id, label, bin). API/direct providers and local servers are appended below.
const CLIS: &[(&str, &str, &str)] = &[
    ("claude", "Claude", "claude"),
    ("codex", "Codex", "codex"),
    ("antigravity", "Antigravity", "agy"),
    ("opencode", "Opencode", "opencode"),
    ("openclaw", "Openclaw", "openclaw"),
    ("hermes", "Hermes", "hermes"),
    ("pi", "Pi", "pi"),
    ("ollama", "Ollama", "ollama"),
];

fn resolve_bin_path(bin: &str) -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.local/bin/{bin}"),
        format!("{home}/.bun/bin/{bin}"),
        format!("/opt/homebrew/bin/{bin}"),
        format!("/usr/local/bin/{bin}"),
        format!("/usr/bin/{bin}"),
    ];
    candidates.into_iter().find(|p| Path::new(p).exists())
}

/// Run `<bin> --version`. The exit status is the signal that matters:
///   `Ok(Some(v))` — ran and reported a version line.
///   `Ok(None)`    — not installed, or ran cleanly but printed nothing parseable.
///   `Err(msg)`    — the binary is on disk but couldn't actually run. The most
///                   common cause is a launcher/wrapper script whose target is
///                   missing (e.g. a removed venv). A non-zero exit with no
///                   stdout is NOT a usable runtime — surfacing stderr here is
///                   what stops a broken harness from reading as "valid/ready".
fn probe_cli_version(bin: &str) -> Result<Option<String>, String> {
    let Some(path) = resolve_bin_path(bin) else {
        return Ok(None);
    };
    use std::process::Command;
    // Pass the same enriched env chat_send uses — PATH so env-node
    // shebangs resolve, USER/LOGNAME so claude finds its keychain.
    let (combined, user, logname) = build_cli_env();
    let out = match Command::new(&path)
        .arg("--version")
        .env_clear()
        .envs(scrubbed_env_pairs())
        .env("PATH", combined)
        .env("USER", user)
        .env("LOGNAME", logname)
        .output()
    {
        Ok(o) => o,
        Err(e) => return Err(format!("{bin}: {e}")),
    };
    let first_line = |b: &[u8]| {
        String::from_utf8_lossy(b)
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .map(str::to_string)
    };
    let stdout_line = first_line(&out.stdout);
    if out.status.success() {
        // Clean exit: prefer stdout, fall back to stderr (some CLIs print the
        // version banner there).
        return Ok(stdout_line.or_else(|| first_line(&out.stderr)));
    }
    // Non-zero exit. If it still printed a version to stdout, tolerate it (a few
    // CLIs exit non-zero on `--version`); otherwise the launcher itself failed.
    if let Some(v) = stdout_line {
        return Ok(Some(v));
    }
    Err(first_line(&out.stderr).unwrap_or_else(|| format!("{bin} --version exited with {}", out.status)))
}

fn find_in_known_paths(bin: &str) -> bool {
    // Mac apps launched from Finder inherit a minimal PATH from
    // launchctl (/usr/bin:/bin:/usr/sbin:/sbin), which excludes the
    // usual CLI install locations. Probe them explicitly.
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.local/bin/{bin}"),
        format!("{home}/.bun/bin/{bin}"),
        format!("/opt/homebrew/bin/{bin}"),
        format!("/usr/local/bin/{bin}"),
        format!("/usr/bin/{bin}"),
    ];
    candidates.iter().any(|p| Path::new(p).exists())
}

#[tauri::command]
pub(crate) async fn detect_clis(_app: tauri::AppHandle) -> Result<Vec<CliInfo>, String> {
    let mut out = Vec::new();
    for (id, label, bin) in CLIS {
        let exists = find_in_known_paths(bin);
        // The probe is the real availability test: a binary that's on disk but
        // can't execute (broken wrapper, missing venv) is NOT a usable runtime.
        // Only probe when the file exists so we don't spawn a missing binary.
        let probe = if exists { probe_cli_version(bin) } else { Ok(None) };
        if *id == "ollama" {
            // Special-case ollama: it runs as a daemon, the `ollama` binary is
            // optional. Treat the daemon port as the source of truth — if it's
            // up, the runtime is usable even when the CLI is absent/broken.
            use std::net::TcpStream;
            use std::time::Duration;
            let daemon = TcpStream::connect_timeout(
                &"127.0.0.1:11434".parse().unwrap(),
                Duration::from_millis(250),
            )
            .is_ok();
            let (version, probe_err) = match probe {
                Ok(v) => (v, None),
                Err(e) => (None, Some(e)),
            };
            let available = daemon || (exists && probe_err.is_none());
            out.push(CliInfo {
                id: id.to_string(),
                label: label.to_string(),
                bin: bin.to_string(),
                available,
                version,
                // A broken binary doesn't matter while the daemon is up.
                error: if available { None } else { probe_err },
            });
        } else {
            let (available, version, error) = match probe {
                // Ran fine (or `exists` is false → not installed, version None).
                Ok(v) => (exists, v, None),
                // On disk but couldn't run → broken, surface why.
                Err(e) => (false, None, Some(e)),
            };
            out.push(CliInfo {
                id: id.to_string(),
                label: label.to_string(),
                bin: bin.to_string(),
                available,
                version,
                error,
            });
        }
    }
    // OpenRouter — an HTTP gateway, not a binary. Available iff an API key is
    // stored in the Keychain (Settings → Providers). Routes to every model.
    let or_key = ingestion::keychain::get("prevail.providers", "openrouter").ok();
    out.push(CliInfo {
        id: "openrouter".to_string(),
        label: "OpenRouter".to_string(),
        bin: "https://openrouter.ai/api/v1".to_string(),
        available: or_key.as_deref().map(|k| !k.is_empty()).unwrap_or(false),
        version: None,
        error: None,
    });
    // Local OpenAI-compatible model servers (no spawnable binary): available iff
    // their default port is listening. The engine reaches them via the
    // PREVAIL_OLLAMA_URL redirect (see bunker::local_endpoint_url). Probed the
    // same way as Ollama's daemon — a TCP connect is enough to know it's up.
    for (id, label) in [("lmstudio", "LM Studio"), ("mlx", "oMLX")] {
        out.push(CliInfo {
            id: id.to_string(),
            label: label.to_string(),
            bin: bunker::local_endpoint_url(id).unwrap_or("").to_string(),
            available: bunker::local_cli_available(id),
            version: None,
            error: None,
        });
    }
    Ok(out)
}
