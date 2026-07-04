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

// W4: the v4 `data/` container. Once a vault is migrated (engine: `prevail vault
// migrate-data`), domains + apps live under <vault>/data/; readers prefer it the
// instant it exists. Mirrors the engine's dataRoot() so the CLI, TUI, and
// desktop all agree on where content lives. NOTE: the General-bucket loose files
// (domain == None) still resolve to the vault ROOT in BOTH stacks — that reader
// switch ships separately, once it can be live-verified across all three.
pub(crate) fn data_root(vault: &str) -> PathBuf {
    let d = PathBuf::from(vault).join("data");
    if d.is_dir() {
        d
    } else {
        PathBuf::from(vault)
    }
}

// App-scope conversation keys. The desktop gives an open app its OWN thread space
// keyed `_app-<id>` (App.tsx, chatpanel.tsx) so app chats live in the app's space,
// independent of any domain. That key is NOT a domain: resolving it like one would
// materialize a shadow folder under data/domains/_app-<id>, shadowing the real app
// at data/apps/<id>. Instead route `_app-<id>` to the app's OWN space under
// data/apps/<id>/_scope. MUST mirror the engine's appScopeId + resolveDomainDir
// (path-safety.ts) exactly so the desktop READS app-scope threads/journal from the
// same place the engine WRITES them; a split would lose app chat history.
pub(crate) const APP_SCOPE_PREFIX: &str = "_app-";
pub(crate) const APP_SCOPE_SUBDIR: &str = "_scope";

// The app id for an `_app-<id>` scope key, or None for a normal domain. Rejects
// ids that could escape the apps container.
pub(crate) fn app_scope_id(d: &str) -> Option<String> {
    let id = d.strip_prefix(APP_SCOPE_PREFIX)?;
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return None;
    }
    Some(id.to_string())
}

// v4 layout (source/ · memory/ · .system/). A domain is v4 once the migrator has
// dropped this marker; until then every vault reads/writes the legacy flat names,
// so this is a no-op on un-migrated vaults.
pub(crate) const V4_MARKER: &str = ".prevail-layout-v4";

pub(crate) fn is_v4_domain(domain_dir: &Path) -> bool {
    domain_dir.join(V4_MARKER).exists()
}

/// The path a logical content file lives at, honoring the domain's layout: the
/// v4 sub-path on a migrated domain, else the legacy name. Used by BOTH readers
/// and writers so a v4 domain round-trips consistently (read new, write new).
/// Creates the v4 parent dir on demand so a writer can target it safely.
pub(crate) fn v4_content_path(domain_dir: &Path, v4_rel: &str, legacy: &str) -> PathBuf {
    if is_v4_domain(domain_dir) {
        let p = domain_dir.join(v4_rel);
        if let Some(parent) = p.parent() { let _ = std::fs::create_dir_all(parent); }
        p
    } else {
        domain_dir.join(legacy)
    }
}

// B2-12 (Phase 1, additive — no behavior change yet): the `build/` container for
// supporting/runtime files (ledgers, _meta, _threads, benchmark, usage, …).
// `runtime_path` PREFERS <vault>/build/<name> when build/ exists, else falls back
// to the current location (vault root), so nothing changes until a migration
// creates build/. Readers should be routed through this in Phase 2.
pub(crate) fn build_root(vault: &str) -> PathBuf {
    let b = PathBuf::from(vault).join("build");
    if b.is_dir() { b } else { PathBuf::from(vault) }
}
#[allow(dead_code)]
pub(crate) fn runtime_path(vault: &str, name: &str) -> PathBuf {
    let build_dir = PathBuf::from(vault).join("build");
    // build/ is the SINGLE canonical home for app-support. When it exists, ALWAYS
    // resolve under it (reads and writes) and never fall back to a root-level
    // legacy path - that fallback produced split state outside data/ and build/.
    // Only a pre-build vault uses the root, and only until build/ is created.
    if build_dir.is_dir() {
        return build_dir.join(name);
    }
    PathBuf::from(vault).join(name)
}

