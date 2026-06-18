// Per-domain tasks / goals — the actionable layer. A simple markdown checklist
// at <vault>/<domain>/_tasks.md that the surfaced "next steps" feed into and the
// user checks off. Human-readable + agent-writable; round-trips cleanly.
//
//   # Tasks
//
//   - [ ] Establish a net-worth baseline
//   - [x] Connect the main checking account
//
// Workflows-Kanban (P0): tasks also carry an OWNER (me|ai), a STATUS (the kanban
// column), and a stable ID, via end-of-line tokens. Back-compat: old lines parse
// with owner=me, status derived from the checkbox, and an id minted on next write.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct Task {
    pub text: String,
    pub done: bool,
    #[serde(default)]
    pub due: Option<String>, // YYYY-MM-DD reminder date; "@date" token
    #[serde(default)]
    pub added: Option<String>, // YYYY-MM-DD the task entered the list; "+date" token
    #[serde(default)]
    pub source: Option<String>, // who added it: "user" | "surface" | "daemon"; bare "~src" token
    #[serde(default)]
    pub owner: Option<String>, // "me" | "ai"; "~owner:" token (default me)
    #[serde(default)]
    pub status: Option<String>, // "todo"|"doing"|"review"|"blocked"|"done"; "~status:" token
    #[serde(default)]
    pub id: Option<String>, // stable handle for moves + workflow linkage; "~id:" token
}

fn is_ymd(s: &str) -> bool {
    s.len() == 10
        && s.as_bytes()
            .iter()
            .enumerate()
            .all(|(i, b)| if i == 4 || i == 7 { *b == b'-' } else { b.is_ascii_digit() })
}

pub(crate) fn today_ymd() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, mo, d, _, _, _) = crate::secs_to_ymdhms(secs);
    format!("{y:04}-{mo:02}-{d:02}")
}

// A short, stable, greppable task id. base16 of the wall-clock nanos (+ a salt so
// a batch minted in the same nanosecond doesn't collide), last 7 chars.
fn mint_id(salt: usize) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = nanos.wrapping_add((salt as u128).wrapping_mul(2_654_435_761));
    let s = format!("{n:x}");
    let take = s.len().saturating_sub(7);
    s[take..].to_string()
}

const VALID_STATUS: &[&str] = &["todo", "doing", "review", "blocked", "done"];

#[derive(Default)]
struct Meta {
    due: Option<String>,
    added: Option<String>,
    source: Option<String>,
    owner: Option<String>,
    status: Option<String>,
    id: Option<String>,
}

// Strip trailing metadata tokens off a task body, in any order, only at the END
// of the line (so an inline "@" / "~" in an email or handle never gets eaten):
//   "@YYYY-MM-DD" due · "+YYYY-MM-DD" added · "~source" provenance (bare) ·
//   "~owner:me|ai" · "~status:todo|doing|review|blocked|done" · "~id:<handle>".
fn split_meta(raw: &str) -> (String, Meta) {
    let mut text = raw.trim().to_string();
    let mut m = Meta::default();
    loop {
        let t = text.trim_end().to_string();
        let Some(idx) = t.rfind(' ') else { break };
        let tail = &t[idx + 1..];
        if let Some(d) = tail.strip_prefix('@') {
            if is_ymd(d) { m.due = Some(d.to_string()); text = t[..idx].to_string(); continue; }
        }
        if let Some(d) = tail.strip_prefix('+') {
            if is_ymd(d) { m.added = Some(d.to_string()); text = t[..idx].to_string(); continue; }
        }
        if let Some(rest) = tail.strip_prefix('~') {
            if let Some((k, v)) = rest.split_once(':') {
                // key:value tokens (owner/status/id/src).
                if !v.is_empty() {
                    let matched = match k {
                        "owner" => { m.owner = Some(v.to_string()); true }
                        "status" => { m.status = Some(v.to_string()); true }
                        "id" => { m.id = Some(v.to_string()); true }
                        "src" => { m.source = Some(v.to_string()); true }
                        _ => false,
                    };
                    if matched { text = t[..idx].to_string(); continue; }
                }
            } else if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric()) {
                // bare "~source" (legacy form).
                m.source = Some(rest.to_string());
                text = t[..idx].to_string();
                continue;
            }
        }
        break;
    }
    (text.trim().to_string(), m)
}

