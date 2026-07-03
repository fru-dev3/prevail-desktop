// Domain workspace — the context bundle the UI loads when entering a domain
// (state.md, decisions, journal, recent logs, skills), the domain file tree,
// and the skills it owns (list + create). Extracted from lib.rs. Path-safety
// from crate::paths; read helpers from the crate root.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::paths::{data_root, domain_dir, domain_dir_pub};
use crate::read_dir_retry;
use crate::read_to_string_retry;
use crate::secs_to_ymdhms;

// List skill folders detected for a given vault. Returns a flat list
// where each entry has its parent domain inferred from the path.
#[derive(Serialize, Clone)]
pub struct SkillEntry {
    pub domain: String,
    pub name: String,
    pub path: String,
    pub description: Option<String>,
}

// Skip leading YAML frontmatter + heading lines, then return the first
// meaningful prose line as the skill description. Frontmatter is a
// block bounded by `---` lines at the very start of the file.
fn extract_skill_description(body: &str) -> Option<String> {
    let mut lines = body.lines().peekable();
    // Detect and consume frontmatter only if it starts on line 1.
    if let Some(first) = lines.peek() {
        if first.trim() == "---" {
            lines.next();
            while let Some(l) = lines.next() {
                if l.trim() == "---" { break; }
                // Also pull "description: …" out of YAML if present.
                let lt = l.trim();
                if let Some(rest) = lt.strip_prefix("description:") {
                    let val = rest.trim().trim_matches('"').trim();
                    // YAML block scalar (`description: >` or `|`) — the text is on
                    // the following indented lines; grab the first non-empty one.
                    if val == ">" || val == "|" || val.is_empty() {
                        if let Some(next) = lines.next() {
                            let n = next.trim();
                            if !n.is_empty() && n != "---" {
                                return Some(n.chars().take(140).collect());
                            }
                        }
                    } else {
                        return Some(val.chars().take(140).collect());
                    }
                }
            }
        }
    }
    for l in lines {
        let t = l.trim();
        if t.is_empty() { continue; }
        if t.starts_with('#') { continue; }
        if t.starts_with("```") { continue; }
        // Strip any leading markdown markers (`-`, `*`, `>`, etc.)
        // so the description reads like prose.
        let cleaned = t
            .trim_start_matches(|c: char| c == '-' || c == '*' || c == '>' || c == ' ')
            .trim();
        if cleaned.len() < 3 { continue; }
        return Some(cleaned.chars().take(140).collect());
    }
    None
}

// Domain context bundle — everything the user (and the AI) might want
// to load when entering a domain: state.md, decisions.md, _journal.md
// (or _journal/), recent _log/ entries, and skills.
#[derive(Serialize, Clone)]
pub struct DomainLogEntry {
    pub name: String,
    pub path: String,
    pub mtime_secs: u64,
    pub preview: String,
}
#[derive(Serialize, Clone)]
pub struct DomainContext {
    pub state: Option<String>,
    pub decisions: Option<String>,
    pub journal: Option<String>,
    pub recent_logs: Vec<DomainLogEntry>,
    pub skills: Vec<SkillEntry>,
}

/// Read a domain's starter prompts from `<vault>/<domain>/PROMPTS.md` (written
/// by pack import). Returns the bullet-list entries so the chat empty-state can
/// offer one-click conversation starters. Empty vec if the file is absent.
#[tauri::command]
pub(crate) fn read_domain_prompts(vault: String, domain: String) -> Result<Vec<String>, String> {
    let p = PathBuf::from(&vault).join(&domain).join("PROMPTS.md");
    let body = match read_to_string_retry(&p) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };
    let prompts: Vec<String> = body
        .lines()
        .filter_map(|l| {
            let t = l.trim_start();
            t.strip_prefix("- ").or_else(|| t.strip_prefix("* "))
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    Ok(prompts)
}

/// Flat file listing of a domain folder (relative paths + sizes, capped), so
/// "attach the whole folder" can hand the model a map of what it may read.
#[tauri::command]
pub(crate) fn domain_tree(vault: String, domain: String) -> Result<serde_json::Value, String> {
    // B2-27: resolve via the v4-aware path (data/domains/<d>, then v3, then flat)
    // so a migrated vault still finds its domains.
    let root = domain_dir_pub(&vault, &domain);
    if !root.exists() {
        return Err(format!("domain not found: {}", root.display()));
    }
    fn walk(dir: &Path, root: &Path, files: &mut Vec<String>, depth: usize) {
        if depth > 4 || files.len() >= 200 {
            return;
        }
        let Ok(it) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = it.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            if files.len() >= 200 {
                return;
            }
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            if p.is_dir() {
                walk(&p, root, files, depth + 1);
            } else {
                let kb = e.metadata().map(|m| (m.len() as f64 / 1024.0).max(0.1)).unwrap_or(0.0);
                let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().to_string();
                files.push(format!("{rel} ({kb:.1} KB)"));
            }
        }
    }
    let mut files: Vec<String> = Vec::new();
    walk(&root, &root, &mut files, 0);
    Ok(serde_json::json!({ "root": root.to_string_lossy(), "files": files }))
}

