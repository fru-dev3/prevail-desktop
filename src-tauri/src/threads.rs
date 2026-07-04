// Threads — markdown-on-disk chat threads stored under <vault>/<domain>/_threads/
// (and <vault>/_threads/ for the no-domain General space). Each thread is a
// single markdown file: YAML frontmatter (id/title/created/updated) plus the
// turn transcript. Extracted from lib.rs. Path-safety from crate::paths.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::paths::{guard_managed_path, safe_domain_subdir, thread_search_dirs};
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
    // The model that last answered in this thread (for the rail icon). Taken
    // from the most recent turn that recorded a CLI.
    pub cli: Option<String>,
    pub model: Option<String>,
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

// True when a "## " header line is a real turn delimiter (what the serializer
// writes) and not a markdown section header inside an assistant message. The
// serializer emits "## You" or "## <cli>[ · <model>]" where <cli> is a
// lowercase, space-free identifier; content headers ("## The math", "## Council
// Verdict: ...") are Title Case / contain spaces and must be left as content.
fn is_turn_header(header: &str) -> bool {
    let h = header.trim();
    if h.eq_ignore_ascii_case("You") {
        return true;
    }
    let cli = h.split(" · ").next().unwrap_or(h).trim();
    !cli.is_empty()
        && cli == cli.to_lowercase()
        && cli
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
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
        // A "## " line is a TURN delimiter only when it matches the shape the
        // serializer writes: "You", or "<cli>" / "<cli> · <model>" where <cli> is
        // a lowercase, space-free token (claude, codex, antigravity, ...).
        // Assistant content legitimately contains its own "## Section" markdown
        // headers (e.g. a council verdict starts with "## Council Verdict: ..."),
        // which must NOT fragment the turn - that was duplicating the verdict.
        if let Some(rest) = line.strip_prefix("## ").filter(|r| is_turn_header(r)) {
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
    // Last model to answer: walk turns from the end for the first recorded CLI.
    let last_with_cli = turns.iter().rev().find(|t| t.cli.is_some());
    let cli = last_with_cli.and_then(|t| t.cli.clone());
    let model = last_with_cli.and_then(|t| t.model.clone());
    ThreadMeta {
        path: path.to_string_lossy().to_string(),
        slug,
        title,
        domain,
        created,
        updated,
        turn_count,
        preview,
        cli,
        model,
    }
}

// A thread's turn "signature" for prefix comparison: role + trimmed content per
// turn. Two on-disk files are the SAME conversation (one a shorter save of the
// other) iff one's signature is a prefix of the other's. This is the ONLY thing
// we ever collapse in the list - never a mere shared first message, which two
// genuinely distinct conversations legitimately have.
fn turn_signature(turns: &[ThreadTurn]) -> Vec<(String, String)> {
    turns
        .iter()
        .map(|t| (t.role.clone(), t.content.trim().to_string()))
        .collect()
}

// True when `short` is a prefix of `long` (equal length counts). Used to detect
// a shorter duplicate save of the same conversation so it can be hidden WITHOUT
// hiding a distinct conversation that merely shares an opener.
fn is_prefix_of(short: &[(String, String)], long: &[(String, String)]) -> bool {
    short.len() <= long.len() && short.iter().zip(long.iter()).all(|(a, b)| a == b)
}

#[tauri::command]
pub(crate) fn list_threads(vault: String, domain: Option<String>) -> Result<Vec<ThreadMeta>, String> {
    // Read from EVERY directory a thread may live in (v4 memory/threads AND the
    // legacy _threads), so a thread is never hidden by the v4 remap split. A
    // file present in both (the v4 migrator COPIES) collapses via prefix-dedup
    // below, so the merge never double-lists it.
    let dirs = thread_search_dirs(&vault, &domain)?;
    let mut rows: Vec<(ThreadMeta, Vec<(String, String)>)> = Vec::new();
    let mut seen_paths: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    for threads_dir in &dirs {
        if !threads_dir.exists() {
            continue;
        }
        let entries = match read_dir_retry(threads_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            // Skip macOS AppleDouble sidecars (._file) and any hidden dotfile.
            // On network / exFAT mounts macOS drops a ._<thread>.md next to every
            // thread; listing one and using its stem as a session id yields
            // "invalid session id" and blocks follow-up turns. Real thread files
            // never start with a dot.
            if entry.file_name().to_str().map(|n| n.starts_with('.')).unwrap_or(true) {
                continue;
            }
            if p.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            // Same physical file reached via two dir entries (e.g. a symlink) -
            // count it once.
            let canon = p.canonicalize().unwrap_or_else(|_| p.clone());
            if !seen_paths.insert(canon) {
                continue;
            }
            let raw = match read_to_string_retry(&p) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let (fm, body) = split_frontmatter(&raw);
            let turns = parse_thread_body(&body);
            let sig = turn_signature(&turns);
            rows.push((thread_meta_from(&p, &fm, &body, &turns), sig));
        }
    }
    // Collapse ONLY true duplicates: a thread whose full turn-sequence is a
    // PREFIX of an already-kept (longer/newer) thread in the same domain. This
    // hides the shorter save of one conversation (dual-writer / migration copy)
    // but NEVER a conversation that diverges - two chats that share an opener
    // but differ afterward are not prefixes of each other, so both survive.
    // Empty threads (no turns) are kept as-is so a fresh "+ New" stub shows.
    rows.sort_by(|a, b| b.0.turn_count.cmp(&a.0.turn_count).then(b.0.updated.cmp(&a.0.updated)));
    let mut kept: Vec<(ThreadMeta, Vec<(String, String)>)> = Vec::new();
    for (meta, sig) in rows.into_iter() {
        if sig.is_empty() {
            kept.push((meta, sig));
            continue;
        }
        let subsumed = kept.iter().any(|(km, ksig)| {
            km.domain == meta.domain && !ksig.is_empty() && is_prefix_of(&sig, ksig)
        });
        if !subsumed {
            kept.push((meta, sig));
        }
    }
    let mut out: Vec<ThreadMeta> = kept.into_iter().map(|(m, _)| m).collect();
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(out)
}

#[tauri::command]
pub(crate) fn load_thread(path: String) -> Result<ThreadFull, String> {
    // Accept BOTH the v4 home (.../memory/threads/x.md, contains "/threads/")
    // AND the legacy flat dir (.../_threads/x.md, contains "/_threads/" but NOT
    // "/threads/"). The substring "threads/" is common to both, so a legacy
    // thread is no longer rejected here - that rejection was blanking the chat
    // for any thread still living under _threads/.
    guard_managed_path(&path, "threads/", ".md")?;
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

// Read the turns already persisted at `path` (empty if absent/unreadable). Used
// by save_thread to refuse any write that would DROP turns already on disk for
// a file that isn't the same live conversation (the disappearance guarantee).
fn read_turns_at(path: &Path) -> Vec<ThreadTurn> {
    match read_to_string_retry(path) {
        Ok(raw) => {
            let (_fm, body) = split_frontmatter(&raw);
            parse_thread_body(&body)
        }
        Err(_) => Vec::new(),
    }
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

    // Resolve the exact file this save targets. A KNOWN slug (the active thread
    // updating itself) is authoritative for its OWN file and may legitimately
    // shrink turns (edit / retry-from-here rewinds the transcript) - that is the
    // "same live conversation" exception. A slug=null save is a CREATE and must
    // NEVER land on top of a different existing conversation.
    let known_slug = slug.as_ref().map(|s| sanitize_existing_slug(s)).filter(|s| !s.is_empty());
    let file_path: PathBuf = match known_slug.as_ref() {
        Some(s) => {
            // Target the file where this slug already lives (it may be a legacy
            // _threads/ thread, not the canonical memory/threads/ dir) so an
            // update never forks a second copy in the other dir. Fall back to
            // the canonical dir for a brand-new file.
            thread_search_dirs(&vault, &domain)
                .ok()
                .and_then(|dirs| {
                    dirs.into_iter()
                        .map(|d| d.join(format!("{s}.md")))
                        .find(|p| p.exists())
                })
                .unwrap_or_else(|| threads_dir.join(format!("{s}.md")))
        }
        None => {
            let first_user = turns
                .iter()
                .find(|t| t.role == "user")
                .map(|t| t.content.as_str())
                .unwrap_or("");
            let hash = fnv1a32(first_user.as_bytes());
            let hash_suffix = format!("{hash:08x}");
            // Dedup safety net for the frontend firing two slug=null saves
            // seconds apart for the SAME new conversation. We reuse a recent
            // thread ONLY when it is provably that same conversation: its
            // on-disk turns must be a PREFIX of the turns we are about to write
            // (i.e. this save strictly EXTENDS it). A distinct conversation that
            // merely opens with the same first message diverges, is not a
            // prefix, and therefore gets its own file instead of clobbering the
            // other - which is exactly the lost-thread bug. Prefix-reuse also
            // guarantees we never write fewer turns than are already there.
            let incoming_sig = turn_signature(&turns);
            let mut reuse: Option<PathBuf> = None;
            if !first_user.is_empty() {
                if let Ok(rd) = fs::read_dir(&threads_dir) {
                    let mut best: Option<(u64, PathBuf)> = None;
                    for e in rd.flatten() {
                        let p = e.path();
                        if p.extension().and_then(|x| x.to_str()) != Some("md") {
                            continue;
                        }
                        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                        if !stem.ends_with(&hash_suffix) {
                            continue;
                        }
                        let raw = match read_to_string_retry(&p) {
                            Ok(r) => r,
                            Err(_) => continue,
                        };
                        let (fm, body) = split_frontmatter(&raw);
                        let existing_sig = turn_signature(&parse_thread_body(&body));
                        // Same conversation only: existing must be a prefix of
                        // what we are writing. Never merge a divergent chat.
                        if !is_prefix_of(&existing_sig, &incoming_sig) {
                            continue;
                        }
                        let created = fm.get("created").map(|s| parse_iso8601_z(s)).unwrap_or(0);
                        // And only very recently (10 min), so two identical
                        // openers far apart in time still stay distinct.
                        if created != 0 && now.saturating_sub(created) < 600 {
                            if best.as_ref().map(|(c, _)| created > *c).unwrap_or(true) {
                                best = Some((created, p.clone()));
                            }
                        }
                    }
                    reuse = best.map(|(_, p)| p);
                }
            }
            match reuse {
                Some(p) => p,
                None => {
                    // Guarantee a FREE filename. Two distinct conversations that
                    // open with the same message in the SAME second would hash
                    // and stamp identically to `{stamp}_{hash}.md`; without this
                    // the second silently overwrote the first. Disambiguate
                    // until the path is unused so a create can never clobber.
                    let mut candidate = threads_dir.join(format!("{stamp}_{hash_suffix}.md"));
                    let mut n = 1u32;
                    while candidate.exists() {
                        candidate = threads_dir.join(format!("{stamp}_{hash_suffix}_{n}.md"));
                        n += 1;
                    }
                    candidate
                }
            }
        }
    };

    // Final anti-loss guard, independent of the path chosen above: never write
    // FEWER turns than are already on disk for a slug=null CREATE (which must
    // only ever add a new or same-conversation file, never shrink one). A
    // known-slug update is exempt - edit/retry deliberately rewinds and the
    // frontend targets its own file. If this create would drop turns, keep the
    // richer on-disk version untouched and just return its path.
    if known_slug.is_none() {
        let on_disk = read_turns_at(&file_path);
        if on_disk.len() > turns.len() {
            return Ok(file_path.to_string_lossy().to_string());
        }
    }

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
    // Fire chat.reply hooks only when a real assistant reply just landed (not on
    // the empty pre-create or a user-only autosave), so the event is meaningful.
    let landed_reply = turns
        .last()
        .map(|t| t.role == "assistant" && !t.content.trim().is_empty())
        .unwrap_or(false);
    if landed_reply {
        crate::hooks::fire_hooks(&vault, "chat.reply", domain.as_deref());
    }
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn rename_thread(path: String, new_title: String) -> Result<(), String> {
    // Accept BOTH the v4 home (.../memory/threads/x.md, contains "/threads/")
    // AND the legacy flat dir (.../_threads/x.md, contains "/_threads/" but NOT
    // "/threads/"). The substring "threads/" is common to both, so a legacy
    // thread is no longer rejected here - that rejection was blanking the chat
    // for any thread still living under _threads/.
    guard_managed_path(&path, "threads/", ".md")?;
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
    // Accept BOTH the v4 home (.../memory/threads/x.md, contains "/threads/")
    // AND the legacy flat dir (.../_threads/x.md, contains "/_threads/" but NOT
    // "/threads/"). The substring "threads/" is common to both, so a legacy
    // thread is no longer rejected here - that rejection was blanking the chat
    // for any thread still living under _threads/.
    guard_managed_path(&path, "threads/", ".md")?;
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

    #[test]
    fn turn_header_matches_speakers_not_content() {
        // Real turn headers the serializer writes.
        assert!(is_turn_header("You"));
        assert!(is_turn_header("claude"));
        assert!(is_turn_header("claude · Opus 4.8 (latest)"));
        assert!(is_turn_header("codex · GPT-5.5"));
        assert!(is_turn_header("antigravity · Gemini 3.1 Pro (High)"));
        // Markdown section headers inside a message are NOT turn delimiters.
        assert!(!is_turn_header("Council Verdict: Real Estate vs. Index Funds"));
        assert!(!is_turn_header("The math"));
        assert!(!is_turn_header("Why \"it depends\""));
        assert!(!is_turn_header("1. Index Funds"));
    }

    use std::sync::atomic::{AtomicU32, Ordering};
    static CTR: AtomicU32 = AtomicU32::new(0);

    fn fresh_vault(tag: &str) -> String {
        let n = CTR.fetch_add(1, Ordering::SeqCst);
        let d = std::env::temp_dir().join(format!("prevail-threads-{tag}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d.to_string_lossy().to_string()
    }
    fn user(s: &str) -> ThreadTurn {
        ThreadTurn { role: "user".into(), cli: None, model: None, content: s.into() }
    }
    fn asst(s: &str) -> ThreadTurn {
        ThreadTurn { role: "assistant".into(), cli: Some("claude".into()), model: None, content: s.into() }
    }
    fn turn_count_on_disk(path: &str) -> usize {
        read_turns_at(Path::new(path)).len()
    }

    // Two conversations with DIFFERENT first messages must produce two files,
    // each with its own turns, and both must list.
    #[test]
    fn distinct_first_messages_never_collide() {
        let v = fresh_vault("distinct");
        let dom = Some("health".to_string());
        let pa = save_thread(v.clone(), dom.clone(), None, "A".into(), vec![user("weather?"), asst("sunny")]).unwrap();
        let pb = save_thread(v.clone(), dom.clone(), None, "B".into(), vec![user("stocks?"), asst("up")]).unwrap();
        assert_ne!(pa, pb, "different openers -> different files");
        assert_eq!(load_thread(pa).unwrap().turns[0].content, "weather?");
        assert_eq!(load_thread(pb).unwrap().turns[0].content, "stocks?");
        let list = list_threads(v, dom).unwrap();
        assert_eq!(list.len(), 2, "both threads listed");
    }

    // THE disappearance guarantee: a NEW conversation that opens with the SAME
    // first message as a recent thread but then DIVERGES must NOT overwrite or
    // hide the earlier one. Both files survive with their own turns; both list.
    #[test]
    fn same_opener_distinct_conversation_does_not_clobber() {
        let v = fresh_vault("sameopener");
        let dom = Some("health".to_string());
        let pa = save_thread(v.clone(), dom.clone(), None, "A".into(), vec![user("hi"), asst("hello, I am A")]).unwrap();
        let pb = save_thread(v.clone(), dom.clone(), None, "B".into(), vec![user("hi"), asst("hello, I am B")]).unwrap();
        assert_ne!(pa, pb, "same opener but distinct convo -> distinct files, no reuse");
        assert_eq!(load_thread(pa.clone()).unwrap().turns[1].content, "hello, I am A", "A not clobbered");
        assert_eq!(load_thread(pb.clone()).unwrap().turns[1].content, "hello, I am B");
        let list = list_threads(v, dom).unwrap();
        assert_eq!(list.len(), 2, "both same-opener conversations remain visible");
    }

    // The intended dedup DOES still fire for the SAME conversation saved twice
    // (the frontend double-fire): the second save strictly EXTENDS the first, so
    // its turns are a superset -> reuse the same file, no duplicate.
    #[test]
    fn same_conversation_extended_reuses_file() {
        let v = fresh_vault("extend");
        let dom = Some("work".to_string());
        let p1 = save_thread(v.clone(), dom.clone(), None, "t".into(), vec![user("plan my week")]).unwrap();
        // Same conversation, now with the assistant reply appended.
        let p2 = save_thread(v.clone(), dom.clone(), None, "t".into(), vec![user("plan my week"), asst("here is a plan")]).unwrap();
        assert_eq!(p1, p2, "extension of the same conversation reuses the file");
        assert_eq!(turn_count_on_disk(&p2), 2);
        assert_eq!(list_threads(v, dom).unwrap().len(), 1, "no duplicate row");
    }

    // An empty "+ New thread" pre-create must never overwrite or reuse a real
    // thread, even one created moments earlier.
    #[test]
    fn empty_stub_never_overwrites_real_thread() {
        let v = fresh_vault("stub");
        let dom = Some("health".to_string());
        let real = save_thread(v.clone(), dom.clone(), None, "real".into(), vec![user("important"), asst("noted")]).unwrap();
        let stub = save_thread(v.clone(), dom.clone(), None, "Untitled".into(), vec![]).unwrap();
        assert_ne!(real, stub);
        assert_eq!(turn_count_on_disk(&real), 2, "real thread untouched by the empty stub");
    }

    // A slug=null CREATE must never REDUCE the turns already on disk for the file
    // it would land on (belt-and-suspenders against a stale short save).
    #[test]
    fn create_never_reduces_disk_turns() {
        let v = fresh_vault("noreduce");
        let dom = Some("work".to_string());
        let p = save_thread(v.clone(), dom.clone(), None, "t".into(), vec![user("q"), asst("a1"), asst("a2")]).unwrap();
        let slug = Path::new(&p).file_stem().unwrap().to_string_lossy().to_string();
        // A KNOWN-slug update MAY shrink (edit / retry rewinds) - same live convo.
        let p2 = save_thread(v.clone(), dom.clone(), Some(slug), "t".into(), vec![user("q")]).unwrap();
        assert_eq!(p, p2);
        assert_eq!(turn_count_on_disk(&p2), 1, "known-slug edit legitimately rewinds");
    }

    // v4 split: a thread saved on a v4-marked domain is found by BOTH list_threads
    // and load_thread at the SAME (memory/threads) location; and a thread that
    // already sits in the legacy _threads/ of a v4 domain is still listed (not
    // orphaned by the memory/threads remap).
    #[test]
    fn v4_domain_threads_are_never_orphaned() {
        let v = fresh_vault("v4split");
        // Make health a v4-marked domain under data/domains.
        let dpath = PathBuf::from(&v).join("data").join("domains").join("health");
        fs::create_dir_all(&dpath).unwrap();
        fs::write(dpath.join(crate::paths::V4_MARKER), "1").unwrap();
        let dom = Some("health".to_string());
        // A save lands in memory/threads and round-trips through list + load.
        let p = save_thread(v.clone(), dom.clone(), None, "new".into(), vec![user("hello v4"), asst("hi")]).unwrap();
        assert!(p.contains("memory/threads"), "v4 save goes to memory/threads: {p}");
        assert_eq!(load_thread(p.clone()).unwrap().turns[0].content, "hello v4");
        // A pre-existing legacy thread sitting in the flat _threads/ dir.
        let legacy_dir = dpath.join("_threads");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::write(
            legacy_dir.join("2020-01-01_00-00-00_deadbeef.md"),
            "---\ntitle: Legacy\ndomain: health\ncreated: 2020-01-01T00:00:00Z\nupdated: 2020-01-01T00:00:00Z\nturns: 2\n---\n\n## You\n\nold question\n\n## claude\n\nold answer\n\n",
        ).unwrap();
        let list = list_threads(v, dom).unwrap();
        assert_eq!(list.len(), 2, "both the v4 thread and the legacy _threads/ thread list");
        assert!(list.iter().any(|m| m.title == "Legacy"), "legacy thread not orphaned");
    }

    #[test]
    fn verdict_with_inner_headers_stays_one_turn() {
        // Regression: a council verdict whose content has its own "## " headers
        // must parse as a SINGLE assistant turn, not fragment into a blank
        // "Council verdict" bubble plus a bogus "Council Verdict: ..." turn.
        let body = "## You\n\nReal estate vs index funds?\n\n## claude · Opus 4.8\n\n### Council verdict\n\n## Council Verdict: Real Estate vs. Index Funds\n\n**Consensus.** Index funds win.\n\n## The math\n\nNumbers here.\n";
        let turns = parse_thread_body(body);
        assert_eq!(turns.len(), 2, "user + one assistant verdict turn");
        assert_eq!(turns[0].role, "user");
        assert_eq!(turns[1].role, "assistant");
        assert_eq!(turns[1].cli.as_deref(), Some("claude"));
        // The inner "## " headers are preserved as content, not split off.
        assert!(turns[1].content.contains("## Council Verdict: Real Estate"));
        assert!(turns[1].content.contains("## The math"));
        assert!(turns[1].content.contains("**Consensus.**"));
    }
}