fn tasks_path(vault: &str, domain: &str) -> PathBuf {
    crate::paths::domain_dir_pub(vault, domain).join("_tasks.md")
}

fn parse_tasks(md: &str) -> Vec<Task> {
    md.lines()
        .filter_map(|l| {
            let t = l.trim_start();
            let (done, rest) = if let Some(r) = t.strip_prefix("- [ ] ").or_else(|| t.strip_prefix("- [] ")) {
                (false, r)
            } else if let Some(r) = t.strip_prefix("- [x] ").or_else(|| t.strip_prefix("- [X] ")) {
                (true, r)
            } else {
                return None;
            };
            let (text, m) = split_meta(rest);
            Some(Task {
                text,
                done,
                due: m.due,
                added: m.added,
                source: m.source,
                owner: m.owner,
                status: m.status,
                id: m.id,
            })
        })
        .filter(|t| !t.text.is_empty())
        .collect()
}

// Effective status: explicit token wins; else derived from the checkbox.
fn effective_status(t: &Task) -> String {
    match t.status.as_deref() {
        Some(s) if VALID_STATUS.contains(&s) => s.to_string(),
        _ => if t.done { "done".into() } else { "todo".into() },
    }
}

// Fill defaults so every persisted task has an id + owner + consistent status.
fn normalize(tasks: &mut [Task]) {
    for (i, t) in tasks.iter_mut().enumerate() {
        if t.id.as_deref().unwrap_or("").is_empty() {
            t.id = Some(mint_id(i));
        }
        if t.owner.as_deref().unwrap_or("").is_empty() {
            t.owner = Some("me".into());
        }
        // Keep status ⇔ done consistent.
        let st = effective_status(t);
        if st == "done" { t.done = true; }
        if t.done { t.status = Some("done".into()); } else if st == "done" { t.status = Some("todo".into()); }
        else { t.status = Some(st); }
    }
}

fn render_tasks(tasks: &[Task]) -> String {
    let mut s = String::from("# Tasks\n\n");
    for t in tasks {
        let mut line = format!("- [{}] {}", if t.done { "x" } else { " " }, t.text.trim());
        if let Some(d) = t.due.as_deref().filter(|d| !d.is_empty()) { line.push_str(&format!(" @{d}")); }
        if let Some(d) = t.added.as_deref().filter(|d| !d.is_empty()) { line.push_str(&format!(" +{d}")); }
        if let Some(d) = t.source.as_deref().filter(|d| !d.is_empty()) { line.push_str(&format!(" ~{d}")); }
        // owner: only persist "ai" (me is the default, keeps human lines clean).
        if t.owner.as_deref() == Some("ai") { line.push_str(" ~owner:ai"); }
        // status: only persist the working states; todo/done are implied by the box.
        if let Some(st) = t.status.as_deref() {
            if matches!(st, "doing" | "review" | "blocked") { line.push_str(&format!(" ~status:{st}")); }
        }
        if let Some(id) = t.id.as_deref().filter(|d| !d.is_empty()) { line.push_str(&format!(" ~id:{id}")); }
        s.push_str(&line);
        s.push('\n');
    }
    s
}

#[tauri::command]
pub fn tasks_read(vault: String, domain: String) -> Result<Vec<Task>, String> {
    let p = tasks_path(&vault, &domain);
    match crate::read_to_string_retry(&p) {
        Ok(md) => Ok(parse_tasks(&md)),
        Err(_) => Ok(vec![]),
    }
}

// Replace the whole list (used for toggles/reorder/delete from the UI).
#[tauri::command]
pub fn tasks_set(vault: String, domain: String, tasks: Vec<Task>) -> Result<(), String> {
    let p = tasks_path(&vault, &domain);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut tasks = tasks;
    normalize(&mut tasks);
    std::fs::write(&p, crate::engine::maybe_encrypt(&p, &render_tasks(&tasks))).map_err(|e| format!("write _tasks.md: {e}"))
}

