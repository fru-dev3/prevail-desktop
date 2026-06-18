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
}

// Every CLI runtime family Prevail knows about. Detection is a PATH lookup on
// the binary; families that aren't installed are still returned (available=false)
// so the Runtimes page can list them all and prompt the user to set them up.
// (id, label, bin). API/direct providers and local servers are appended below.
const CLIS: &[(&str, &str, &str)] = &[
    ("claude", "Claude", "claude"),
    ("codex", "Codex", "codex"),
    ("antigravity", "Antigravity", "agy"),
    ("codebuddy", "Codebuddy", "codebuddy"),
    ("copilot", "Copilot", "copilot"),
    ("opencode", "Opencode", "opencode"),
    ("openclaw", "Openclaw", "openclaw"),
    ("hermes", "Hermes", "hermes"),
    ("gemini", "Gemini", "gemini"),
    ("pi", "Pi", "pi"),
    ("cursor", "Cursor", "cursor-agent"),
    ("kiro", "Kiro", "kiro"),
    // Harnesses (separate category in the UI; detected the same PATH way).
    ("paperclip", "Paperclip", "paperclip"),
    ("motorcar", "Motorcar", "motorcar"),
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

fn probe_cli_version(bin: &str) -> Option<String> {
    let path = resolve_bin_path(bin)?;
    use std::process::Command;
    // Pass the same enriched env chat_send uses — PATH so env-node
    // shebangs resolve, USER/LOGNAME so claude finds its keychain.
    let (combined, user, logname) = build_cli_env();
    let out = Command::new(&path)
        .arg("--version")
        .env_clear()
        .envs(scrubbed_env_pairs())
        .env("PATH", combined)
        .env("USER", user)
        .env("LOGNAME", logname)
        .output()
        .ok()?;
    let text = if !out.stdout.is_empty() {
        String::from_utf8_lossy(&out.stdout).to_string()
    } else if !out.stderr.is_empty() {
        String::from_utf8_lossy(&out.stderr).to_string()
    } else {
        return None;
    };
    let first = text.lines().next()?.trim();
    if first.is_empty() {
        return None;
    }
    Some(first.to_string())
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
        // Special-case ollama: it runs as a daemon, the `ollama` binary
        // is optional. Treat the daemon port as the source of truth.
        let available = if *id == "ollama" {
            // Probe the local API. Tiny HEAD-ish check via TCP — we
            // don't pull in reqwest just for this; a TcpStream connect
            // is enough to know the daemon is up.
            use std::net::TcpStream;
            use std::time::Duration;
            TcpStream::connect_timeout(
                &"127.0.0.1:11434".parse().unwrap(),
                Duration::from_millis(250),
            )
            .is_ok()
                || find_in_known_paths(bin)
        } else {
            find_in_known_paths(bin)
        };
        let version = if available { probe_cli_version(bin) } else { None };
        out.push(CliInfo {
            id: id.to_string(),
            label: label.to_string(),
            bin: bin.to_string(),
            available,
            version,
        });
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
        });
    }
    Ok(out)
}