// Resolve a domain's base directory. Resolution order (newest wins):
// v4 <vault>/data/domains/<d>, then v3 <vault>/domains/<d>, else the canonical v4
// home for a brand-new domain. The legacy <vault>/<d> ROOT branch is intentionally
// GONE: the on-load migrator (vault_migrate_layout) merges any root domain into
// data/domains/<d> BEFORE domains are resolved, so data/domains is the source of
// truth. Never resolving to the root means the engine never WRITES a domain back
// to the vault root (which is what left root-level domain folders behind).
// Mirrors the engine's resolveDomainDir.
pub(crate) fn resolve_domain_base(vault: &str, d: &str) -> PathBuf {
    // App-scope keys (`_app-<id>`) belong with the app, not among domains. Route
    // them to data/apps/<id>/_scope so no data/domains/_app-<id> shadow appears
    // and the desktop reads the SAME location the engine writes. Mirrors the
    // engine's resolveDomainDir.
    if let Some(id) = app_scope_id(d) {
        return data_root(vault).join("apps").join(id).join(APP_SCOPE_SUBDIR);
    }
    let v4 = data_root(vault).join("domains").join(d);
    if v4.exists() {
        return v4;
    }
    let v3 = PathBuf::from(vault).join("domains").join(d);
    if v3.exists() {
        return v3;
    }
    // Brand-new domains (and post-migration domains) default to the canonical
    // home under the content root. Never the legacy vault root.
    v4
}

// The General space is a first-class domain. Canonical home: data/domains/general
// on a v4 vault (one with a data/ dir); legacy vaults (no data/) keep General at
// the vault root so older content still reads without a migration. MUST mirror the
// engine's generalDir() (decisions.ts) exactly.
pub(crate) fn general_dir(vault: &str) -> PathBuf {
    let dr = data_root(vault);
    if dr != PathBuf::from(vault) {
        dr.join("domains").join("general")
    } else {
        PathBuf::from(vault)
    }
}

fn is_general(d: &str) -> bool {
    d.is_empty() || d == "general" || d == "__general__"
}

pub(crate) fn domain_dir(vault: &str, domain: &Option<String>) -> PathBuf {
    match domain {
        Some(d) if is_general(d) => general_dir(vault),
        Some(d) if is_safe_domain(d) => resolve_domain_base(vault, d),
        _ => general_dir(vault), // None or unsafe → the general domain
    }
}

// Resolve a SUPPORTING runtime file (ledger / journal / surface / threads). Now
// that General is a real domain, ALL of a domain's supporting files (General's
// included) live inside its domain dir. Truly GLOBAL app-support (_meta, activity)
// goes through runtime_path/build_root directly, not here. Do NOT use for CONTENT
// files unless the domain dir is the intended home (it now is, for General too).
pub(crate) fn runtime_file(vault: &str, domain: &Option<String>, file: &str) -> PathBuf {
    domain_dir(vault, domain).join(file)
}

