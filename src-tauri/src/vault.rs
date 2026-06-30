// Vault scanning — discover the domain folders under a vault and summarize each
// for the sidebar. The cross-cutting read helpers (read_to_string_retry,
// read_dir_retry) and NON_DOMAIN_DIRS stay in lib.rs (used everywhere);
// this module is just the Domain shape + the scan command. Extracted from lib.rs.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{read_dir_retry, read_to_string_retry, NON_DOMAIN_DIRS};

#[derive(Serialize, Clone)]
pub(crate) struct Domain {
    pub name: String,
    pub path: String,
    pub has_state: bool,
    pub state_preview: Option<String>,
}

/// Pull a short, human-meaningful summary from a domain's state.md for card
/// previews. Skips the H1 title, blockquote synthetic-data warnings, horizontal
/// rules, code fences and blank lines, then takes the first couple of real
/// content lines (typically the `**Key:** value` metadata) with markdown
/// markers stripped. Returns None if nothing meaningful is found.
fn meaningful_preview(md: &str) -> Option<String> {
    // Strip a leading YAML frontmatter block (--- … ---) so v2 `_state.md`
    // provenance (`derived_from:` etc.) never leaks into the card preview.
    let mut lines: Vec<&str> = md.lines().collect();
    if lines.first().map(|l| l.trim()) == Some("---") {
        if let Some(end) = lines.iter().skip(1).position(|l| l.trim() == "---") {
            lines = lines.split_off(end + 2); // drop through the closing `---`
        }
    }
    let mut picked: Vec<String> = Vec::new();
    for raw in lines {
        let line = raw.trim();
        if line.is_empty()
            || line.starts_with('#')
            || line.starts_with('>')
            || line.starts_with("---")
            || line.starts_with("```")
        {
            continue;
        }
        let cleaned = line
            .replace("**", "")
            .replace('`', "")
            .trim_start_matches(|c: char| c == '-' || c == '*' || c == ' ')
            .trim()
            .to_string();
        if cleaned.is_empty() {
            continue;
        }
        picked.push(cleaned);
        if picked.len() >= 2 {
            break;
        }
    }
    if picked.is_empty() {
        None
    } else {
        Some(picked.join(" · "))
    }
}

/// Move a single ROOT entry (file OR dir) named `name` into `dest_dir`, by an
/// fs::rename (a MOVE, never copy+delete). SAFE: if `src` is absent it is a
/// no-op; if `dest` already exists it is SKIPPED (never overwrites) and the
/// source is left in place. Creates `dest_dir` only when there is something to
/// move into it. Bumps `*moved` on a successful move. Used by the canonical
/// layout convergence to relocate build-support, config and General-bucket
/// content without ever risking user data.
fn move_root_entry(root: &Path, name: &str, dest_dir: &Path, moved: &mut u64) -> Result<(), String> {
    let src = root.join(name);
    if !src.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("mkdir {}: {e}", dest_dir.display()))?;
    let dest = dest_dir.join(name);
    if dest.exists() {
        return Ok(()); // never overwrite — leave the source in place
    }
    match std::fs::rename(&src, &dest) {
        Ok(()) => {
            *moved += 1;
            Ok(())
        }
        Err(e) => Err(format!("move {name} into {}: {e}", dest_dir.display())),
    }
}

