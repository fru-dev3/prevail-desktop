// App favicons — fetch a site's real favicon ONCE, cache it to disk as a
// base64 data: URI, and hand it to the UI. This gives almost every app its
// actual logo (simple-icons dropped many brands like Canva) WITHOUT bundling a
// huge icon set and WITHOUT the CSP allowing external images (a data: URI is
// already permitted). Privacy: it only fires on demand, caches locally, and is
// suppressed entirely in Bunker Mode (nothing leaves the device there).

use std::io::Write;
use std::path::PathBuf;

// Where cached favicons live: ~/.prevail/favicons/<safe-host>.datauri
fn cache_dir() -> PathBuf {
    let base = std::env::var("PREVAIL_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".prevail")
        });
    base.join("favicons")
}

fn safe_host(host: &str) -> String {
    host.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
        .collect()
}

/// Return a base64 data: URI for `host`'s favicon, or "" when unavailable.
/// Cached on disk after the first fetch. Empty in Bunker Mode (offline-only),
/// or when the host is missing / the fetch fails — the UI then shows the letter
/// mark. Never errors in a way that breaks the row; worst case is "".
#[tauri::command]
pub async fn app_favicon(host: String) -> Result<String, String> {
    let host = host.trim().to_lowercase();
    if host.is_empty() || host.contains('/') || host.contains(' ') {
        return Ok(String::new());
    }
    let dir = cache_dir();
    let file = dir.join(format!("{}.datauri", safe_host(&host)));
    // Cache hit — return immediately (works offline, incl. Bunker Mode).
    if let Ok(cached) = std::fs::read_to_string(&file) {
        return Ok(cached);
    }
    // No network in Bunker Mode: return empty so the UI falls back to the letter.
    if crate::bunker::bunker_enabled() {
        return Ok(String::new());
    }
    let uri = fetch_favicon(&host).await.unwrap_or_default();
    if !uri.is_empty() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut f) = std::fs::File::create(&file) {
            let _ = f.write_all(uri.as_bytes());
        }
    }
    Ok(uri)
}

// Fetch the favicon via Google's s2 service (returns a real PNG for known
// domains). Async. Returns a base64 data: URI or None.
async fn fetch_favicon(host: &str) -> Option<String> {
    let url = format!("https://www.google.com/s2/favicons?domain={host}&sz=64");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .ok()?;
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = resp.bytes().await.ok()?;
    // Google returns a tiny generic globe (~ a few hundred bytes) for unknown
    // domains; treat a suspiciously small payload as "no real favicon" so the UI
    // shows the letter mark instead of a meaningless globe.
    if bytes.len() < 120 {
        return None;
    }
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{ct};base64,{b64}"))
}
