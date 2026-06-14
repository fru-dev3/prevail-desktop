// Vault path-safety helpers — the single place that validates a frontend- or
// WebUI-supplied domain / file path before it is joined or touched. Extracted
// from lib.rs because these are shared across many command sections (intents,
// threads, surface, tasks). Pure + std-only.

use std::path::{Path, PathBuf};

// A domain name is safe to join into a path only if it's a plain segment: no
// separators, no "..", no leading dot, reasonable length. Anything else (a
// traversal attempt, incl. via the WebUI) falls back to the vault root.
pub(crate) fn is_safe_domain(d: &str) -> bool {
    !d.is_empty()
        && d.len() <= 64
        && !d.starts_with('.')
        && d.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// Resolve a domain's base directory. v3 nests domains under <vault>/domains/<d>;
// for backward compatibility we still read legacy domains at <vault>/<d>. Prefer
// the v3 home, fall back to an existing legacy dir, default new domains to v3.
// Mirrors the engine's resolveDomainDir so both stacks agree.
pub(crate) fn resolve_domain_base(vault: &str, d: &str) -> PathBuf {
    let nu = PathBuf::from(vault).join("domains").join(d);
    if nu.exists() {
        return nu;
    }
    PathBuf::from(vault).join(d)
}

pub(crate) fn domain_dir(vault: &str, domain: &Option<String>) -> PathBuf {
    match domain {
        Some(d) if is_safe_domain(d) => resolve_domain_base(vault, d),
        _ => PathBuf::from(vault),
    }
}

// Public wrapper for sibling modules (surface.rs, tasks.rs) — applies the same
// safe-domain validation.
pub(crate) fn domain_dir_pub(vault: &str, domain: &str) -> PathBuf {
    domain_dir(vault, &Some(domain.to_string()))
}

// Strict variant for WebUI-reachable WRITE commands (save_thread, save_session,
// list_threads): an unsafe domain is REJECTED, not silently redirected to the
// vault root (audit #3). `<vault>/<domain>/<sub>` for a safe domain, `<vault>/<sub>`
// for the no-domain General space.
pub(crate) fn safe_domain_subdir(vault: &str, domain: &Option<String>, sub: &str) -> Result<PathBuf, String> {
    match domain {
        Some(d) if is_safe_domain(d) => Ok(resolve_domain_base(vault, d).join(sub)),
        Some(d) => Err(format!("invalid domain: {d}")),
        None => Ok(PathBuf::from(vault).join(sub)),
    }
}

// Guard a frontend-supplied path before reading/writing it. Blocks traversal
// and confines the operation to a Prevail-managed file shape (e.g. a thread
// markdown under "/_threads/"). Critical now that some commands are reachable
// over the WebUI. Returns Ok(()) only if the path looks legitimate.
pub(crate) fn guard_managed_path(path: &str, must_contain: &str, ext: &str) -> Result<(), String> {
    if path.contains("..") {
        return Err("invalid path".into());
    }
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    if !path.contains(must_contain) || !path.ends_with(ext) {
        return Err(format!("path must be a Prevail {must_contain} {ext} file"));
    }
    // Symlink-escape defense (audit #3): resolve the real path — or, for a target
    // that doesn't exist yet, its real parent plus the final component — and
    // re-assert the managed shape on the RESOLVED path. A symlink named `x.md`
    // that points at /etc/passwd resolves to a path that no longer ends in `.md`
    // or contains the managed segment, so it's rejected.
    let resolved = match p.canonicalize() {
        Ok(rp) => rp,
        Err(_) => match (p.parent(), p.file_name()) {
            (Some(par), Some(name)) => par
                .canonicalize()
                .map(|c| c.join(name))
                .map_err(|e| format!("invalid path: {e}"))?,
            _ => return Err("invalid path".into()),
        },
    };
    let resolved_str = resolved.to_string_lossy();
    if !resolved_str.contains(must_contain) || !resolved_str.ends_with(ext) {
        return Err("path resolves outside a Prevail-managed location".into());
    }
    Ok(())
}