/// Converge ANY vault to the STRICT canonical layout on load: the vault ROOT
/// holds ONLY `build/` and `data/` (plus hidden `.`-prefixed markers). `data/`
/// holds `domains/` + `apps/`; `build/` holds all support + config. This both
/// scaffolds a brand-new/empty vault and auto-converts a flat/legacy one.
///
/// SAFE by design (Hard Rule: never lose user data):
///   * every relocation is an fs::rename (a MOVE, never a copy+delete),
///   * an existing destination is SKIPPED (never overwritten); the source stays,
///   * the ONLY removal is an emptied legacy v3 container (root/domains,
///     root/apps) AFTER its children moved, and only when it is then empty,
///   * idempotent: a vault already canonical is effectively a no-op.
///
/// Convergence steps:
///   1. scaffold data/domains, data/apps, data/domains/general, build/, and the
///      `data/.prevail-data-layout` marker (so an empty vault starts canonical),
///   2. legacy root domains (a dir with soul.md / _state.md / state.md) -> data/domains/<name>,
///   3. v3 containers root/domains + root/apps -> their children into data/, then drop the emptied container,
///   4. global build-support + config files/dirs -> build/,
///   5. General-bucket loose content -> data/domains/general/,
///   6. catch-all: any remaining loose ROOT *file* (non-hidden, unhandled) -> build/.
/// Returns the number of entries moved.
#[tauri::command]
pub(crate) fn vault_migrate_layout(path: String) -> Result<u64, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("vault path does not exist: {}", path));
    }
    // (1) Canonical scaffold: apps + domains live ONLY under data/; build/ holds
    // support + config. Create them (not root-level) so loading never re-seeds a
    // stray root domains/ + apps/, and an empty/new vault still starts canonical.
    let data = root.join("data");
    let domains_root = data.join("domains");
    let apps_root = data.join("apps");
    let build_dir = root.join("build");
    let general_dir = domains_root.join("general");
    std::fs::create_dir_all(&domains_root).map_err(|e| format!("mkdir data/domains: {e}"))?;
    std::fs::create_dir_all(&apps_root).map_err(|e| format!("mkdir data/apps: {e}"))?;
    std::fs::create_dir_all(&general_dir).map_err(|e| format!("mkdir data/domains/general: {e}"))?;
    std::fs::create_dir_all(&build_dir).map_err(|e| format!("mkdir build: {e}"))?;
    // Marker so a brand-new vault is recognizably canonical even with nothing to
    // move. Hidden (`.`-prefixed) so it never counts as root content.
    let marker = data.join(".prevail-data-layout");
    if !marker.exists() {
        let _ = std::fs::write(&marker, "v4\n");
    }

    let mut moved = 0u64;

    // (2) Legacy root domains -> data/domains/<name>. Only dirs that are clearly
    // a domain (soul.md / _state.md / state.md), skip-conflict.
    let entries = match read_dir_retry(&root) {
        Ok(e) => e,
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.')
            || name.starts_with('_')
            || name == "data"
            || name == "build"
            || NON_DOMAIN_DIRS.contains(&name.as_str())
        {
            continue;
        }
        let src = entry.path();
        if !src.is_dir() {
            continue;
        }
        // Only migrate things that are actually domains.
        let is_domain = src.join("soul.md").exists()
            || src.join("_state.md").exists()
            || src.join("state.md").exists();
        if !is_domain {
            continue;
        }
        let dest = domains_root.join(&name);
        if dest.exists() {
            continue; // never overwrite an existing canonical domain
        }
        match std::fs::rename(&src, &dest) {
            Ok(()) => moved += 1,
            Err(e) => return Err(format!("move {name} into domains/: {e}")),
        }
    }

    // (3) v3 containers: move each child dir of root/domains + root/apps into the
    // canonical data/ home (skip-conflict), then remove the container if emptied.
    for (container_name, dest_parent) in [("domains", &domains_root), ("apps", &apps_root)] {
        let container = root.join(container_name);
        if !container.is_dir() {
            continue;
        }
        if let Ok(es) = read_dir_retry(&container) {
            for entry in es.flatten() {
                let cname = entry.file_name().to_string_lossy().to_string();
                if cname.starts_with('.') {
                    continue;
                }
                let csrc = entry.path();
                if !csrc.is_dir() {
                    continue; // only move child domain/app dirs
                }
                let cdest = dest_parent.join(&cname);
                if cdest.exists() {
                    continue; // never overwrite
                }
                match std::fs::rename(&csrc, &cdest) {
                    Ok(()) => moved += 1,
                    Err(e) => return Err(format!("move {container_name}/{cname} into data/: {e}")),
                }
            }
        }
        // Remove the container ONLY if it is now empty (no user content lost).
        if let Ok(mut rd) = read_dir_retry(&container) {
            if rd.next().is_none() {
                let _ = std::fs::remove_dir(&container);
            }
        }
    }

    // (4) Global build-support + config -> build/ (move root entry, file OR dir).
    const BUILD_SUPPORT: &[&str] = &[
        "_meta",
        "benchmark",
        "ideal-state.md",
        "profile.md",
        "omega.md",
        "AGENTS-operating.md",
        "PREVAIL.md",
        "calendar-external.json",
    ];
    for name in BUILD_SUPPORT {
        move_root_entry(&root, name, &build_dir, &mut moved)?;
    }

    // (5) General-bucket content -> data/domains/general/. On a flat vault the
    // General domain IS the vault root, so these loose root entries are its
    // content. Only moved when at the VAULT ROOT.
    const GENERAL_CONTENT: &[&str] = &[
        "_intents.jsonl",
        "_decisions.jsonl",
        "_surface.json",
        "_threads",
        "_log",
        "_skills",
        "_state.md",
        "_memory.md",
        "_skillgen.json",
        "_taskgen.json",
        "_tasks.md",
        "_tasks.jsonl",
        "_loops.json",
        "_loops_runtime.json",
        "open-loops.md",
        "goals.md",
        "config.md",
        "MEMORY.md",
        "soul.md",
        "QUICKSTART.md",
        "PROMPTS.md",
    ];
    for name in GENERAL_CONTENT {
        move_root_entry(&root, name, &general_dir, &mut moved)?;
    }

    // (6) Catch-all for cleanliness: any REMAINING loose FILE (not a directory)
    // at the root that is not hidden and not already handled -> build/. Unknown
    // DIRECTORIES are deliberately left in place rather than risk misplacing them.
    let entries = match read_dir_retry(&root) {
        Ok(e) => e,
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "data" || name == "build" {
            continue;
        }
        let src = entry.path();
        if src.is_dir() {
            continue; // never catch-all an unrecognized directory
        }
        move_root_entry(&root, name.as_str(), &build_dir, &mut moved)?;
    }

    Ok(moved)
}