#[tauri::command]
pub(crate) fn domain_context(vault: String, domain: String) -> Result<DomainContext, String> {
    // B2-27: v4-aware resolution (data/domains/<d>, v3, then flat) so a migrated
    // vault's context panel still loads instead of "domain not found".
    let root = domain_dir_pub(&vault, &domain);
    if !root.exists() {
        return Err(format!("domain not found: {}", root.display()));
    }
    // General's SUPPORTING files (journal, decisions ledger) may live in build/
    // (the engine writes there once a vault is tidied), while older copies remain
    // at the root. Read both and merge so nothing silently disappears.
    let extra_base: Option<PathBuf> = if domain.trim().is_empty() {
        let b = crate::paths::build_root(&vault);
        if b != root { Some(b) } else { None }
    } else { None };
    // The file-reading body is shared with `app_context` (apps are domains with a
    // little more), so it lives in `context_for_root`. `domain_label` is used only
    // to tag the domain on each scanned skill, exactly as before.
    context_for_root(root, extra_base, &domain)
}

/// Build a DomainContext from a content root: the state/decisions/journal/recent
/// logs/skills bundle the UI loads. Shared by `domain_context` (domains) and
/// `app_context` (apps under data/apps/<id>) so both expose the same rich view.
/// `extra_base` is an optional second base (build/) to merge journal + decisions
/// from; `domain_label` tags each scanned skill with its owning domain/app id.
fn context_for_root(root: PathBuf, extra_base: Option<PathBuf>, domain_label: &str) -> Result<DomainContext, String> {
    let read = |p: PathBuf| -> Option<String> {
        if !p.exists() { return None; }
        read_to_string_retry(&p).ok()
    };
    // v2 layout first (_state.md, written by the distill daemon), v1 fallback
    // (state.md). The panel showed "no state.md found" forever because it only
    // knew the v1 name while everything else wrote v2.
    let state = read(root.join("_state.md")).or_else(|| read(root.join("state.md")));
    // Curated decisions: the journal distiller's file when present, else the
    // v1 root file, else the full _decisions.jsonl ledger rendered readable
    // (the same ledger "Recent decisions" tails, but complete).
    let decisions = read(root.join("_journal").join("decisions.md"))
        .or_else(|| read(root.join("decisions.md")))
        .or_else(|| {
            let ledger = read(root.join("_decisions.jsonl"))
                .or_else(|| extra_base.as_ref().and_then(|b| read(b.join("_decisions.jsonl"))))?;
            let lines: Vec<String> = ledger
                .lines()
                .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
                .map(|v| {
                    let txt = ["decision", "verdict", "text", "prompt"]
                        .iter()
                        .find_map(|k| v.get(k).and_then(|x| x.as_str()).map(str::to_string))
                        .unwrap_or_default();
                    let kind = v.get("kind").and_then(|x| x.as_str()).unwrap_or("decision");
                    let day = v
                        .get("ts")
                        .and_then(|x| x.as_i64())
                        .map(|ms| {
                            let (y, mo, d, _, _, _) = secs_to_ymdhms(ms / 1000);
                            format!("{y:04}-{mo:02}-{d:02}")
                        })
                        .unwrap_or_default();
                    format!("- {}{}{}", if day.is_empty() { String::new() } else { format!("{day} · ") }, format!("{kind}: "), txt)
                })
                .filter(|l| l.len() > 4)
                .collect();
            if lines.is_empty() { None } else { Some(lines.join("\n")) }
        });
    // Journal can live as a single _journal.md or a _journal/ folder of dated
    // entries. For General it may exist at BOTH the root and build/ (after a tidy),
    // so read every base and merge. Strip duplicate "# Journal" headers on join.
    let read_journal_at = |base: &PathBuf| -> Option<String> {
        if let Some(j) = read(base.join("_journal.md")) { return Some(j); }
        let dir = base.join("_journal");
        if !dir.is_dir() { return None; }
        let mut entries: Vec<(String, PathBuf)> = match read_dir_retry(&dir) {
            Ok(it) => it
                .flatten()
                .map(|e| (e.file_name().to_string_lossy().to_string(), e.path()))
                .filter(|(n, _)| n.ends_with(".md"))
                .collect(),
            Err(_) => return None,
        };
        entries.sort_by(|a, b| b.0.cmp(&a.0));
        let bodies: Vec<String> = entries
            .into_iter()
            .filter_map(|(_, p)| read_to_string_retry(&p).ok())
            .collect();
        if bodies.is_empty() { None } else { Some(bodies.join("\n\n---\n\n")) }
    };
    let journal = {
        let mut parts: Vec<String> = Vec::new();
        for base in std::iter::once(&root).chain(extra_base.iter()) {
            if let Some(j) = read_journal_at(base) {
                let cleaned = j.trim_start_matches("# Journal").trim().to_string();
                if !cleaned.is_empty() && !parts.iter().any(|p| p == &cleaned) { parts.push(cleaned); }
            }
        }
        if parts.is_empty() { None } else { Some(format!("# Journal\n\n{}", parts.join("\n"))) }
    };

    // Recent logs — newest 10 .md files from _log/ (sorted by mtime).
    let log_dir = root.join("_log");
    let mut recent_logs: Vec<DomainLogEntry> = Vec::new();
    if log_dir.is_dir() {
        if let Ok(it) = read_dir_retry(&log_dir) {
            let mut all: Vec<(PathBuf, u64)> = it
                .flatten()
                .filter_map(|e| {
                    let p = e.path();
                    if p.extension().and_then(|s| s.to_str()) != Some("md") { return None; }
                    let mtime = e.metadata().ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    Some((p, mtime))
                })
                .collect();
            all.sort_by(|a, b| b.1.cmp(&a.1));
            for (p, mtime) in all.into_iter().take(10) {
                let preview = read_to_string_retry(&p)
                    .ok()
                    .map(|s| s.lines().take(2).collect::<Vec<_>>().join(" · "))
                    .unwrap_or_default()
                    .chars().take(120).collect();
                recent_logs.push(DomainLogEntry {
                    name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                    path: p.to_string_lossy().to_string(),
                    mtime_secs: mtime,
                    preview,
                });
            }
        }
    }

    // Skills — scan BOTH on-disk conventions: `_skills/` (bundled sample vault,
    // the engine's heartbeat writer, and the desktop's skill_create) and
    // `skills/` (CLI daemon distill/scaffold). Reading only `_skills/` before
    // made any CLI-generated skill invisible in the domain's Skills tab.
    let mut skills: Vec<SkillEntry> = Vec::new();
    for sub in &["_skills", "skills"] {
        let skills_dir = root.join(sub);
        if !skills_dir.is_dir() { continue; }
        let Ok(it) = read_dir_retry(&skills_dir) else { continue };
        for entry in it.flatten() {
            let p = entry.path();
            if !p.is_dir() { continue; }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }
            // Same-named skill in both dirs: keep the first (from `_skills/`).
            if skills.iter().any(|s| s.name == name) { continue; }
            let mut description: Option<String> = None;
            for candidate in &["SKILL.md", "README.md", "skill.md"] {
                let f = p.join(candidate);
                if let Ok(s) = read_to_string_retry(&f) {
                    if let Some(desc) = extract_skill_description(&s) {
                        description = Some(desc);
                        break;
                    }
                }
            }
            skills.push(SkillEntry {
                domain: domain_label.to_string(),
                name,
                path: p.to_string_lossy().to_string(),
                description,
            });
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(DomainContext { state, decisions, journal, recent_logs, skills })
}

/// App/domain parity: an app is a domain with a little more, so it owns the same
/// rich context (journal, state, decisions, recent logs, skills). Apps live under
/// the content root's `apps/<app_id>` (v4: `<vault>/data/apps/<id>`, legacy:
/// `<vault>/apps/<id>`). A freshly-connected app may have no dir yet, so a missing
/// dir returns an EMPTY-but-valid context rather than an error.
#[tauri::command]
pub(crate) fn app_context(vault: String, app_id: String) -> Result<DomainContext, String> {
    // Guard the id against traversal before joining it into a path. App ids are
    // slugified ([a-z0-9-_]); anything else (incl. a "../" attempt) yields an
    // empty context rather than escaping the vault.
    let safe = !app_id.is_empty()
        && app_id.len() <= 64
        && !app_id.starts_with('.')
        && app_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let empty = DomainContext {
        state: None,
        decisions: None,
        journal: None,
        recent_logs: Vec::new(),
        skills: Vec::new(),
    };
    if !safe {
        return Ok(empty);
    }
    // v4 content root (<vault>/data when it exists, else <vault>) → apps/<id>,
    // with a legacy <vault>/apps/<id> fallback if the data/ form is absent.
    let v4 = data_root(&vault).join("apps").join(&app_id);
    let app_dir = if v4.exists() {
        v4
    } else {
        let legacy = PathBuf::from(&vault).join("apps").join(&app_id);
        if legacy.exists() { legacy } else { v4 }
    };
    if !app_dir.exists() {
        return Ok(empty);
    }
    context_for_root(app_dir, None, &app_id)
}

#[tauri::command]
pub(crate) fn scan_skills(vault: String) -> Result<Vec<SkillEntry>, String> {
    let root = PathBuf::from(&vault);
    if !root.exists() {
        return Ok(vec![]);
    }
    // Enumerate domain dirs the SAME way scan_vault does: the v4 container
    // (data/domains), then the v3 container (domains/), then the legacy flat
    // root. Previously this read only the flat root, so in a v4 vault (domains
    // live under data/domains) it found no domains and /skills was always empty.
    let mut domain_dirs: Vec<(String, PathBuf)> = Vec::new();
    let mut seen_domains: std::collections::HashSet<String> = std::collections::HashSet::new();
    let v4_domains = crate::paths::data_root(&vault).join("domains");
    let v3_domains = root.join("domains");
    let mut containers: Vec<PathBuf> = vec![v4_domains.clone()];
    if v3_domains != v4_domains {
        containers.push(v3_domains);
    }
    containers.push(root.clone()); // legacy flat: domains directly under the vault
    for container in &containers {
        let Ok(entries) = fs::read_dir(container) else { continue };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || crate::NON_DOMAIN_DIRS.contains(&name.as_str()) {
                continue;
            }
            if seen_domains.insert(name.clone()) {
                domain_dirs.push((name, p));
            }
        }
    }

    let mut out: Vec<SkillEntry> = Vec::new();
    for (domain_name, domain_path) in domain_dirs {
        // Read BOTH skill-dir conventions: `_skills/` (bundled packs + the
        // desktop's skill_create) and `skills/` (CLI daemon distill/scaffold).
        // Before, only `_skills/` was read, so any skill the CLI generated into
        // `skills/` never appeared in the Skills tab or /skills autocomplete.
        for sub in &["_skills", "skills"] {
            let skills_dir = domain_path.join(sub);
            if !skills_dir.is_dir() {
                continue;
            }
            let Ok(skills) = fs::read_dir(&skills_dir) else { continue };
            for skill in skills.flatten() {
                let p = skill.path();
                if !p.is_dir() {
                    continue;
                }
                let name = skill.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                // A skill of the same name in both dirs: keep the first (from
                // `_skills/`) so it isn't listed twice.
                if out.iter().any(|s| s.domain == domain_name && s.name == name) {
                    continue;
                }
                // Try to read a SKILL.md or README.md for a one-line description.
                // Use the frontmatter-aware extractor so a YAML `---` block (the
                // sample-vault skill format) isn't mistaken for the description.
                let mut description: Option<String> = None;
                for candidate in &["SKILL.md", "README.md", "skill.md"] {
                    let f = p.join(candidate);
                    if let Ok(s) = read_to_string_retry(&f) {
                        if let Some(desc) = extract_skill_description(&s) {
                            description = Some(desc);
                            break;
                        }
                    }
                }
                out.push(SkillEntry {
                    domain: domain_name.clone(),
                    name,
                    path: p.to_string_lossy().to_string(),
                    description,
                });
            }
        }
    }
    out.sort_by(|a, b| a.domain.cmp(&b.domain).then(a.name.cmp(&b.name)));
    Ok(out)
}

