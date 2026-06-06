// Storage sandbox
//
// All ingestion artifacts MUST land under
//   ~/Library/Application Support/Prevail/domains/<domain>/imports/
//
// This module is the only place in the codebase that knows that path.
// Tiers ask `imports_dir(domain)` and call `ingest_artifact` to move
// a downloaded file into the canonical location.
//
// We also write a sidecar `<name>.meta.json` next to every artifact
// recording origin tier, source label, sha256, and timestamp. This
// gives any future indexer a self-describing trail without needing
// a separate database table.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

pub const APP_NAME: &str = "Prevail";

/// `~/Library/Application Support/Prevail/`
pub fn app_support_root() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|e| format!("$HOME unset: {e}"))?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join(APP_NAME))
}

/// `~/Library/Application Support/Prevail/domains/<domain>/imports/`
pub fn imports_dir(domain: &str) -> Result<PathBuf, String> {
    if domain.contains('/') || domain.contains("..") {
        return Err(format!("invalid domain segment: {domain}"));
    }
    let dir = app_support_root()?
        .join("domains")
        .join(domain)
        .join("imports");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir imports: {e}"))?;
    Ok(dir)
}

/// `~/Library/Application Support/Prevail/automation/profiles/<domain>/<portal>/`
pub fn browser_profile_dir(domain: &str, portal: &str) -> Result<PathBuf, String> {
    for s in &[domain, portal] {
        if s.contains('/') || s.contains("..") {
            return Err(format!("invalid path segment: {s}"));
        }
    }
    let dir = app_support_root()?
        .join("automation")
        .join("profiles")
        .join(domain)
        .join(portal);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir profile: {e}"))?;
    Ok(dir)
}

/// Records source + lineage next to every artifact. Written as JSON
/// so an indexer can pull it without parsing magic comments.
#[derive(Debug, Clone, Serialize)]
pub struct ArtifactMeta {
    pub tier_id: String,
    pub source: String,
    pub domain: String,
    pub original_name: String,
    pub ts: u64,
    pub sha256: String,
    pub size: u64,
}

/// Move `src` into the canonical imports/ dir for `domain`, rename
/// cleanly, write a sidecar meta file. Returns the final path.
///
/// `clean_name` is the human-facing filename. We slugify it and add
/// a timestamp prefix so concurrent downloads don't collide.
pub fn ingest_artifact(
    src: &Path,
    domain: &str,
    tier_id: &str,
    source: &str,
    clean_name: &str,
) -> Result<(PathBuf, ArtifactMeta), String> {
    if !src.exists() {
        return Err(format!("artifact missing: {}", src.display()));
    }

    let dir = imports_dir(domain)?;

    // Build a sortable, collision-safe filename.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let slug = slugify(clean_name);
    let final_name = format!("{now}_{slug}");
    let dest = dir.join(&final_name);

    // Move, falling back to copy if cross-device.
    if let Err(e) = fs::rename(src, &dest) {
        // EXDEV — cross-device. Copy + remove src.
        if let Err(copy_err) = fs::copy(src, &dest) {
            return Err(format!("move artifact: rename={e}, copy={copy_err}"));
        }
        let _ = fs::remove_file(src);
    }

    // Hash + size for the meta.
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 4096];
    let mut f = fs::File::open(&dest).map_err(|e| format!("open dest: {e}"))?;
    let mut size: u64 = 0;
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("hash read: {e}"))?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
        size += n as u64;
    }
    let sha256 = format!("{:x}", hasher.finalize());

    let meta = ArtifactMeta {
        tier_id: tier_id.to_string(),
        source: source.to_string(),
        domain: domain.to_string(),
        original_name: clean_name.to_string(),
        ts: now,
        sha256: sha256.clone(),
        size,
    };
    let meta_path = dest.with_extension(format!(
        "{}.meta.json",
        dest.extension().and_then(|s| s.to_str()).unwrap_or("bin")
    ));
    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| format!("meta: {e}"))?;
    fs::write(&meta_path, meta_json).map_err(|e| format!("write meta: {e}"))?;

    Ok((dest, meta))
}

/// Filesystem-safe lowercase slug. Keeps the file extension intact.
fn slugify(s: &str) -> String {
    let p = Path::new(s);
    let stem = p.file_stem().and_then(|x| x.to_str()).unwrap_or("artifact");
    let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("");
    let mut out = String::with_capacity(stem.len() + ext.len() + 1);
    for c in stem.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if ext.is_empty() {
        trimmed
    } else {
        format!("{trimmed}.{}", ext.to_ascii_lowercase())
    }
}
