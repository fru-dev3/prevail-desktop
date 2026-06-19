// ─────────────────────────────────────────────────────────────────────────
// Vault Lock — the app-wide filesystem-scope guarantee.
//
// A SEPARATE dimension from Bunker Mode. Bunker decides which MODELS may run
// (local vs cloud). Vault Lock decides which FILES the assistant may touch:
//
//   • Vault Lock ON  → the engine and the agent CLIs may only read, write, and
//     list files inside the vault directory (its data/ and apps/). The rest of
//     the machine is off-limits: no scanning Documents, no opening arbitrary
//     paths, no shelling out to tools that reach beyond the vault.
//   • Vault Lock OFF → full local-machine access: the assistant may scan any
//     directory and use local tools across the filesystem.
//
// The two switches are orthogonal: any of the four combinations is valid
// (local model + vault-locked, cloud model + vault-locked, and so on).
//
// Default is ON for new installs (privacy-first, like Bunker): an absent flag
// file means locked. The engine subprocess is told (PREVAIL_VAULT_LOCK=1) to
// self-enforce, and the CLI bridge appends a hard scope rule to the agent's
// system prompt so the underlying agentic CLI stays inside the vault.
// ─────────────────────────────────────────────────────────────────────────

use std::path::PathBuf;
use std::sync::Mutex;

fn lock_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        std::path::Path::new(&home)
            .join("Library/Application Support/sh.prevail.desktop/vault-lock.txt"),
    )
}

// Cache the flag so per-call checks don't hit disk. `None` = not yet read.
static CACHE: Mutex<Option<bool>> = Mutex::new(None);

/// Is Vault Lock active? Default ON: an absent flag file (fresh install) means
/// locked. The file holds "1" (on) or "0" (off).
pub fn vault_lock_enabled() -> bool {
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(v) = *c {
        return v;
    }
    let v = match lock_path().and_then(|p| std::fs::read_to_string(p).ok()) {
        Some(s) => s.trim() != "0", // anything but explicit "0" stays locked
        None => true,               // new install → Vault Lock ON by default
    };
    *c = Some(v);
    v
}

fn set_lock(enabled: bool) {
    if let Some(p) = lock_path() {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&p, if enabled { "1" } else { "0" });
    }
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    *c = Some(enabled);
}

#[tauri::command]
pub fn vault_lock_status() -> serde_json::Value {
    let enabled = vault_lock_enabled();
    serde_json::json!({
        "enabled": enabled,
        "scope": if enabled { "vault-only" } else { "full-machine" },
    })
}

/// Flip Vault Lock. Persists immediately. Returns the fresh status.
#[tauri::command]
pub fn vault_lock_set(enabled: bool) -> serde_json::Value {
    set_lock(enabled);
    vault_lock_status()
}