#[tauri::command]
pub(crate) fn scan_vault(path: String) -> Result<Vec<Domain>, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("vault path does not exist: {}", path));
    }
    // Domain candidates from BOTH the legacy root layout (<vault>/<domain>) and
    // the v3 container (<vault>/domains/<domain>); v3 wins on a name clash.
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    // (name, path, from_container): from_container = a child of data/domains or
    // domains/, which is a domain by location even without a state marker.
    let mut candidates: Vec<(String, PathBuf, bool)> = Vec::new();
    let mut scan_container = |dir: &PathBuf, candidates: &mut Vec<(String, PathBuf, bool)>, seen: &mut std::collections::HashSet<String>| {
        if !dir.is_dir() {
            return;
        }
        if let Ok(es) = read_dir_retry(dir) {
            for entry in es.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                // "general" has its own dedicated top-level entry in the UI, so it
                // is not listed again among the domains.
                if name.starts_with('.') || name == "general" {
                    continue;
                }
                let p = entry.path();
                if p.is_dir() && seen.insert(name.clone()) {
                    candidates.push((name, p, true));
                }
            }
        }
    };
    // v4 canonical: <vault>/data/domains/<d> (highest priority), then v3
    // <vault>/domains/<d>. data_root() collapses to the root when no data/ dir
    // exists, so guard against scanning <vault>/domains twice.
    let v4_domains = crate::paths::data_root(&path).join("domains");
    scan_container(&v4_domains, &mut candidates, &mut seen);
    let domains_root = root.join("domains");
    if domains_root != v4_domains {
        scan_container(&domains_root, &mut candidates, &mut seen);
    }
    for entry in read_dir_retry(&root).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "general" || NON_DOMAIN_DIRS.contains(&name.as_str()) {
            continue;
        }
        let p = entry.path();
        if p.is_dir() && seen.insert(name.clone()) {
            candidates.push((name, p, false)); // legacy root: needs a marker
        }
    }

    let mut domains: Vec<Domain> = Vec::new();
    for (name, p, from_container) in candidates {
        // Domain detection. A child of the domains container IS a domain by
        // location (even a freshly-created one with no _state.md yet) so the
        // sidebar and the chat engine agree. The marker heuristic (soul.md /
        // _state.md / state.md) only gates the flat LEGACY root layout.
        let soul_path = p.join("soul.md");
        let state_v2 = p.join("_state.md"); // v2 derived snapshot
        let state_v1 = p.join("state.md"); // v1 hand-written snapshot
        let is_domain = from_container || soul_path.exists() || state_v2.exists() || state_v1.exists();
        if !is_domain {
            continue;
        }
        // "has_state" now means a usable snapshot exists (derived or legacy).
        let has_state = state_v2.exists() || state_v1.exists();
        // Preview prefers the v2 derived snapshot, falls back to v1, then to soul.
        let preview_src = if state_v2.exists() {
            state_v2
        } else if state_v1.exists() {
            state_v1
        } else {
            soul_path
        };
        let state_preview = read_to_string_retry(&preview_src)
            .ok()
            .and_then(|s| meaningful_preview(&s));
        domains.push(Domain {
            name,
            path: p.to_string_lossy().to_string(),
            has_state,
            state_preview,
        });
    }
    domains.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(domains)
}