// Append one task if not already present (used by "add as task" on a surfaced
// next-step). Returns the updated list. Mints id + owner/status defaults.
#[tauri::command]
pub fn tasks_add(vault: String, domain: String, text: String, source: Option<String>) -> Result<Vec<Task>, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty task".into());
    }
    let mut tasks = tasks_read(vault.clone(), domain.clone())?;
    let (text, m) = split_meta(&text);
    if !tasks.iter().any(|t| t.text.eq_ignore_ascii_case(&text)) {
        tasks.push(Task {
            text,
            done: false,
            due: m.due,
            added: Some(today_ymd()),
            source: Some(source.or(m.source).unwrap_or_else(|| "user".into())),
            owner: Some(m.owner.unwrap_or_else(|| "me".into())),
            status: Some(m.status.unwrap_or_else(|| "todo".into())),
            id: None,
        });
        tasks_set(vault.clone(), domain.clone(), tasks)?;
        return tasks_read(vault, domain); // re-read so the minted id is returned
    }
    Ok(tasks)
}

// Set a single task's status by id (kanban move). Keeps done ⇔ status:done.
#[tauri::command]
pub fn tasks_set_status(vault: String, domain: String, id: String, status: String) -> Result<Vec<Task>, String> {
    if !VALID_STATUS.contains(&status.as_str()) {
        return Err(format!("invalid status: {status}"));
    }
    let mut tasks = tasks_read(vault.clone(), domain.clone())?;
    let mut found = false;
    for t in tasks.iter_mut() {
        if t.id.as_deref() == Some(id.as_str()) {
            t.status = Some(status.clone());
            t.done = status == "done";
            found = true;
        }
    }
    if !found { return Err(format!("task not found: {id}")); }
    tasks_set(vault.clone(), domain.clone(), tasks)?;
    tasks_read(vault, domain)
}

// Set a single task's owner by id ("me" | "ai").
#[tauri::command]
pub fn tasks_set_owner(vault: String, domain: String, id: String, owner: String) -> Result<Vec<Task>, String> {
    if owner != "me" && owner != "ai" {
        return Err(format!("invalid owner: {owner}"));
    }
    let mut tasks = tasks_read(vault.clone(), domain.clone())?;
    let mut found = false;
    for t in tasks.iter_mut() {
        if t.id.as_deref() == Some(id.as_str()) { t.owner = Some(owner.clone()); found = true; }
    }
    if !found { return Err(format!("task not found: {id}")); }
    tasks_set(vault.clone(), domain.clone(), tasks)?;
    tasks_read(vault, domain)
}

/// Every task across every domain, tagged with its domain — powers the
/// cross-domain board. Open tasks first, then done.
#[tauri::command]
pub fn tasks_read_all(vault: String) -> Result<Vec<serde_json::Value>, String> {
    let mut out: Vec<serde_json::Value> = Vec::new();
    // Enumerate domains the v3-aware way (handles BOTH <vault>/<domain> and the v3
    // <vault>/domains/<domain> container) — lightweight (names only, no state reads).
    for name in crate::vault::list_domain_names(&vault) {
        for t in tasks_read(vault.clone(), name.clone()).unwrap_or_default() {
            let status = effective_status(&t);
            out.push(serde_json::json!({
                "domain": name,
                "text": t.text,
                "done": t.done,
                "due": t.due,
                "added": t.added,
                "source": t.source,
                "owner": t.owner.unwrap_or_else(|| "me".into()),
                "status": status,
                "id": t.id,
            }));
        }
    }
    // Open first; then by due date (soonest first, undated last).
    out.sort_by(|a, b| {
        let ad = a["done"].as_bool().unwrap_or(false);
        let bd = b["done"].as_bool().unwrap_or(false);
        ad.cmp(&bd).then_with(|| {
            let au = a["due"].as_str().unwrap_or("9999");
            let bu = b["due"].as_str().unwrap_or("9999");
            au.cmp(bu)
        })
    });
    Ok(out)
}

