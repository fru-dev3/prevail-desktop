// Background journal distillation — the self-learning "memory" daemon.
//
// The intent ledger (<vault>/<domain>/_intents.jsonl, written by
// intent_append) is the append-only raw record of every turn. This daemon
// periodically reads the NEW, not-yet-distilled tail of each ledger and asks
// a cheap model to merge it into a compact long-term memory file
// (<vault>/<domain>/_memory.md), which is then prepended to future prompts
// (like user.md) so the assistant "remembers" across sessions.
//
// Design mirrors telegram_bridge.rs: a single background tokio task behind a
// Mutex'd DistillState, started/stopped on demand from the frontend. Progress
// per domain is tracked by a byte offset into the (append-only) ledger in
// <vault>/<domain>/_distill.json, advanced only after a successful write, so a
// crash mid-distill simply re-reads the same slice next tick (idempotent).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::async_runtime::JoinHandle;
use tokio::sync::{watch, Mutex as AsyncMutex};

#[derive(Clone, Debug, Deserialize)]
pub struct DistillConfig {
    pub vault: String,
    pub provider: String, // cli used to distill: claude | codex | ollama | …
    pub model: String,    // cheap model id, e.g. claude-haiku-4-5
    pub memory_budget_chars: usize,
    pub threshold: f64,       // distill once new chars ≥ threshold × budget
    pub target: f64,          // compress toward target × budget
    pub protected_recent: usize, // keep the most-recent N ledger records raw
    pub interval_sec: u64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct DistillStatus {
    pub running: bool,
    pub last_run_ts: Option<u64>,
    pub last_error: Option<String>,
    pub domains_distilled: u64,
    pub lines_distilled: u64,
}

#[derive(Serialize, Deserialize, Default, Clone)]
struct Cursor {
    #[serde(default)]
    byte_offset: u64,
    #[serde(default)]
    lines_distilled: u64,
    #[serde(default)]
    last_run_ts: u64,
    #[serde(default)]
    last_run_ok: bool,
    #[serde(default)]
    last_error: Option<String>,
}

pub struct DistillState {
    inner: Mutex<Inner>,
}

struct Inner {
    handle: Option<JoinHandle<()>>,
    stop_tx: Option<watch::Sender<bool>>,
    status: Arc<AsyncMutex<DistillStatus>>,
}

impl DistillState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                handle: None,
                stop_tx: None,
                status: Arc::new(AsyncMutex::new(DistillStatus::default())),
            }),
        }
    }

    pub async fn status(&self) -> DistillStatus {
        let arc = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).status.clone() };
        let s = arc.lock().await;
        s.clone()
    }

    pub async fn stop(&self) {
        let (tx, handle, arc) = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            (inner.stop_tx.take(), inner.handle.take(), inner.status.clone())
        };
        if let Some(tx) = tx {
            let _ = tx.send(true);
        }
        if let Some(h) = handle {
            h.abort();
        }
        arc.lock().await.running = false;
    }

    pub async fn start(&self, cfg: DistillConfig) {
        self.stop().await;
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let arc = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).status.clone() };
        {
            let mut s = arc.lock().await;
            *s = DistillStatus::default();
            s.running = true;
        }
        let status_for_task = arc.clone();
        let interval = Duration::from_secs(cfg.interval_sec.max(30));

        let handle = tauri::async_runtime::spawn(async move {
            loop {
                // Run a pass, then wait for the interval (or a stop signal).
                let res = run_once(&cfg).await;
                {
                    let mut s = status_for_task.lock().await;
                    s.last_run_ts = Some(now_secs());
                    match res {
                        Ok((domains, lines)) => {
                            s.domains_distilled += domains;
                            s.lines_distilled += lines;
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
            status_for_task.lock().await.running = false;
        });

        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.handle = Some(handle);
        inner.stop_tx = Some(stop_tx);
    }
}

// ─────────────────────────────────────────────────────────────────────
// One distillation pass across all domains. Returns (domains_distilled,
// lines_distilled).

async fn run_once(cfg: &DistillConfig) -> Result<(u64, u64), String> {
    let vault = PathBuf::from(&cfg.vault);
    if !vault.exists() {
        return Err(format!("vault not found: {}", cfg.vault));
    }
    let mut domains_done = 0u64;
    let mut lines_done = 0u64;
    for dir in ledger_dirs(&vault) {
        match distill_dir(&dir, cfg).await {
            Ok(n) if n > 0 => {
                domains_done += 1;
                lines_done += n;
            }
            Ok(_) => {}
            Err(e) => {
                // Record per-dir error in its cursor but keep going.
                let mut c = read_cursor(&dir);
                c.last_error = Some(e);
                c.last_run_ts = now_secs();
                c.last_run_ok = false;
                write_cursor(&dir, &c);
            }
        }
    }
    Ok((domains_done, lines_done))
}

// Distill one directory's ledger. Returns the number of ledger lines consumed.
async fn distill_dir(dir: &Path, cfg: &DistillConfig) -> Result<u64, String> {
    let ledger = dir.join("_intents.jsonl");
    if !ledger.exists() {
        return Ok(0);
    }
    let cursor = read_cursor(dir);
    let raw = std::fs::read(&ledger).map_err(|e| format!("read ledger: {e}"))?;
    if (cursor.byte_offset as usize) >= raw.len() {
        return Ok(0); // nothing new
    }
    let new_slice = String::from_utf8_lossy(&raw[cursor.byte_offset as usize..]).to_string();
    let (records, consumed_bytes) = plan_distill(&new_slice, cfg.protected_recent);
    if records.is_empty() {
        return Ok(0); // not enough new material past the protected tail
    }
    let activity = render_activity(&records);
    // Gate on threshold — don't burn a model call on a trivial slice.
    if (activity.len() as f64) < cfg.threshold * cfg.memory_budget_chars as f64 {
        return Ok(0);
    }

    let memory_path = dir.join("_memory.md");
    let existing = std::fs::read_to_string(&memory_path).unwrap_or_default();
    let domain_label = dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("General")
        .to_string();
    let prompt = build_distill_prompt(
        &domain_label,
        &existing,
        &activity,
        (cfg.target * cfg.memory_budget_chars as f64) as usize,
        cfg.memory_budget_chars,
    );

    let model = if cfg.model.is_empty() { None } else { Some(cfg.model.as_str()) };
    let out = crate::telegram_bridge::run_cli(&cfg.provider, model, &prompt).await?;
    let body = out.trim();
    if body.is_empty() {
        return Err("distill model produced no output".into());
    }
    let mut memory = format!("# Memory\n\n<!-- prevail:distilled — auto-generated; regenerated as new intents arrive -->\n\n{body}\n");
    if memory.chars().count() > cfg.memory_budget_chars {
        memory = memory.chars().take(cfg.memory_budget_chars).collect();
    }
    write_atomic(&memory_path, &memory).map_err(|e| format!("write _memory.md: {e}"))?;

    // Advance cursor only after the successful write.
    let line_count = records.len() as u64;
    let new_cursor = Cursor {
        byte_offset: cursor.byte_offset + consumed_bytes as u64,
        lines_distilled: cursor.lines_distilled + line_count,
        last_run_ts: now_secs(),
        last_run_ok: true,
        last_error: None,
    };
    write_cursor(dir, &new_cursor);
    Ok(line_count)
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (unit-tested).

/// From the new (post-cursor) ledger bytes, decide which complete records to
/// distill, keeping the most-recent `protected_recent` records raw. Returns
/// the parsed records to distill and the number of BYTES they occupy (so the
/// caller can advance the cursor exactly past them, never past the protected
/// tail or a partial trailing line still being written).
fn plan_distill(new_slice: &str, protected_recent: usize) -> (Vec<serde_json::Value>, usize) {
    // split_inclusive keeps the trailing '\n'; a final element without '\n'
    // is an in-progress write — exclude it (don't parse or consume it).
    let mut complete: Vec<(&str, usize)> = Vec::new(); // (json, byte_len incl. newline)
    for part in new_slice.split_inclusive('\n') {
        if part.ends_with('\n') {
            complete.push((part.trim_end_matches('\n'), part.len()));
        }
    }
    if complete.len() <= protected_recent {
        return (Vec::new(), 0);
    }
    let take = complete.len() - protected_recent;
    let mut records = Vec::with_capacity(take);
    let mut bytes = 0usize;
    for (line, len) in complete.iter().take(take) {
        bytes += len;
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            records.push(v);
        }
        // Corrupt lines still count toward bytes so the cursor moves past them.
    }
    (records, bytes)
}

/// Render intent/reply records as a compact "USER:/ASSISTANT:" transcript.
fn render_activity(records: &[serde_json::Value]) -> String {
    let mut out = String::new();
    for r in records {
        let kind = r.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if kind == "intent" {
            if let Some(m) = r.get("message").and_then(|v| v.as_str()) {
                out.push_str("USER: ");
                out.push_str(m.trim());
                out.push('\n');
            }
        } else if kind == "reply" {
            if let Some(raw) = r.get("raw").and_then(|v| v.as_str()) {
                let snippet: String = raw.trim().chars().take(600).collect();
                out.push_str("ASSISTANT: ");
                out.push_str(&snippet);
                out.push_str("\n\n");
            }
        }
    }
    out
}

fn build_distill_prompt(
    domain: &str,
    existing: &str,
    activity: &str,
    target_chars: usize,
    budget_chars: usize,
) -> String {
    let existing = if existing.trim().is_empty() { "(empty)" } else { existing.trim() };
    format!(
        "You maintain a compact long-term MEMORY for the user's \"{domain}\" space. \
Merge the NEW activity into the EXISTING memory. Compress aggressively: keep \
standing facts, preferences, decisions, and open threads; drop chit-chat and \
anything superseded. Aim for ~{target_chars} characters, hard maximum \
{budget_chars}. Output ONLY markdown under these headings: \
'## Standing context', '## Recent themes', '## Open threads'. No preamble.\n\n\
--- EXISTING MEMORY ---\n{existing}\n\n--- NEW ACTIVITY ---\n{activity}"
    )
}

fn ledger_dirs(vault: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    // No-domain (General) ledger at the vault root.
    if vault.join("_intents.jsonl").exists() {
        dirs.push(vault.to_path_buf());
    }
    if let Ok(rd) = std::fs::read_dir(vault) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() && p.join("_intents.jsonl").exists() {
                dirs.push(p);
            }
        }
    }
    dirs
}

