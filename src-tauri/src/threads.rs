// Threads — markdown-on-disk chat threads stored under <vault>/<domain>/_threads/
// (and <vault>/_threads/ for the no-domain General space). Each thread is a
// single markdown file: YAML frontmatter (id/title/created/updated) plus the
// turn transcript. Extracted from lib.rs. Path-safety from crate::paths.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::paths::{guard_managed_path, safe_domain_subdir};
use crate::read_dir_retry;
use crate::read_to_string_retry;
use crate::secs_to_ymdhms;

#[derive(Serialize, Clone)]
pub struct ThreadMeta {
    pub path: String,
    pub slug: String,
    pub title: String,
    pub domain: Option<String>,
    pub created: u64,
    pub updated: u64,
    pub turn_count: usize,
    pub preview: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThreadTurn {
    pub role: String,
    pub cli: Option<String>,
    pub model: Option<String>,
    pub content: String,
}

#[derive(Serialize, Clone)]
pub struct ThreadFull {
    pub meta: ThreadMeta,
    pub turns: Vec<ThreadTurn>,
}

// Parse an ISO-8601 timestamp like 2026-06-05T18:30:00Z into unix secs.
// We only handle the canonical Z-suffixed form we write ourselves; if
// the value doesn't parse we return 0 so callers can fall back to mtime.
fn parse_iso8601_z(s: &str) -> u64 {
    let s = s.trim();
    if s.len() < 20 || !s.ends_with('Z') {
        return 0;
    }
    let bytes = s.as_bytes();
    let to_num = |start: usize, end: usize| -> Option<i64> {
        std::str::from_utf8(&bytes[start..end]).ok()?.parse::<i64>().ok()
    };
    let year = match to_num(0, 4) { Some(v) => v as i32, None => return 0 };
    let month = match to_num(5, 7) { Some(v) => v as u32, None => return 0 };
    let day = match to_num(8, 10) { Some(v) => v as u32, None => return 0 };
    let hh = match to_num(11, 13) { Some(v) => v as u32, None => return 0 };
    let mm = match to_num(14, 16) { Some(v) => v as u32, None => return 0 };
    let ss = match to_num(17, 19) { Some(v) => v as u32, None => return 0 };
    // Days from 1970-01-01 to year-01-01 (Gregorian).
    let mut days: i64 = 0;
    for y in 1970..year {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        days += if leap { 366 } else { 365 };
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_lens: [u32; 12] = if leap {
        [31,29,31,30,31,30,31,31,30,31,30,31]
    } else {
        [31,28,31,30,31,30,31,31,30,31,30,31]
    };
    if month < 1 || month > 12 || day < 1 { return 0; }
    for i in 0..(month as usize - 1) {
        days += month_lens[i] as i64;
    }
    days += (day - 1) as i64;
    let secs = days * 86_400 + (hh as i64) * 3600 + (mm as i64) * 60 + ss as i64;
    if secs < 0 { 0 } else { secs as u64 }
}

fn iso8601_z(secs: u64) -> String {
    let (y, mo, d, hh, mm, ss) = secs_to_ymdhms(secs as i64);
    format!("{y:04}-{mo:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

// Minimal frontmatter scanner — splits the leading `---\n…\n---\n`
// block from the body and returns (key → value) pairs plus body text.
fn split_frontmatter(raw: &str) -> (HashMap<String, String>, String) {
    let mut meta: HashMap<String, String> = HashMap::new();
    let mut lines = raw.lines();
    let first = match lines.next() {
        Some(l) => l,
        None => return (meta, String::new()),
    };
    if first.trim() != "---" {
        return (meta, raw.to_string());
    }
    let mut consumed = first.len() + 1;
    for line in lines.by_ref() {
        consumed += line.len() + 1;
        if line.trim() == "---" {
            break;
        }
        if let Some(idx) = line.find(':') {
            let key = line[..idx].trim().to_string();
            let val = line[idx + 1..].trim().to_string();
            if !key.is_empty() {
                meta.insert(key, val);
            }
        }
    }
    let body = if consumed >= raw.len() {
        String::new()
    } else {
        raw[consumed..].to_string()
    };
    (meta, body)
}

// Parse the body of a thread into ThreadTurns by splitting on `## `
// headers at the start of lines. The header tells us the role.
fn parse_thread_body(body: &str) -> Vec<ThreadTurn> {
    let mut turns: Vec<ThreadTurn> = Vec::new();
    // Normalize: split on lines that start with "## ". We walk the
    // string by lines to keep things allocation-light.
    let mut current_header: Option<String> = None;
    let mut current_content: String = String::new();
    let flush = |hdr: &Option<String>, content: &str, turns: &mut Vec<ThreadTurn>| {
        let header = match hdr {
            Some(h) => h.trim().to_string(),
            None => return,
        };
        let content = content.trim_matches('\n').to_string();
        if header.is_empty() && content.is_empty() {
            return;
        }
        if header.eq_ignore_ascii_case("You") {
            turns.push(ThreadTurn {
                role: "user".into(),
                cli: None,
                model: None,
                content,
            });
        } else {
            // Assistant header may be "<cli>" or "<cli> · <model>".
            let (cli, model) = match header.split_once(" · ") {
                Some((c, m)) => (c.trim().to_string(), Some(m.trim().to_string())),
                None => (header.clone(), None),
            };
            turns.push(ThreadTurn {
                role: "assistant".into(),
                cli: if cli.is_empty() { None } else { Some(cli) },
                model,
                content,
            });
        }
    };
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            flush(&current_header, &current_content, &mut turns);
            current_header = Some(rest.to_string());
            current_content = String::new();
        } else {
            if !current_content.is_empty() {
                current_content.push('\n');
            }
            current_content.push_str(line);
        }
    }
    flush(&current_header, &current_content, &mut turns);
    turns
}

// Build a ThreadMeta from a path + parsed frontmatter + body. Falls
// back to file mtime / slug when fields are missing.
fn thread_meta_from(
    path: &Path,
    meta: &HashMap<String, String>,
    body: &str,
    turns: &[ThreadTurn],
) -> ThreadMeta {
    let slug = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let title = meta
        .get("title")
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| slug.clone());
    let domain = meta
        .get("domain")
        .cloned()
        .filter(|s| !s.is_empty());
    let mtime_secs = fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let created = meta
        .get("created")
        .map(|s| parse_iso8601_z(s))
        .unwrap_or(0);
    let created = if created == 0 { mtime_secs } else { created };
    let updated = meta
        .get("updated")
        .map(|s| parse_iso8601_z(s))
        .unwrap_or(0);
    let updated = if updated == 0 { mtime_secs } else { updated };
    let turn_count = meta
        .get("turns")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(turns.len());
    // Preview = first 120 chars of the first user turn's content. If
    // there's no user turn (shouldn't happen, but be defensive), fall
    // back to the first non-empty body line.
    let preview = turns
        .iter()
        .find(|t| t.role == "user")
        .map(|t| t.content.clone())
        .unwrap_or_else(|| {
            body.lines()
                .find(|l| !l.trim().is_empty() && !l.starts_with("## "))
                .unwrap_or("")
                .to_string()
        });
    let preview: String = preview.chars().take(120).collect();
    ThreadMeta {
        path: path.to_string_lossy().to_string(),
        slug,
        title,
        domain,
        created,
        updated,
        turn_count,
        preview,
    }
}

#[tauri::command]
pub(crate) fn list_threads(vault: String, domain: Option<String>) -> Result<Vec<ThreadMeta>, String> {
    let threads_dir = safe_domain_subdir(&vault, &domain, "_threads")?;
    if !threads_dir.exists() {
        return Ok(vec![]);
    }
    let entries = read_dir_retry(&threads_dir).map_err(|e| e.to_string())?;
    // Collect each thread with a content-dedup key from its FIRST user message.
    // NOT the slug: threads are created as empty stubs (hash of the empty
    // string) and keep that slug after being filled, so slug-hash dedup wrongly
    // collapsed distinct threads and hid freshly-created "Untitled" threads.
    let mut rows: Vec<(ThreadMeta, Option<String>)> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let raw = match read_to_string_retry(&p) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let (fm, body) = split_frontmatter(&raw);
        let turns = parse_thread_body(&body);
        let key = turns
            .iter()
            .find(|t| t.role == "user")
            .map(|t| t.content.trim())
            .filter(|c| !c.is_empty())
            .map(|c| c.chars().take(160).collect::<String>().to_lowercase());
        rows.push((thread_meta_from(&p, &fm, &body, &turns), key));
    }
    // Dedup the dual-writer case (one conversation saved twice under slightly
    // different slugs): collapse by (domain, first-user-message), keeping the
    // most complete copy (most turns, then newest). Empty stubs (key None) are
    // NEVER deduped, so a new "+ New" thread always shows immediately.
    rows.sort_by(|a, b| b.0.turn_count.cmp(&a.0.turn_count).then(b.0.updated.cmp(&a.0.updated)));
    let mut seen: std::collections::HashSet<(Option<String>, String)> = std::collections::HashSet::new();
    rows.retain(|(m, key)| match key {
        Some(k) => seen.insert((m.domain.clone(), k.clone())),
        None => true,
    });
    let mut out: Vec<ThreadMeta> = rows.into_iter().map(|(m, _)| m).collect();
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(out)
}

