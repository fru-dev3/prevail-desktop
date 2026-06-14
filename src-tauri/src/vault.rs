// Vault scanning — discover the domain folders under a vault and summarize each
// for the sidebar. The cross-cutting read helpers (read_to_string_retry,
// read_dir_retry) and NON_DOMAIN_DIRS stay in lib.rs (used everywhere);
// this module is just the Domain shape + the scan command. Extracted from lib.rs.

use std::path::PathBuf;

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

/// Migrate a legacy vault (domains directly under the root) to the v3 layout
/// where `domains/` and `apps/` are siblings inside the vault. SAFE by design
/// (Hard Rule: never lose user data):
///   * only moves dirs that are clearly a domain (soul.md / _state.md / state.md),
///   * uses fs::rename (a move, never a copy+delete),
///   * SKIPS any name that already exists under domains/ (never overwrites),
///   * idempotent: a vault already in v3 (no legacy domains) is a no-op.
/// Returns the number of domains moved. Always ensures domains/ + apps/ exist.
#[tauri::command]
pub(crate) fn vault_migrate_layout(path: String) -> Result<u64, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("vault path does not exist: {}", path));
    }
    let domains_root = root.join("domains");
    std::fs::create_dir_all(&domains_root).map_err(|e| format!("mkdir domains: {e}"))?;
    std::fs::create_dir_all(root.join("apps")).map_err(|e| format!("mkdir apps: {e}"))?;

    let mut moved = 0u64;
    let entries = match read_dir_retry(&root) {
        Ok(e) => e,
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.starts_with('_') || NON_DOMAIN_DIRS.contains(&name.as_str()) {
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
            continue; // never overwrite an existing v3 domain
        }
        match std::fs::rename(&src, &dest) {
            Ok(()) => moved += 1,
            Err(e) => return Err(format!("move {name} into domains/: {e}")),
        }
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
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    let domains_root = root.join("domains");
    if domains_root.is_dir() {
        if let Ok(es) = read_dir_retry(&domains_root) {
            for entry in es.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let p = entry.path();
                if p.is_dir() && seen.insert(name.clone()) {
                    candidates.push((name, p));
                }
            }
        }
    }
    for entry in read_dir_retry(&root).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || NON_DOMAIN_DIRS.contains(&name.as_str()) {
            continue;
        }
        let p = entry.path();
        if p.is_dir() && seen.insert(name.clone()) {
            candidates.push((name, p));
        }
    }

    let mut domains: Vec<Domain> = Vec::new();
    for (name, p) in candidates {
        // Domain detection — forward + backward compatible across the v1→v2
        // migration. v2: a folder is a domain because the human declared intent
        // (`soul.md`). v1: detected by hand-written `state.md`. Transition: the
        // agent's derived `_state.md`. Any of the three makes it a domain.
        let soul_path = p.join("soul.md");
        let state_v2 = p.join("_state.md"); // v2 derived snapshot
        let state_v1 = p.join("state.md"); // v1 hand-written snapshot
        let is_domain = soul_path.exists() || state_v2.exists() || state_v1.exists();
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
        // A pre-existing v3 domain that clashes by name must NOT be overwritten.
        let v3_wealth = vault.join("domains").join("wealth");
        fs::create_dir_all(&v3_wealth).unwrap();
        fs::write(v3_wealth.join("_state.md"), "KEEP ME").unwrap();
        // A legacy domain with the same name as the v3 one — should be skipped.
        let legacy_wealth = vault.join("wealth");
        fs::create_dir_all(&legacy_wealth).unwrap();
        fs::write(legacy_wealth.join("_state.md"), "legacy").unwrap();

        let moved = vault_migrate_layout(vs.clone()).unwrap();
        assert_eq!(moved, 1, "only 'health' should move");

        // health moved into domains/, data intact.
        assert!(vault.join("domains").join("health").join("_intents.jsonl").exists());
        assert!(!vault.join("health").exists());
        // non-domain left in place.
        assert!(vault.join("random").join("note.txt").exists());
        // v3 wealth untouched; legacy wealth left in place (conflict skipped).
        assert_eq!(fs::read_to_string(v3_wealth.join("_state.md")).unwrap(), "KEEP ME");
        assert!(vault.join("wealth").exists());
        // apps/ + domains/ now exist as siblings.
        assert!(vault.join("apps").is_dir());
        assert!(vault.join("domains").is_dir());

        // Idempotent: a second run moves nothing new.
        assert_eq!(vault_migrate_layout(vs).unwrap(), 0);

        let _ = fs::remove_dir_all(&vault);
    }
}