/// Every domain directory across BOTH layouts — v3 (<vault>/domains/<d>) and
/// legacy (<vault>/<d>) — deduped by name (v3 wins). Skips hidden/underscore
/// entries and the structural "domains"/"apps" containers. The one place daemons
/// (distill/taskgen/skillgen/intents) should enumerate domains, so none silently
/// skip the v3 layout.
pub(crate) fn enumerate_domain_dirs(vault: &Path) -> Vec<(String, PathBuf)> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<(String, PathBuf)> = Vec::new();
    // v4 (<vault>/data/domains) then v3 (<vault>/domains) — newest wins on a name
    // clash. When no data/ dir exists data_root() == vault so these collapse.
    let vault_str = vault.to_string_lossy().to_string();
    for container in [data_root(&vault_str).join("domains"), vault.join("domains")] {
        if let Ok(rd) = std::fs::read_dir(&container) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with('.') || name.starts_with('_') {
                    continue;
                }
                let p = e.path();
                if p.is_dir() && seen.insert(name.clone()) {
                    out.push((name, p));
                }
            }
        }
    }
    if let Ok(rd) = std::fs::read_dir(vault) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('_') || name == "data" || name == "domains" || name == "apps" {
                continue;
            }
            let p = e.path();
            if p.is_dir() && seen.insert(name.clone()) {
                out.push((name, p));
            }
        }
    }
    out
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
    let base = match domain {
        Some(d) if is_general(d) => general_dir(vault),
        Some(d) if is_safe_domain(d) => resolve_domain_base(vault, d),
        Some(d) => return Err(format!("invalid domain: {d}")),
        // General (no domain) is a first-class domain now: all its subdirs
        // (_threads included) live under general_dir (data/domains/general on v4,
        // else the vault root), consistent with a named domain.
        None => general_dir(vault),
    };
    // v4 layout: legacy flat subdirs move under memory/. Remap so every reader
    // that goes through this chokepoint (threads especially) finds them at their
    // new home once a domain is migrated. No-op on un-migrated domains.
    let sub = if is_v4_domain(&base) {
        match sub {
            "_threads" => "memory/threads",
            other => other,
        }
    } else {
        sub
    };
    Ok(base.join(sub))
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

#[cfg(test)]
mod v4_path_tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolves_legacy_until_marked_then_v4() {
        let d = std::env::temp_dir().join(format!("prevail-v4path-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        // No marker -> legacy path, unchanged behavior.
        assert_eq!(v4_content_path(&d, "memory/state.md", "_state.md"), d.join("_state.md"));
        assert!(!is_v4_domain(&d));
        // Marked -> v4 path, and the parent (memory/) is created so a writer can use it.
        fs::write(d.join(V4_MARKER), "1").unwrap();
        assert!(is_v4_domain(&d));
        let p = v4_content_path(&d, "memory/state.md", "_state.md");
        assert_eq!(p, d.join("memory").join("state.md"));
        assert!(d.join("memory").is_dir());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn app_scope_id_strips_prefix_and_rejects_traversal() {
        assert_eq!(app_scope_id("_app-google").as_deref(), Some("google"));
        assert_eq!(app_scope_id("_app-composio-notion").as_deref(), Some("composio-notion"));
        assert_eq!(app_scope_id("health"), None);
        assert_eq!(app_scope_id("_appstore"), None); // no hyphen -> not a scope key
        assert_eq!(app_scope_id("_app-"), None);
        assert_eq!(app_scope_id("_app-../evil"), None);
        assert_eq!(app_scope_id("_app-a/b"), None);
    }

    #[test]
    fn app_scope_reroutes_into_apps_container_not_domains() {
        let root = std::env::temp_dir().join(format!("prevail-appscope-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("data").join("apps")).unwrap();
        fs::create_dir_all(root.join("data").join("domains")).unwrap();
        let vault = root.to_string_lossy().to_string();
        // _app-google -> data/apps/google/_scope, never data/domains.
        let base = resolve_domain_base(&vault, "_app-google");
        assert_eq!(base, root.join("data").join("apps").join("google").join("_scope"));
        assert!(!base.to_string_lossy().contains("domains"));
        // A thread subdir lands with the app.
        let threads = safe_domain_subdir(&vault, &Some("_app-google".to_string()), "_threads").unwrap();
        assert_eq!(threads, root.join("data").join("apps").join("google").join("_scope").join("_threads"));
        // A real domain still resolves under data/domains.
        fs::create_dir_all(root.join("data").join("domains").join("health")).unwrap();
        let dom = resolve_domain_base(&vault, "health");
        assert_eq!(dom, root.join("data").join("domains").join("health"));
        let _ = fs::remove_dir_all(&root);
    }
}
