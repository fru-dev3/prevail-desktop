// Per-domain task reminders.
//
// Scans every domain's _tasks.md for undone tasks whose @YYYY-MM-DD due date
// is today or earlier, then fires a native macOS notification for each one
// that hasn't been notified today. State is persisted to
// ~/.prevail/reminded.json so the app doesn't re-fire the same task on every
// launch or focus event.
//
// Two commands are exposed to the frontend:
//   reminders_check  — scan + fire notifications + return due list
//   reminders_due_today — scan only, no notifications (for sidebar badges)

use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone)]
pub struct DueTask {
    pub domain: String,
    pub text: String,
    pub due: String,
    pub overdue: bool,
}

/// Walk all domain dirs inside `vault` and return undone tasks due on or
/// before `today` (YYYY-MM-DD). Pure read — no side effects.
pub fn scan_due(vault: &str, today: &str) -> Vec<DueTask> {
    let Ok(entries) = std::fs::read_dir(vault) else {
        return vec![];
    };
    let mut due = vec![];
    for entry in entries.flatten() {
        let domain = entry.file_name().to_string_lossy().to_string();
        if domain.starts_with('.') || domain.starts_with('_') {
            continue;
        }
        if !entry.path().is_dir() {
            continue;
        }
        let tasks_path = entry.path().join("_tasks.md");
        let Ok(md) = std::fs::read_to_string(&tasks_path) else {
            continue;
        };
        for line in md.lines() {
            let t = line.trim_start();
            // Only unchecked items.
            let rest = if let Some(r) = t.strip_prefix("- [ ] ").or_else(|| t.strip_prefix("- [] ")) {
                r
            } else {
                continue;
            };
            let raw = rest.trim();
            if let Some(date) = extract_due(raw) {
                if date.as_str() <= today {
                    let at = raw.rfind('@').unwrap();
                    let text = raw[..at].trim().to_string();
                    if text.is_empty() {
                        continue;
                    }
                    due.push(DueTask {
                        domain: domain.clone(),
                        text,
                        overdue: date.as_str() < today,
                        due: date,
                    });
                }
            }
        }
    }
    due
}

fn extract_due(raw: &str) -> Option<String> {
    let idx = raw.rfind('@')?;
    let tail = &raw[idx + 1..];
    let valid = tail.len() == 10
        && tail.as_bytes().iter().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        });
    if valid { Some(tail.to_string()) } else { None }
}

/// Today's date as YYYY-MM-DD in local time, via libc (already a dep).
pub fn today_str() -> String {
    unsafe {
        let t = libc::time(std::ptr::null_mut());
        let mut tm: libc::tm = std::mem::zeroed();
        libc::localtime_r(&t, &mut tm);
        format!(
            "{:04}-{:02}-{:02}",
            tm.tm_year + 1900,
            tm.tm_mon + 1,
            tm.tm_mday
        )
    }
}

fn reminded_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    Path::new(&home).join(".prevail").join("reminded.json")
}

fn load_reminded_today(today: &str) -> HashSet<String> {
    let p = reminded_path();
    let Ok(raw) = std::fs::read_to_string(&p) else {
        return HashSet::new();
    };
    let Ok(map): Result<HashMap<String, Vec<String>>, _> = serde_json::from_str(&raw) else {
        return HashSet::new();
    };
    map.get(today)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .collect()
}

fn save_reminded_today(today: &str, keys: &HashSet<String>) {
    let p = reminded_path();
    let mut map: HashMap<String, Vec<String>> = std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    // Keep only today and future dates — prune stale entries.
    map.retain(|k, _| k.as_str() >= today);
    let mut v: Vec<String> = keys.iter().cloned().collect();
    v.sort();
    map.insert(today.to_string(), v);
    if let Ok(json) = serde_json::to_string_pretty(&map) {
        let _ = std::fs::write(&p, json);
    }
}

fn title_case(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

fn unique_domains(tasks: &[&DueTask]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    for t in tasks {
        seen.insert(title_case(&t.domain));
    }
    seen.into_iter().collect()
}

/// Check for due tasks and fire native notifications for any not already
/// notified today. Returns the full list of due/overdue tasks so the
/// frontend can update its badges in the same call.
#[tauri::command]
pub fn reminders_check(app: tauri::AppHandle, vault: String) -> Result<Vec<DueTask>, String> {
    use tauri_plugin_notification::NotificationExt;
    let today = today_str();
    let due = scan_due(&vault, &today);
    if due.is_empty() {
        return Ok(vec![]);
    }
    let mut reminded = load_reminded_today(&today);
    let fresh: Vec<&DueTask> = due
        .iter()
        .filter(|t| !reminded.contains(&format!("{}|{}", t.domain, t.text)))
        .collect();
    if !fresh.is_empty() {
        for t in &fresh {
            reminded.insert(format!("{}|{}", t.domain, t.text));
        }
        save_reminded_today(&today, &reminded);
        if fresh.len() == 1 {
            let t = fresh[0];
            let title = if t.overdue { "Overdue task" } else { "Task due today" };
            let _ = app
                .notification()
                .builder()
                .title(title)
                .body(format!("{}: {}", title_case(&t.domain), t.text))
                .show();
        } else {
            let overdue = fresh.iter().filter(|t| t.overdue).count();
            let title = if overdue > 0 { "Overdue & due tasks" } else { "Tasks due today" };
            let domains = unique_domains(&fresh);
            let body = format!("{} tasks in {}", fresh.len(), domains.join(", "));
            let _ = app.notification().builder().title(title).body(body).show();
        }
    }
    Ok(due)
}

/// Returns all due/overdue tasks without firing notifications.
/// Called on startup to populate sidebar badges before the first
/// focus event triggers reminders_check.
#[tauri::command]
pub fn reminders_due_today(vault: String) -> Result<Vec<DueTask>, String> {
    Ok(scan_due(&vault, &today_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_due_finds_overdue_and_today() {
        let vault = std::env::temp_dir().join(format!("prevail-remind-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&vault);
        let domain = vault.join("wealth");
        std::fs::create_dir_all(&domain).unwrap();
        std::fs::write(
            domain.join("_tasks.md"),
            "# Tasks\n\n- [ ] file FBAR @2026-06-10\n- [ ] review Q2 @2026-06-11\n- [ ] future task @2026-12-31\n- [x] already done @2026-06-11\n",
        ).unwrap();
        let due = scan_due(vault.to_str().unwrap(), "2026-06-11");
        assert_eq!(due.len(), 2);
        assert!(due.iter().any(|t| t.text == "file FBAR" && t.overdue));
        assert!(due.iter().any(|t| t.text == "review Q2" && !t.overdue));
        let _ = std::fs::remove_dir_all(&vault);
    }

    #[test]
    fn scan_due_skips_done_tasks() {
        let vault = std::env::temp_dir().join(format!("prevail-remind-done-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&vault);
        let domain = vault.join("health");
        std::fs::create_dir_all(&domain).unwrap();
        std::fs::write(domain.join("_tasks.md"), "- [x] done task @2026-06-11\n- [ ] open @2026-06-11\n").unwrap();
        let due = scan_due(vault.to_str().unwrap(), "2026-06-11");
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].text, "open");
        let _ = std::fs::remove_dir_all(&vault);
    }
}
