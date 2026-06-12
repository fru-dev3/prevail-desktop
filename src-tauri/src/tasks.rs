// Per-domain tasks / goals — the actionable layer. A simple markdown checklist
// at <vault>/<domain>/_tasks.md that the surfaced "next steps" feed into and the
// user checks off. Human-readable + agent-writable; round-trips cleanly.
//
//   # Tasks
//
//   - [ ] Establish a net-worth baseline
//   - [x] Connect the main checking account

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
    pub source: Option<String>, // who added it: "user" | "surface" | "daemon"; "~src" token
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

// Strip trailing metadata tokens off a task body, in any order:
//   "@YYYY-MM-DD" due date · "+YYYY-MM-DD" added date · "~source" provenance.
// Tokens only count at the END of the line, so an inline "@" (an email, a
// handle) never gets eaten.
fn split_meta(raw: &str) -> (String, Option<String>, Option<String>, Option<String>) {
    let mut text = raw.trim().to_string();
    let (mut due, mut added, mut source) = (None, None, None);
    loop {
        let t = text.trim_end().to_string();
        let Some(idx) = t.rfind(' ') else { break };
        let tail = &t[idx + 1..];
        if let Some(d) = tail.strip_prefix('@') {
            if is_ymd(d) { due = Some(d.to_string()); text = t[..idx].to_string(); continue; }
        }
        if let Some(d) = tail.strip_prefix('+') {
            if is_ymd(d) { added = Some(d.to_string()); text = t[..idx].to_string(); continue; }
        }
        if let Some(s) = tail.strip_prefix('~') {
            if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric()) {
                source = Some(s.to_string());
                text = t[..idx].to_string();
                continue;
            }
        }
        break;
    }
    (text.trim().to_string(), due, added, source)
}

fn tasks_path(vault: &str, domain: &str) -> PathBuf {
    crate::domain_dir_pub(vault, domain).join("_tasks.md")
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
            let (text, due, added, source) = split_meta(rest);
            Some(Task { text, done, due, added, source })
        })
        .filter(|t| !t.text.is_empty())
        .collect()
}

fn render_tasks(tasks: &[Task]) -> String {
    let mut s = String::from("# Tasks\n\n");
    for t in tasks {
        let mut line = format!("- [{}] {}", if t.done { "x" } else { " " }, t.text.trim());
        if let Some(d) = t.due.as_deref().filter(|d| !d.is_empty()) { line.push_str(&format!(" @{d}")); }
        if let Some(d) = t.added.as_deref().filter(|d| !d.is_empty()) { line.push_str(&format!(" +{d}")); }
        if let Some(d) = t.source.as_deref().filter(|d| !d.is_empty()) { line.push_str(&format!(" ~{d}")); }
        s.push_str(&line);
        s.push('\n');
    }
    s
}

#[tauri::command]
pub fn tasks_read(vault: String, domain: String) -> Result<Vec<Task>, String> {
    let p = tasks_path(&vault, &domain);
    match std::fs::read_to_string(&p) {
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
    std::fs::write(&p, render_tasks(&tasks)).map_err(|e| format!("write _tasks.md: {e}"))
}

// Append one task if not already present (used by "add as task" on a surfaced
// next-step). Returns the updated list.
#[tauri::command]
pub fn tasks_add(vault: String, domain: String, text: String, source: Option<String>) -> Result<Vec<Task>, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty task".into());
    }
    let mut tasks = tasks_read(vault.clone(), domain.clone())?;
    let (text, due, _, _) = split_meta(&text);
    if !tasks.iter().any(|t| t.text.eq_ignore_ascii_case(&text)) {
        tasks.push(Task {
            text,
            done: false,
            due,
            added: Some(today_ymd()),
            source: Some(source.unwrap_or_else(|| "user".into())),
        });
        tasks_set(vault, domain, tasks.clone())?;
    }
    Ok(tasks)
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
    fn add_stamps_added_date_and_source() {
        let vault = std::env::temp_dir().join(format!("prevail-tasks-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&vault);
        std::fs::create_dir_all(vault.join("wealth")).unwrap();
        let v = vault.to_string_lossy().to_string();
        let after = tasks_add(v.clone(), "wealth".into(), "Open an IRA".into(), Some("surface".into())).unwrap();
        assert_eq!(after[0].source.as_deref(), Some("surface"));
        assert_eq!(after[0].added.as_deref().map(|d| d.len()), Some(10));
        let _ = std::fs::remove_dir_all(&vault);
    }

    #[test]
    fn parses_and_renders_due_dates() {
        let tasks = parse_tasks("- [ ] file taxes @2026-04-15\n- [ ] no date here\n");
        assert_eq!(tasks[0].text, "file taxes");
        assert_eq!(tasks[0].due.as_deref(), Some("2026-04-15"));
        assert_eq!(tasks[1].due, None);
        let r = render_tasks(&tasks);
        assert!(r.contains("- [ ] file taxes @2026-04-15"));
        assert!(r.contains("- [ ] no date here\n"));
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