/// Cross-domain **Decision Inbox** (read-model, no new store). Aggregates two
/// things that need the user's call: (1) loop **approvals** queued in every
/// domain's `_loops_runtime.json:loops[*].pending[]`, and (2) AI-owned tasks now
/// sitting in `status:review` (a workflow finished and wants sign-off). Returns
/// `DecisionItem[]` newest-first. Actions reuse existing plumbing in the UI.
#[tauri::command]
pub fn decisions_pending(vault: String) -> Result<Vec<serde_json::Value>, String> {
    let mut out: Vec<serde_json::Value> = Vec::new();
    {
        for name in crate::vault::list_domain_names(&vault) {
            let ddir = crate::paths::domain_dir_pub(&vault, &name);

            // loopId → human name (best-effort, for the "why" line).
            let mut loop_names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
            if let Ok(raw) = std::fs::read_to_string(ddir.join("_loops.json")) {
                if let Ok(doc) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if let Some(loops) = doc.get("loops").and_then(|v| v.as_array()) {
                        for l in loops {
                            if let (Some(id), Some(nm)) = (l.get("id").and_then(|v| v.as_str()), l.get("name").and_then(|v| v.as_str())) {
                                loop_names.insert(id.to_string(), nm.to_string());
                            }
                        }
                    }
                }
            }

            // 1. loop approvals
            if let Ok(raw) = std::fs::read_to_string(ddir.join("_loops_runtime.json")) {
                if let Ok(doc) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if let Some(loops) = doc.get("loops").and_then(|v| v.as_object()) {
                        for (loop_id, entry) in loops {
                            let Some(pending) = entry.get("pending").and_then(|v| v.as_array()) else { continue };
                            for (idx, pitem) in pending.iter().enumerate() {
                                let text = pitem.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                if text.trim().is_empty() { continue; }
                                let ts = pitem.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
                                let why = loop_names.get(loop_id).map(|n| format!("workflow “{n}”"));
                                out.push(serde_json::json!({
                                    "id": format!("{name}:{loop_id}:{idx}"),
                                    "domain": name,
                                    "kind": "approval",
                                    "source": "loop",
                                    "loopId": loop_id,
                                    "text": text,
                                    "why": why,
                                    "ts": ts,
                                }));
                            }
                        }
                    }
                }
            }

            // 2. AI tasks the steward paused (blocked → approval) or finished
            //    (review → sign-off). Both are decisions only the user can make.
            for t in tasks_read(vault.clone(), name.clone()).unwrap_or_default() {
                let st = effective_status(&t);
                let (kind, why) = match st.as_str() {
                    "blocked" => ("approval", "AI paused — needs your approval"),
                    "review" => ("review", "AI finished — review the result"),
                    _ => continue,
                };
                out.push(serde_json::json!({
                    "id": format!("task:{}", t.id.clone().unwrap_or_default()),
                    "domain": name,
                    "kind": kind,
                    "source": "task",
                    "taskId": t.id,
                    "text": t.text,
                    "why": why,
                    "ts": 0,
                }));
            }
        }
    }
    // Newest first (review items with ts 0 sink to the bottom).
    out.sort_by(|a, b| b["ts"].as_i64().unwrap_or(0).cmp(&a["ts"].as_i64().unwrap_or(0)));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_render_round_trip() {
        let md = "# Tasks\n\n- [ ] do A\n- [x] did B\n";
        let tasks = parse_tasks(md);
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].text, "do A");
        assert!(!tasks[0].done);
        assert!(tasks[1].done);
        let rendered = render_tasks(&tasks);
        assert!(rendered.contains("- [ ] do A"));
        assert!(rendered.contains("- [x] did B"));
    }

    #[test]
    fn parses_and_renders_metadata_tokens() {
        let tasks = parse_tasks("- [ ] file taxes @2026-04-15 +2026-06-12 ~daemon\n- [ ] email bob@x.com\n");
        assert_eq!(tasks[0].text, "file taxes");
        assert_eq!(tasks[0].due.as_deref(), Some("2026-04-15"));
        assert_eq!(tasks[0].added.as_deref(), Some("2026-06-12"));
        assert_eq!(tasks[0].source.as_deref(), Some("daemon"));
        // Inline "@" is not a token: text stays intact.
        assert_eq!(tasks[1].text, "email bob@x.com");
        let r = render_tasks(&tasks);
        assert!(r.contains("- [ ] file taxes @2026-04-15 +2026-06-12 ~daemon"));
    }

    #[test]
    fn parses_owner_status_id_tokens() {
        let tasks = parse_tasks("- [ ] draft budget @2026-06-25 +2026-06-18 ~user ~owner:ai ~status:doing ~id:k7f3a\n");
        assert_eq!(tasks[0].text, "draft budget");
        assert_eq!(tasks[0].owner.as_deref(), Some("ai"));
        assert_eq!(tasks[0].status.as_deref(), Some("doing"));
        assert_eq!(tasks[0].id.as_deref(), Some("k7f3a"));
        assert_eq!(tasks[0].source.as_deref(), Some("user"));
        assert_eq!(tasks[0].due.as_deref(), Some("2026-06-25"));
        // round-trips
        let r = render_tasks(&tasks);
        assert!(r.contains("~owner:ai"));
        assert!(r.contains("~status:doing"));
        assert!(r.contains("~id:k7f3a"));
    }

    #[test]
    fn legacy_lines_get_defaults_and_id_on_normalize() {
        let mut tasks = parse_tasks("- [ ] old task\n- [x] old done\n");
        normalize(&mut tasks);
        assert_eq!(tasks[0].owner.as_deref(), Some("me"));
        assert_eq!(tasks[0].status.as_deref(), Some("todo"));
        assert!(tasks[0].id.as_deref().map(|s| !s.is_empty()).unwrap_or(false));
        assert_eq!(tasks[1].status.as_deref(), Some("done"));
        assert!(tasks[1].done);
    }

    #[test]
    fn status_done_keeps_checkbox_in_sync() {
        let mut tasks = parse_tasks("- [ ] thing ~status:doing ~id:abc123\n");
        // moving to done flips the checkbox
        tasks[0].status = Some("done".into());
        normalize(&mut tasks);
        assert!(tasks[0].done);
        let r = render_tasks(&tasks);
        assert!(r.contains("- [x] thing"));
        assert!(!r.contains("~status:done")); // done implied by the box
    }

    #[test]
    fn add_stamps_added_date_and_source() {
        let vault = std::env::temp_dir().join(format!("prevail-tasks-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&vault);
        std::fs::create_dir_all(vault.join("wealth")).unwrap();
        let v = vault.to_string_lossy().to_string();
        let after = tasks_add(v.clone(), "wealth".into(), "Open an IRA".into(), Some("surface".into())).unwrap();
        assert_eq!(after[0].source.as_deref(), Some("surface"));
        assert_eq!(after[0].added.as_deref().map(|d| d.len()), Some(10));
        // "me" is the implicit default (not persisted to keep lines clean) → None on re-read.
        assert_eq!(after[0].owner.as_deref().unwrap_or("me"), "me");
        assert!(after[0].id.as_deref().map(|s| !s.is_empty()).unwrap_or(false));
        let _ = std::fs::remove_dir_all(&vault);
    }

    #[test]
    fn set_status_and_owner_by_id() {
        let vault = std::env::temp_dir().join(format!("prevail-tasks-kanban-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&vault);
        std::fs::create_dir_all(vault.join("wealth")).unwrap();
        let v = vault.to_string_lossy().to_string();
        let after = tasks_add(v.clone(), "wealth".into(), "Draft budget".into(), None).unwrap();
        let id = after[0].id.clone().unwrap();
        let after = tasks_set_owner(v.clone(), "wealth".into(), id.clone(), "ai".into()).unwrap();
        assert_eq!(after[0].owner.as_deref(), Some("ai"));
        let after = tasks_set_status(v.clone(), "wealth".into(), id.clone(), "doing".into()).unwrap();
        assert_eq!(after[0].status.as_deref(), Some("doing"));
        let after = tasks_set_status(v.clone(), "wealth".into(), id, "done".into()).unwrap();
        assert!(after[0].done);
        let _ = std::fs::remove_dir_all(&vault);
    }

    #[test]
    fn add_dedups_case_insensitive() {
        let vault = std::env::temp_dir().join(format!("prevail-tasks-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&vault);
        std::fs::create_dir_all(vault.join("wealth")).unwrap();
        let v = vault.to_string_lossy().to_string();
        tasks_add(v.clone(), "wealth".into(), "Open an IRA".into(), None).unwrap();
        let after = tasks_add(v.clone(), "wealth".into(), "open an ira".into(), None).unwrap();
        assert_eq!(after.len(), 1); // case-insensitive dedup
        let read = tasks_read(v, "wealth".into()).unwrap();
        assert_eq!(read.len(), 1);
        let _ = std::fs::remove_dir_all(&vault);
    }
}
