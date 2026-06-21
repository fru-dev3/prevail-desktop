// Intent-distillation daemon — keeps the high-level intents fresh automatically,
// with NO manual button press. Mirrors distill.rs: a single background tokio task
// behind a Mutex'd state, started/stopped from the frontend.
//
// It re-distills when EITHER condition fires (whichever comes first):
//   * enough NEW prompts have accumulated since the last pass (min_new_prompts), or
//   * the last pass is older than max_age_sec (e.g. daily).
// A checkpoint in <vault>/_meta/intents_distill_checkpoint.json (the native
// ledger count + a PER-STREAM line offset for each captured prompts.<tool>.jsonl
// + last-run timestamp) makes this idempotent and cheap: a check that finds
// nothing new costs only a ledger count + line counts, never a model call. New
// prompts from any source (the native chat ledger OR any captured CLI stream)
// count toward the trigger. (Named "checkpoint", not "cursor", to avoid reading
// as the Cursor editor.)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::async_runtime::JoinHandle;
use tokio::sync::{watch, Mutex as AsyncMutex};

#[derive(Clone, Debug, Deserialize)]
pub struct IntentDaemonConfig {
    pub vault: String,
    pub provider: String,
    pub model: String,
    pub interval_sec: u64,      // how often to CHECK (cheap; a model call only on trigger)
    pub min_new_prompts: usize, // distill after this many new prompts since last pass
    pub max_age_sec: u64,       // OR distill if the last pass is older than this (daily = 86400)
    pub limit: usize,           // how many recent prompts to feed the model
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct IntentDaemonStatus {
    pub running: bool,
    pub last_run_ts: Option<u64>,
    pub last_error: Option<String>,
    pub distills: u64,            // successful distill passes this session
    pub last_intent_count: u64,   // intents produced by the most recent pass
}

#[derive(Serialize, Deserialize, Default, Clone)]
struct DistillCheckpoint {
    /// Native intent-ledger count at the last pass.
    #[serde(default)]
    last_count: usize,
    #[serde(default)]
    last_run_ts: u64,
    /// Per capture-stream line offset already accounted for: filename -> lines.
    #[serde(default)]
    streams: std::collections::BTreeMap<String, usize>,
}

fn checkpoint_path(vault: &str) -> PathBuf {
    crate::paths::build_root(vault).join("_meta").join("intents_distill_checkpoint.json")
}
/// Legacy file from before per-stream offsets existed; read once for migration.
fn legacy_cursor_path(vault: &str) -> PathBuf {
    crate::paths::build_root(vault).join("_meta").join("intents_distill_cursor.json")
}
fn read_checkpoint(vault: &str) -> DistillCheckpoint {
    if let Some(cp) = std::fs::read_to_string(checkpoint_path(vault))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
    {
        return cp;
    }
    // Migrate the old {last_count,last_run_ts} cursor (streams default to empty,
    // so already-captured prompts count as "new" once, a harmless one-time
    // re-distill that folds the capture streams in).
    std::fs::read_to_string(legacy_cursor_path(vault))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}
fn write_checkpoint(vault: &str, c: &DistillCheckpoint) {
    let p = checkpoint_path(vault);
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(body) = serde_json::to_string(c) {
        let _ = std::fs::write(&p, body);
    }
}
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// One check. Returns Some(intent_count) if it ran a distill, None if it skipped
/// (nothing new / not yet due).
async fn run_once(cfg: &IntentDaemonConfig) -> Result<Option<u64>, String> {
    let ledger_count = crate::intents::count_intents(&cfg.vault);
    let stream_counts = crate::intents::capture_stream_line_counts(&cfg.vault);
    let stream_total: usize = stream_counts.values().sum();
    if ledger_count == 0 && stream_total == 0 {
        return Ok(None);
    }
    let cp = read_checkpoint(&cfg.vault);
    let now = now_secs();
    // New prompts = ledger growth + growth of EACH capture stream since its
    // recorded offset (a brand-new stream counts all its lines as new).
    let new_ledger = ledger_count.saturating_sub(cp.last_count);
    let new_streams: usize = stream_counts
        .iter()
        .map(|(name, n)| n.saturating_sub(*cp.streams.get(name).unwrap_or(&0)))
        .sum();
    let new_prompts = new_ledger + new_streams;
    let aged = cp.last_run_ts == 0 || now.saturating_sub(cp.last_run_ts) >= cfg.max_age_sec;
    let enough = new_prompts >= cfg.min_new_prompts.max(1);
    if !(aged || enough) {
        return Ok(None);
    }
    let doc =
        crate::intents::distill_intents_core(&cfg.vault, &cfg.provider, &cfg.model, cfg.limit).await?;
    let n = doc
        .get("intents")
        .and_then(|a| a.as_array())
        .map(|a| a.len())
        .unwrap_or(0) as u64;
    write_checkpoint(
        &cfg.vault,
        &DistillCheckpoint { last_count: ledger_count, last_run_ts: now, streams: stream_counts },
    );
    Ok(Some(n))
}

pub struct IntentDaemonState {
    inner: Mutex<Inner>,
}
struct Inner {
    handle: Option<JoinHandle<()>>,
    stop_tx: Option<watch::Sender<bool>>,
    status: Arc<AsyncMutex<IntentDaemonStatus>>,
}

impl IntentDaemonState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                handle: None,
                stop_tx: None,
                status: Arc::new(AsyncMutex::new(IntentDaemonStatus::default())),
            }),
        }
    }
    pub async fn status(&self) -> IntentDaemonStatus {
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
    pub async fn start(&self, cfg: IntentDaemonConfig) {
        self.stop().await;
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let arc = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).status.clone() };
        {
            let mut s = arc.lock().await;
            *s = IntentDaemonStatus::default();
            s.running = true;
        }
        let status_for_task = arc.clone();
        let interval = Duration::from_secs(cfg.interval_sec.max(60));
        let handle = tauri::async_runtime::spawn(async move {
            loop {
                let res = run_once(&cfg).await;
                {
                    let mut s = status_for_task.lock().await;
                    match res {
                        Ok(Some(n)) => {
                            s.last_run_ts = Some(now_secs());
                            s.distills += 1;
                            s.last_intent_count = n;
                            s.last_error = None;
                        }
                        Ok(None) => {} // skipped: nothing new / not due
                        Err(e) => s.last_error = Some(e),
                    }
                }
                tokio::select! {
                    _ = stop_rx.changed() => { if *stop_rx.borrow() { break; } }
                    _ = tokio::time::sleep(interval) => {}
                }
            }
        });
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.handle = Some(handle);
        inner.stop_tx = Some(stop_tx);
    }
}

#[tauri::command]
pub async fn intent_daemon_start(
    state: tauri::State<'_, IntentDaemonState>,
    cfg: IntentDaemonConfig,
) -> Result<(), String> {
    state.start(cfg).await;
    Ok(())
}

#[tauri::command]
pub async fn intent_daemon_stop(
    state: tauri::State<'_, IntentDaemonState>,
) -> Result<(), String> {
    state.stop().await;
    Ok(())
}

#[tauri::command]
pub async fn intent_daemon_status(
    state: tauri::State<'_, IntentDaemonState>,
) -> Result<IntentDaemonStatus, String> {
    Ok(state.status().await)
}