#[tauri::command]
pub(crate) fn load_thread(path: String) -> Result<ThreadFull, String> {
    guard_managed_path(&path, "/_threads/", ".md")?;
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("thread not found: {path}"));
    }
    let raw = read_to_string_retry(&p).map_err(|e| e.to_string())?;
    let (fm, body) = split_frontmatter(&raw);
    let turns = parse_thread_body(&body);
    let meta = thread_meta_from(&p, &fm, &body, &turns);
    Ok(ThreadFull { meta, turns })
}

// Slug helper — strip non-alphanumeric chars, collapse to dashes.
// B3: the `slug` passed to save_thread is an EXISTING thread filename stem
// (e.g. "2026-06-16_12-30-45_a1b2c3d4"), not free text. An earlier slugify pass
// turned the underscores into dashes and produced a DIFFERENT filename, so an
// Untitled thread's next save landed in a new file and the original was
// orphaned. Preserve the existing stem verbatim, only mapping out anything
// path-unsafe so traversal/separators can't sneak in.
fn sanitize_existing_slug(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

// Tiny stable hash for slug generation — FNV-1a 32-bit. We only need
// determinism + low collision rate, not cryptographic strength.
fn fnv1a32(data: &[u8]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for b in data {
        h ^= *b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

#[tauri::command]
pub(crate) fn save_thread(
    vault: String,
    domain: Option<String>,
    slug: Option<String>,
    title: String,
    turns: Vec<ThreadTurn>,
) -> Result<String, String> {
    // Allow empty turns so the UI can pre-create a thread file when
    // the user clicks "+ New thread" — they want the entry to appear
    // in the rail immediately and be renameable BEFORE typing the
    // first prompt. Subsequent auto-saves overwrite with real turns.
    let threads_dir = safe_domain_subdir(&vault, &domain, "_threads")?;
    fs::create_dir_all(&threads_dir).map_err(|e| format!("mkdir _threads: {e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (year, month, day, hh, mm, ss) = secs_to_ymdhms(now as i64);
    let stamp = format!("{year:04}-{month:02}-{day:02}_{hh:02}-{mm:02}-{ss:02}");

    let final_slug = match slug.as_ref().map(|s| sanitize_existing_slug(s)).filter(|s| !s.is_empty()) {
        Some(s) => s,
        None => {
            let first_user = turns
                .iter()
                .find(|t| t.role == "user")
                .map(|t| t.content.as_str())
                .unwrap_or("");
            let hash = fnv1a32(first_user.as_bytes());
            let hash_suffix = format!("{hash:08x}");
            // Dedup safety net: the frontend autosave can fire two
            // slug=null saves seconds apart for the SAME new conversation
            // (e.g. once when the prompt is sent, once when the reply
            // lands). Each previously produced a distinct
            // `<timestamp>_<hash>.md`, so the thread appeared twice. If a
            // thread with this same first-message hash was created very
            // recently, reuse it instead of creating a duplicate.
            let mut reuse: Option<String> = None;
            if !first_user.is_empty() {
                if let Ok(rd) = fs::read_dir(&threads_dir) {
                    let mut best: Option<(u64, String)> = None;
                    for e in rd.flatten() {
                        let p = e.path();
                        if p.extension().and_then(|x| x.to_str()) != Some("md") {
                            continue;
                        }
                        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                        if !stem.ends_with(&hash_suffix) {
                            continue;
                        }
                        let created = read_to_string_retry(&p)
                            .ok()
                            .and_then(|raw| {
                                split_frontmatter(&raw)
                                    .0
                                    .get("created")
                                    .map(|s| parse_iso8601_z(s))
                            })
                            .unwrap_or(0);
                        // Only merge into a thread created in the last 10
                        // minutes, so genuinely separate conversations that
                        // happen to share a first message stay distinct.
                        if created != 0 && now.saturating_sub(created) < 600 {
                            if best.as_ref().map(|(c, _)| created > *c).unwrap_or(true) {
                                best = Some((created, stem.to_string()));
                            }
                        }
                    }
                    reuse = best.map(|(_, s)| s);
                }
            }
            reuse.unwrap_or_else(|| format!("{stamp}_{hash_suffix}"))
        }
    };

    let file_path = threads_dir.join(format!("{final_slug}.md"));

    // Preserve existing `created` timestamp + title if the file is
    // being overwritten with a known slug; otherwise stamp it now.
    // The title preservation is what stops auto-save from clobbering
    // a user's manual rename — the frontend always sends a freshly
    // derived title from the first user message, but if the file
    // already exists with a different title, the user's choice wins.
    let (created_secs, preserved_title) = if file_path.exists() {
        let fm = read_to_string_retry(&file_path)
            .ok()
            .map(|raw| split_frontmatter(&raw).0);
        let created = fm
            .as_ref()
            .and_then(|m| m.get("created").map(|s| parse_iso8601_z(s)))
            .filter(|v| *v != 0)
            .unwrap_or(now);
        let existing_title = fm.and_then(|m| m.get("title").cloned()).unwrap_or_default();
        (created, existing_title)
    } else {
        (now, String::new())
    };

    // If the on-disk file has a title and it's different from what
    // the caller derived, treat the on-disk one as canonical so
    // renames stick across auto-saves. Exception: the placeholder
    // "Untitled" written by the "+ new thread" handler — we WANT
    // the incoming title (first user message) to replace it.
    let final_title = if !preserved_title.is_empty()
        && preserved_title != title
        && preserved_title != "Untitled"
    {
        preserved_title
    } else {
        title
    };

    let mut body = String::new();
    body.push_str("---\n");
    body.push_str(&format!("title: {}\n", final_title));
    body.push_str(&format!(
        "domain: {}\n",
        domain.as_deref().unwrap_or("")
    ));
    body.push_str(&format!("created: {}\n", iso8601_z(created_secs)));
    body.push_str(&format!("updated: {}\n", iso8601_z(now)));
    body.push_str(&format!("turns: {}\n", turns.len()));
    body.push_str("---\n\n");
    for t in &turns {
        let speaker = if t.role == "user" {
            "You".to_string()
        } else {
            let cli = t.cli.as_deref().unwrap_or("assistant");
            let model = t
                .model
                .as_deref()
                .map(|m| format!(" · {m}"))
                .unwrap_or_default();
            format!("{cli}{model}")
        };
        body.push_str(&format!("## {speaker}\n\n{}\n\n", t.content.trim()));
    }
    fs::write(&file_path, &body).map_err(|e| format!("write thread: {e}"))?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn rename_thread(path: String, new_title: String) -> Result<(), String> {
    guard_managed_path(&path, "/_threads/", ".md")?;
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("thread not found: {path}"));
    }
    let raw = read_to_string_retry(&p).map_err(|e| e.to_string())?;
    // Walk the leading frontmatter block, replacing the `title:` line.
    // If there's no frontmatter, prepend a minimal one.
    let mut out = String::with_capacity(raw.len() + 32);
    let mut lines = raw.lines();
    let first = lines.next();
    match first {
        Some(l) if l.trim() == "---" => {
            out.push_str("---\n");
            let mut title_written = false;
            for line in lines.by_ref() {
                if line.trim() == "---" {
                    if !title_written {
                        out.push_str(&format!("title: {new_title}\n"));
                    }
                    out.push_str("---\n");
                    break;
                }
                if line.trim_start().starts_with("title:") && !title_written {
                    out.push_str(&format!("title: {new_title}\n"));
                    title_written = true;
                } else {
                    out.push_str(line);
                    out.push('\n');
                }
            }
            // Append the remaining body verbatim.
            let rest: Vec<&str> = lines.collect();
            if !rest.is_empty() {
                out.push_str(&rest.join("\n"));
                if raw.ends_with('\n') {
                    out.push('\n');
                }
            } else if raw.ends_with('\n') && !out.ends_with('\n') {
                out.push('\n');
            }
        }
        Some(_) | None => {
            // No frontmatter — synthesize a minimal one and prepend.
            out.push_str("---\n");
            out.push_str(&format!("title: {new_title}\n"));
            out.push_str("---\n\n");
            out.push_str(&raw);
        }
    }
    fs::write(&p, out).map_err(|e| format!("write thread: {e}"))
}

#[tauri::command]
pub(crate) fn delete_thread(path: String) -> Result<(), String> {
    guard_managed_path(&path, "/_threads/", ".md")?;
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("thread not found: {path}"));
    }
    fs::remove_file(&p).map_err(|e| format!("delete thread: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // B3: an existing thread stem must survive verbatim so save_thread reuses the
    // same file instead of forking a new one. Underscores in particular were the
    // bug — the old slugify turned them into dashes.
    #[test]
    fn sanitize_preserves_existing_stem() {
        let stem = "2026-06-16_12-30-45_a1b2c3d4";
        assert_eq!(sanitize_existing_slug(stem), stem);
    }

    #[test]
    fn sanitize_strips_path_unsafe_chars() {
        // No traversal or separators can survive into a filename.
        assert!(!sanitize_existing_slug("../../etc/passwd").contains('/'));
        assert!(!sanitize_existing_slug("a/b\\c").contains('/'));
        assert!(!sanitize_existing_slug("a/b\\c").contains('\\'));
        // Leading/trailing separators trimmed; interior word chars kept.
        assert_eq!(sanitize_existing_slug("--foo_bar--"), "foo_bar");
    }
}