fn read_cursor(dir: &Path) -> Cursor {
    std::fs::read_to_string(dir.join("_distill.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_cursor(dir: &Path, c: &Cursor) {
    if let Ok(s) = serde_json::to_string_pretty(c) {
        let _ = write_atomic(&dir.join("_distill.json"), &s);
    }
}

// Write via temp + rename so concurrent readers never see a half-written file.
fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, path)
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ─────────────────────────────────────────────────────────────────────
// Tauri commands.

#[tauri::command]
pub async fn distill_start(
    state: tauri::State<'_, DistillState>,
    cfg: DistillConfig,
) -> Result<(), String> {
    state.start(cfg).await;
    Ok(())
}

#[tauri::command]
pub async fn distill_stop(state: tauri::State<'_, DistillState>) -> Result<(), String> {
    state.stop().await;
    Ok(())
}

#[tauri::command]
pub async fn distill_status(
    state: tauri::State<'_, DistillState>,
) -> Result<DistillStatus, String> {
    Ok(state.status().await)
}

/// Run a single distillation pass now (the "Distill now" button). Returns the
/// number of ledger lines consumed across all domains.
#[tauri::command]
pub async fn distill_run_once(cfg: DistillConfig) -> Result<u64, String> {
    let (_domains, lines) = run_once(&cfg).await?;
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(kind: &str, body: &str) -> String {
        match kind {
            "intent" => format!("{{\"kind\":\"intent\",\"message\":\"{body}\"}}\n"),
            _ => format!("{{\"kind\":\"reply\",\"raw\":\"{body}\"}}\n"),
        }
    }

    #[test]
    fn plan_distill_respects_protected_tail_and_partial_lines() {
        // 4 complete records + 1 partial (in-progress) line.
        let mut slice = String::new();
        slice.push_str(&line("intent", "a"));
        slice.push_str(&line("reply", "A"));
        slice.push_str(&line("intent", "b"));
        slice.push_str(&line("reply", "B"));
        slice.push_str("{\"kind\":\"intent\",\"message\":\"partial"); // no newline

        // Protect the last 2 complete records → distill only the first 2.
        let (records, bytes) = plan_distill(&slice, 2);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["message"], "a");
        assert_eq!(records[1]["raw"], "A");
        // Consumed bytes == exactly the first two complete lines (so the cursor
        // never advances past the protected tail or the partial line).
        let expected = line("intent", "a").len() + line("reply", "A").len();
        assert_eq!(bytes, expected);

        // With protected_recent >= complete count, nothing is distilled.
        let (none, zero) = plan_distill(&slice, 4);
        assert!(none.is_empty());
        assert_eq!(zero, 0);
    }

    #[test]
    fn render_activity_formats_pairs() {
        let recs = vec![
            serde_json::json!({"kind":"intent","message":"hi there"}),
            serde_json::json!({"kind":"reply","raw":"hello back"}),
        ];
        let s = render_activity(&recs);
        assert!(s.contains("USER: hi there"));
        assert!(s.contains("ASSISTANT: hello back"));
    }

    #[test]
    fn ledger_dirs_finds_root_and_subdirs() {
        let base = std::env::temp_dir().join(format!("prevail-distill-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("wealth")).unwrap();
        std::fs::write(base.join("_intents.jsonl"), "{}\n").unwrap();
        std::fs::write(base.join("wealth").join("_intents.jsonl"), "{}\n").unwrap();
        std::fs::create_dir_all(base.join("empty")).unwrap();
        let dirs = ledger_dirs(&base);
        assert_eq!(dirs.len(), 2); // root + wealth, not empty
        let _ = std::fs::remove_dir_all(&base);
    }
}
