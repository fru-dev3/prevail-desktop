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
    pub due: Option<String>, // YYYY-MM-DD, optional (a reminder date)
}

// Split a trailing "@YYYY-MM-DD" due-date token off a task body.
fn split_due(raw: &str) -> (String, Option<String>) {
    let raw = raw.trim();
    if let Some(idx) = raw.rfind('@') {
        let tail = &raw[idx + 1..];
        if tail.len() == 10 && tail.as_bytes().iter().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 { *b == b'-' } else { b.is_ascii_digit() }
        }) {
            return (raw[..idx].trim().to_string(), Some(tail.to_string()));
        }
    }
    (raw.to_string(), None)
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
            let (text, due) = split_due(rest);
            Some(Task { text, done, due })
        })
        .filter(|t| !t.text.is_empty())
        .collect()
}

fn render_tasks(tasks: &[Task]) -> String {
    let mut s = String::from("# Tasks\n\n");
    for t in tasks {
        let due = t.due.as_deref().filter(|d| !d.is_empty()).map(|d| format!(" @{d}")).unwrap_or_default();
        s.push_str(&format!("- [{}] {}{}\n", if t.done { "x" } else { " " }, t.text.trim(), due));
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
pub fn tasks_add(vault: String, domain: String, text: String) -> Result<Vec<Task>, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty task".into());
    }
    let mut tasks = tasks_read(vault.clone(), domain.clone())?;
    let (text, due) = split_due(&text);
    if !tasks.iter().any(|t| t.text.eq_ignore_ascii_case(&text)) {
        tasks.push(Task { text, done: false, due });
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
        tasks_add(v.clone(), "wealth".into(), "Open an IRA".into()).unwrap();
        let after = tasks_add(v.clone(), "wealth".into(), "open an ira".into()).unwrap();
        assert_eq!(after.len(), 1); // case-insensitive dedup
        let read = tasks_read(v, "wealth".into()).unwrap();
        assert_eq!(read.len(), 1);
        let _ = std::fs::remove_dir_all(&vault);
    }
}
