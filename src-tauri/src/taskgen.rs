// Proactive task-generation daemon.
//
// Reads vault documents (soul.md, goals.md, per-domain _memory.md/_state.md)
// and calls an AI to generate new actionable tasks. Generated tasks are appended
// to the domain's _tasks.md, skipping tasks already present.
//
// Each domain is processed at most once per day, tracked in _taskgen.json.
// Design mirrors distill.rs: a background tokio task with start/stop/status.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::async_runtime::JoinHandle;
use tokio::sync::{watch, Mutex as AsyncMutex};

#[derive(Clone, Debug, Deserialize)]
pub struct TaskGenConfig {
    pub vault: String,
    pub provider: String,
    pub model: String,
    pub interval_sec: u64,
    pub max_tasks_per_domain: usize,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct TaskGenStatus {
    pub running: bool,
    pub last_run_ts: Option<u64>,
    pub last_error: Option<String>,
    pub domains_processed: u64,
    pub tasks_generated: u64,
}

pub struct TaskGenState {
    inner: Mutex<TaskGenInner>,
}

struct TaskGenInner {
    handle: Option<JoinHandle<()>>,
    stop_tx: Option<watch::Sender<bool>>,
    status: Arc<AsyncMutex<TaskGenStatus>>,
}

impl Default for TaskGenState {
    fn default() -> Self { Self::new() }
}

impl TaskGenState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(TaskGenInner {
                handle: None,
                stop_tx: None,
                status: Arc::new(AsyncMutex::new(TaskGenStatus::default())),
            }),
        }
    }

    pub async fn status(&self) -> TaskGenStatus {
        let arc = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).status.clone() };
        let x = arc.lock().await.clone(); x
    }

    pub async fn stop(&self) {
        let (tx, handle, arc) = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            (inner.stop_tx.take(), inner.handle.take(), inner.status.clone())
        };
        if let Some(tx) = tx { let _ = tx.send(true); }
        if let Some(h) = handle { h.abort(); }
        arc.lock().await.running = false;
    }

    pub async fn start(&self, cfg: TaskGenConfig) {
        self.stop().await;
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let arc = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).status.clone() };
        { let mut s = arc.lock().await; *s = TaskGenStatus { running: true, ..Default::default() }; }
        let status_arc = arc.clone();
        let interval = Duration::from_secs(cfg.interval_sec.max(300));

        let handle = tauri::async_runtime::spawn(async move {
            loop {
                let res = run_once(&cfg).await;
                {
                    let mut s = status_arc.lock().await;
                    s.last_run_ts = Some(now_secs());
                    match res {
                        Ok((domains, tasks)) => {
                            s.domains_processed += domains;
                            s.tasks_generated += tasks;
                            s.last_error = None;
                        }
                        Err(e) => s.last_error = Some(e),
                    }
                }
                tokio::select! {
                    _ = stop_rx.changed() => { if *stop_rx.borrow() { break; } }
                    _ = tokio::time::sleep(interval) => {}
                }
            }
            status_arc.lock().await.running = false;
        });

        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.handle = Some(handle);
        inner.stop_tx = Some(stop_tx);
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor: per-domain last-run tracking in _taskgen.json

#[derive(Serialize, Deserialize, Default)]
struct Cursor {
    last_run_ts: u64,
    tasks_generated: u64,
}

fn cursor_path(domain_dir: &Path) -> PathBuf {
    domain_dir.join("_taskgen.json")
}

