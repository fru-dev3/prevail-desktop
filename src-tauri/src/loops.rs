// Desktop bridge for the Domain Loops runner.
//
// The loop-running logic lives in the engine (daemon-loops.ts) so there is a
// single source of truth. This command just triggers one pass on demand from
// the UI ("Run loops now"): it shells to the bundled engine with
// `--vault <path> daemon --loops --once`, which advances every due loop and
// rewrites their actions. The long-running background daemon is the same engine
// command without `--once`.
use crate::engine;

#[tauri::command]
pub(crate) async fn loops_run_once(
    vault: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args: Vec<String> = vec![
            "--vault".into(),
            vault,
            "daemon".into(),
            "--loops".into(),
            "--once".into(),
        ];
        if let Some(p) = provider {
            if !p.trim().is_empty() {
                args.push("--cli".into());
                args.push(p);
            }
        }
        if let Some(m) = model {
            if !m.trim().is_empty() {
                args.push("--model".into());
                args.push(m);
            }
        }
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        engine::run_engine_raw(&refs)
    })
    .await
    .map_err(|e| format!("loops task failed: {e}"))?
}