/// Lightweight domain discovery: just the names, in BOTH the legacy (<vault>/<d>)
/// and v3 (<vault>/domains/<d>) layouts, WITHOUT reading each domain's state
/// snapshot for a preview (which scan_vault does). Used by hot paths that only
/// need the list — the cross-domain task board and the Decision Inbox poll — so
/// they don't do N state.md reads on every refresh.
pub(crate) fn list_domain_names(vault: &str) -> Vec<String> {
    let root = PathBuf::from(vault);
    if !root.exists() {
        return Vec::new();
    }
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut names: Vec<String> = Vec::new();
    let mut consider = |name: String, p: PathBuf, from_container: bool| {
        if name.starts_with('.') || name == "general" || NON_DOMAIN_DIRS.contains(&name.as_str()) {
            return;
        }
        if !p.is_dir() || !seen.insert(name.clone()) {
            return;
        }
        // A child of the domains container is a domain by location; the legacy
        // root layout still needs a marker (soul.md / _state.md / state.md).
        if from_container || p.join("soul.md").exists() || p.join("_state.md").exists() || p.join("state.md").exists() {
            names.push(name);
        }
    };
    let mut scan = |dir: &PathBuf, from_container: bool| {
        if let Ok(es) = read_dir_retry(dir) {
            for entry in es.flatten() {
                consider(entry.file_name().to_string_lossy().to_string(), entry.path(), from_container);
            }
        }
    };
    // v4 canonical (data/domains), then v3 (domains/), then legacy root.
    let v4_domains = crate::paths::data_root(vault).join("domains");
    scan(&v4_domains, true);
    let domains_root = root.join("domains");
    if domains_root != v4_domains {
        scan(&domains_root, true);
    }
    scan(&root, false);
    names.sort();
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn list_domain_names_finds_both_layouts_skips_non_domains() {
        let vault = std::env::temp_dir().join(format!("prevail-listnames-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        // v3 domain (under domains/) — this is the layout that the original board bug missed.
        let cal = vault.join("domains").join("calendar");
        fs::create_dir_all(&cal).unwrap();
        fs::write(cal.join("_state.md"), "# state").unwrap();
        // legacy domain (at root)
        let health = vault.join("health");
        fs::create_dir_all(&health).unwrap();
        fs::write(health.join("soul.md"), "# soul").unwrap();
        // a folder with no state markers — NOT a domain
        fs::create_dir_all(vault.join("random")).unwrap();
        fs::write(vault.join("random").join("note.txt"), "x").unwrap();

        let names = list_domain_names(&vault.to_string_lossy());
        assert!(names.contains(&"calendar".to_string()), "v3 domain must be found: {names:?}");
        assert!(names.contains(&"health".to_string()), "legacy domain must be found: {names:?}");
        assert!(!names.contains(&"random".to_string()), "non-domain must be skipped");
        assert!(!names.contains(&"domains".to_string()), "the v3 container itself is not a domain");
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn scan_and_list_find_v4_data_domains() {
        // Regression: a canonical v4 vault keeps domains under data/domains/<d>.
        // Both scan_vault and list_domain_names must surface them (the bug where
        // a fully-migrated vault showed no domains in the sidebar).
        let vault = std::env::temp_dir().join(format!("prevail-v4scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        let wealth = vault.join("data").join("domains").join("wealth");
        fs::create_dir_all(&wealth).unwrap();
        fs::write(wealth.join("_state.md"), "# state").unwrap();
        let health = vault.join("data").join("domains").join("health");
        fs::create_dir_all(&health).unwrap();
        fs::write(health.join("soul.md"), "# soul").unwrap();
        // a fresh vault also has build/ + PREVAIL.md at root — must not become domains.
        fs::create_dir_all(vault.join("build")).unwrap();
        fs::write(vault.join("PREVAIL.md"), "# Prevail").unwrap();

        let names = list_domain_names(&vault.to_string_lossy());
        assert!(names.contains(&"wealth".to_string()), "v4 domain must be found: {names:?}");
        assert!(names.contains(&"health".to_string()), "v4 domain must be found: {names:?}");
        let scanned = scan_vault(vault.to_string_lossy().to_string()).unwrap();
        let scanned_names: Vec<String> = scanned.iter().map(|d| d.name.clone()).collect();
        assert!(scanned_names.contains(&"wealth".to_string()), "scan_vault must find v4 domain: {scanned_names:?}");
        assert_eq!(scanned.len(), 2, "exactly the two v4 domains, not build/data: {scanned_names:?}");
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn vault_migrate_layout_moves_domains_preserves_data_skips_conflicts() {
        let vault = std::env::temp_dir().join(format!("prevail-migrate-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        let vs = vault.to_string_lossy().to_string();

        // Legacy: a real domain at the root (has _state.md) with a ledger file.
        let health = vault.join("health");
        fs::create_dir_all(&health).unwrap();
        fs::write(health.join("_state.md"), "# state").unwrap();
        fs::write(health.join("_intents.jsonl"), "{\"kind\":\"intent\"}\n").unwrap();
        // A non-domain dir at the root must NOT be moved.
        fs::create_dir_all(vault.join("random")).unwrap();
        fs::write(vault.join("random").join("note.txt"), "x").unwrap();
        // A pre-existing canonical (data/) domain that clashes by name must NOT be overwritten.
        let v4_wealth = vault.join("data").join("domains").join("wealth");
        fs::create_dir_all(&v4_wealth).unwrap();
        fs::write(v4_wealth.join("_state.md"), "KEEP ME").unwrap();
        // A legacy domain with the same name as the canonical one — should be skipped.
        let legacy_wealth = vault.join("wealth");
        fs::create_dir_all(&legacy_wealth).unwrap();
        fs::write(legacy_wealth.join("_state.md"), "legacy").unwrap();

        let moved = vault_migrate_layout(vs.clone()).unwrap();
        assert_eq!(moved, 1, "only 'health' should move");

        // health moved into data/domains/, data intact.
        assert!(vault.join("data").join("domains").join("health").join("_intents.jsonl").exists());
        assert!(!vault.join("health").exists());
        // non-domain left in place.
        assert!(vault.join("random").join("note.txt").exists());
        // canonical wealth untouched; legacy wealth left in place (conflict skipped).
        assert_eq!(fs::read_to_string(v4_wealth.join("_state.md")).unwrap(), "KEEP ME");
        assert!(vault.join("wealth").exists());
        // apps/ + domains/ now exist under data/ (not the root).
        assert!(vault.join("data").join("apps").is_dir());
        assert!(vault.join("data").join("domains").is_dir());

        // Idempotent: a second run moves nothing new.
        assert_eq!(vault_migrate_layout(vs).unwrap(), 0);

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn vault_migrate_layout_converges_flat_vault_to_canonical_no_loss() {
        // Recursively count NON-HIDDEN files (the migration adds a hidden
        // `.prevail-data-layout` marker which is not user content).
        fn count_files(dir: &std::path::Path) -> u64 {
            let mut n = 0u64;
            if let Ok(rd) = fs::read_dir(dir) {
                for e in rd.flatten() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') {
                        continue;
                    }
                    let p = e.path();
                    if p.is_dir() {
                        n += count_files(&p);
                    } else {
                        n += 1;
                    }
                }
            }
            n
        }

        let vault = std::env::temp_dir().join(format!("prevail-migrate-flat-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        let vs = vault.to_string_lossy().to_string();

        // Two flat domain dirs (each: soul.md + _state.md + data/x.json).
        for d in ["health", "career"] {
            let dom = vault.join(d);
            fs::create_dir_all(dom.join("data")).unwrap();
            fs::write(dom.join("soul.md"), "# soul").unwrap();
            fs::write(dom.join("_state.md"), "# state").unwrap();
            fs::write(dom.join("data").join("x.json"), "{}").unwrap();
        }
        // Root build-support.
        fs::create_dir_all(vault.join("_meta")).unwrap();
        fs::write(vault.join("_meta").join("usage.jsonl"), "{}\n").unwrap();
        fs::create_dir_all(vault.join("benchmark").join("questions")).unwrap();
        fs::write(vault.join("benchmark").join("questions").join("q.json"), "{}").unwrap();
        fs::write(vault.join("ideal-state.md"), "# ideal").unwrap();
        fs::write(vault.join("profile.md"), "# profile").unwrap();
        fs::write(vault.join("AGENTS-operating.md"), "# agents").unwrap();
        // General loose content.
        fs::write(vault.join("_intents.jsonl"), "{\"kind\":\"intent\"}\n").unwrap();
        fs::write(vault.join("_state.md"), "# general state").unwrap();
        fs::create_dir_all(vault.join("_threads")).unwrap();
        fs::write(vault.join("_threads").join("t.json"), "{}").unwrap();

        let before = count_files(&vault);
        let moved = vault_migrate_layout(vs.clone()).unwrap();
        assert!(moved > 0, "a flat vault must move entries, got {moved}");

        // (a) nothing lost — recursive non-hidden file count is preserved.
        let after = count_files(&vault);
        assert_eq!(after, before, "file count changed: before={before} after={after}");

        // (b) the root's non-hidden entries are exactly {build, data}.
        let mut root_entries: Vec<String> = fs::read_dir(&vault)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| !n.starts_with('.'))
            .collect();
        root_entries.sort();
        assert_eq!(root_entries, vec!["build".to_string(), "data".to_string()], "root must contain only build/ + data/");

        // (c) domains, build-support, and general content landed canonically.
        assert!(vault.join("data").join("domains").join("health").join("data").join("x.json").exists());
        assert!(vault.join("data").join("domains").join("career").join("data").join("x.json").exists());
        assert!(vault.join("build").join("_meta").join("usage.jsonl").exists());
        assert!(vault.join("build").join("benchmark").join("questions").join("q.json").exists());
        assert!(vault.join("build").join("ideal-state.md").exists());
        assert!(vault.join("build").join("profile.md").exists());
        assert!(vault.join("build").join("AGENTS-operating.md").exists());
        assert!(vault.join("data").join("domains").join("general").join("_intents.jsonl").exists());
        assert!(vault.join("data").join("domains").join("general").join("_threads").join("t.json").exists());

        // Idempotent: a second run is a no-op.
        assert_eq!(vault_migrate_layout(vs).unwrap(), 0, "second run must move nothing");

        let _ = fs::remove_dir_all(&vault);
    }
}