fn read_cursor(domain_dir: &Path) -> Cursor {
    std::fs::read_to_string(cursor_path(domain_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_cursor(domain_dir: &Path, c: &Cursor) {
    if let Ok(j) = serde_json::to_string_pretty(c) {
        let _ = std::fs::write(cursor_path(domain_dir), j);
    }
}

// ─────────────────────────────────────────────────────────────────────────────

async fn run_once_inner(cfg: &TaskGenConfig, force: bool) -> Result<(u64, u64), String> {
    let vault = PathBuf::from(&cfg.vault);
    if !vault.exists() {
        return Err(format!("vault not found: {}", cfg.vault));
    }

    let soul = std::fs::read_to_string(vault.join("soul.md")).unwrap_or_default();
    let goals = std::fs::read_to_string(vault.join("goals.md")).unwrap_or_default();

    let today_ts = now_secs();
    const ONE_DAY: u64 = 86400;

    let mut domains_done = 0u64;
    let mut tasks_done = 0u64;

    let Ok(entries) = std::fs::read_dir(&vault) else {
        return Ok((0, 0));
    };

    for entry in entries.flatten() {
        let domain = entry.file_name().to_string_lossy().to_string();
        if domain.starts_with('.') || domain.starts_with('_') {
            continue;
        }
        if !entry.path().is_dir() {
            continue;
        }
        let domain_dir = entry.path();

        if !domain_daemon_enabled(&domain_dir, "taskgen") {
            continue;
        }
        let cursor = read_cursor(&domain_dir);
        if !force && today_ts.saturating_sub(cursor.last_run_ts) < ONE_DAY {
            continue;
        }

        match generate_for_domain(cfg, &domain, &domain_dir, &soul, &goals).await {
            Ok(n) => {
                write_cursor(&domain_dir, &Cursor {
                    last_run_ts: today_ts,
                    tasks_generated: cursor.tasks_generated + n,
                });
                if n > 0 {
                    domains_done += 1;
                    tasks_done += n;
                }
            }
            Err(_) => {
                // Non-fatal — still advance cursor so we don't retry every tick.
                write_cursor(&domain_dir, &Cursor {
                    last_run_ts: today_ts,
                    tasks_generated: cursor.tasks_generated,
                });
            }
        }
    }

    Ok((domains_done, tasks_done))
}

async fn run_once(cfg: &TaskGenConfig) -> Result<(u64, u64), String> {
    run_once_inner(cfg, false).await
}

async fn generate_for_domain(
    cfg: &TaskGenConfig,
    domain: &str,
    domain_dir: &Path,
    soul: &str,
    goals: &str,
) -> Result<u64, String> {
    let memory = std::fs::read_to_string(domain_dir.join("_memory.md")).unwrap_or_default();
    let state_md = std::fs::read_to_string(domain_dir.join("_state.md")).unwrap_or_default();
    let existing = std::fs::read_to_string(domain_dir.join("_tasks.md")).unwrap_or_default();

    if memory.trim().is_empty() && state_md.trim().is_empty() {
        return Ok(0);
    }

    let today = crate::reminders::today_str();
    let prompt = format!(
        "{}{}",
        crate::ideal_state_preamble(Path::new(&cfg.vault)),
        build_prompt(domain, soul, goals, &memory, &state_md, &existing, &today, cfg.max_tasks_per_domain),
    );

    crate::bunker::guard_cli(&cfg.provider)?;
    let model = if cfg.model.is_empty() { None } else { Some(cfg.model.as_str()) };
    let out = crate::telegram_bridge::run_cli(&cfg.provider, model, &prompt).await?;
    if out.trim().is_empty() {
        return Ok(0);
    }

    let new_tasks = parse_tasks(&out);
    if new_tasks.is_empty() {
        return Ok(0);
    }

    let fresh: Vec<&str> = new_tasks
        .iter()
        .filter(|t| {
            let key: String = t.chars().take(40).collect::<String>().to_lowercase();
            !existing.lines().any(|l| l.to_lowercase().contains(&key))
        })
        .map(|s| s.as_str())
        .collect();

    if fresh.is_empty() {
        return Ok(0);
    }

    let tasks_path = domain_dir.join("_tasks.md");
    let mut content = existing.clone();
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    for t in &fresh {
        content.push_str(&format!("- [ ] {t}\n"));
    }
    std::fs::write(&tasks_path, &content).map_err(|e| format!("write _tasks.md: {e}"))?;

    Ok(fresh.len() as u64)
}

fn build_prompt(
    domain: &str,
    soul: &str,
    goals: &str,
    memory: &str,
    state_md: &str,
    existing: &str,
    today: &str,
    max: usize,
) -> String {
    let mut out = format!(
        "You are a proactive task-planning AI. Today is {today}.\n\
         Generate {max} specific, actionable tasks for the user's **{domain}** domain.\n\n\
         Rules:\n\
         - Each task must be concrete and completable in 1–7 days.\n\
         - Each task must have a due date as @YYYY-MM-DD (within 30 days of today).\n\
         - Do NOT duplicate any existing task.\n\
         - Output ONLY task lines, one per line: - [ ] task text @YYYY-MM-DD\n\
         - No explanations, headers, or extra text.\n"
    );
    if !soul.trim().is_empty() {
        out.push_str(&format!("\n--- About the user ---\n{}\n", cap(soul, 800)));
    }
    if !goals.trim().is_empty() {
        out.push_str(&format!("\n--- User goals ---\n{}\n", cap(goals, 1200)));
    }
    if !state_md.trim().is_empty() {
        out.push_str(&format!("\n--- Current {domain} state ---\n{}\n", cap(state_md, 1000)));
    }
    if !memory.trim().is_empty() {
        out.push_str(&format!("\n--- {domain} memory ---\n{}\n", cap(memory, 1200)));
    }
    if !existing.trim().is_empty() {
        out.push_str(&format!("\n--- Existing tasks (do NOT duplicate) ---\n{}\n", cap(existing, 1200)));
    }
    out.push_str(&format!("\nGenerate {max} new tasks:\n"));
    out
}

fn cap(s: &str, n: usize) -> String {
    s.trim().chars().take(n).collect()
}

fn parse_tasks(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|line| {
            let t = line.trim();
            let rest = t.strip_prefix("- [ ] ").or_else(|| t.strip_prefix("- [] "))?;
            let rest = rest.trim();
            if !rest.contains('@') { return None; }
            let at = rest.rfind('@')?;
            let date = &rest[at + 1..];
            if date.len() != 10 { return None; }
            if !date.chars().enumerate().all(|(i, c)| {
                if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() }
            }) { return None; }
            Some(rest.to_string())
        })
        .collect()
}

/// Read `_daemon.json` in `domain_dir` and return whether `key` ("taskgen" or
/// "reminders") is enabled. Defaults to `true` when the file is absent or the
/// key is missing, so domains work out-of-the-box with no config required.
pub fn domain_daemon_enabled(domain_dir: &Path, key: &str) -> bool {
    let path = domain_dir.join("_daemon.json");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return true; // no file → enabled by default
    };
    let Ok(map): Result<serde_json::Map<String, serde_json::Value>, _> = serde_json::from_str(&raw) else {
        return true;
    };
    map.get(key).and_then(|v| v.as_bool()).unwrap_or(true)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn taskgen_start(
    cfg: TaskGenConfig,
    state: tauri::State<'_, TaskGenState>,
) -> Result<(), String> {
    state.start(cfg).await;
    Ok(())
}

#[tauri::command]
pub async fn taskgen_stop(state: tauri::State<'_, TaskGenState>) -> Result<(), String> {
    state.stop().await;
    Ok(())
}

#[tauri::command]
pub async fn taskgen_status(
    state: tauri::State<'_, TaskGenState>,
) -> Result<TaskGenStatus, String> {
    Ok(state.status().await)
}

#[tauri::command]
pub async fn taskgen_run_once(
    cfg: TaskGenConfig,
) -> Result<u64, String> {
    // Manual trigger always bypasses the daily cursor so testing works.
    let (_, tasks) = run_once_inner(&cfg, true).await?;
    Ok(tasks)
}