/// I7: create a reusable skill from the UI (e.g. "save this prompt as a skill").
/// Writes `<vault>/<domain>/_skills/<slug>/SKILL.md` with `runner: llm` frontmatter
/// and the supplied body as the prompt. Returns the file path. The slug is
/// sanitized to `[a-z0-9-]` which also makes path-traversal impossible.
#[tauri::command]
pub(crate) fn skill_create(
    vault: String,
    domain: Option<String>,
    name: String,
    body: String,
) -> Result<String, String> {
    // Sanitize → lowercase kebab slug; collapse runs of dashes; trim ends.
    let mut slug = String::new();
    let mut prev_dash = false;
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
            prev_dash = false;
        } else if !prev_dash {
            slug.push('-');
            prev_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        return Err("skill name must contain letters or numbers".into());
    }
    let title = name.trim();
    if body.trim().is_empty() {
        return Err("skill body is empty".into());
    }
    let dir = domain_dir(&vault, &domain).join("_skills").join(&slug);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir skill: {e}"))?;
    let file = dir.join("SKILL.md");
    let content = format!(
        "---\nid: {slug}\nrunner: llm\ntrigger: on-demand\n---\n\n# {title}\n\n{}\n",
        body.trim(),
    );
    fs::write(&file, content).map_err(|e| format!("write SKILL.md: {e}"))?;
    Ok(file.to_string_lossy().to_string())
}
