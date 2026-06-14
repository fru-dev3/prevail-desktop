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

#[tauri::command]
pub(crate) fn scan_vault(path: String) -> Result<Vec<Domain>, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("vault path does not exist: {}", path));
    }
    let entries = read_dir_retry(&root).map_err(|e| e.to_string())?;
    let mut domains: Vec<Domain> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || NON_DOMAIN_DIRS.contains(&name.as_str()) {
            continue;
        }
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
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
