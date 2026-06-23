// vaultio — the single crypto-aware, atomic, locked vault I/O layer (C4 / B6).
//
// Every vault write should go through `write_atomic`: it encrypts (when the vault
// is unlocked + encrypted), writes to a temp file, renames it over the target
// (so a concurrent reader never sees a half-written file), keeps a `.bak` of the
// prior content, and serializes concurrent writers to the same path with a
// per-path lock (so the UI and background daemons can't clobber each other's
// read-modify-write). Reads go through `read`, which transparently decrypts.
//
// This generalizes the previously file-local `distill::write_atomic` and
// `lib::read_to_string_retry`, and adds the per-path locking the audit found
// missing (B6 / O70 read-asymmetry, O71 non-atomic writes, O96 no-single-writer).
//
// NOTE: callers doing read-modify-write must still refuse to write back content
// they failed to parse/decrypt (so a transient decrypt failure can't overwrite a
// good sealed file with garbage). `write_atomic` cannot detect that for them.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// One advisory lock per absolute path, created on demand. Serializes the whole
/// back-up → encrypt → temp → rename sequence for a given file so two writers
/// (e.g. the desktop UI and the loops daemon) can't interleave and clobber.
fn lock_for(path: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    let map = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut g = map.lock().unwrap_or_else(|e| e.into_inner());
    g.entry(path.to_path_buf())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

// Reads use the existing canonical `crate::read_to_string_retry` (retry +
// transparent decrypt) — call sites use it directly; vaultio owns the write side.

/// Atomically + crypto-aware write a vault file. Holds the per-path lock for the
/// whole sequence. Pass PLAIN content — encryption is applied here when the vault
/// is unlocked + encrypted.
pub(crate) fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let lock = lock_for(path);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    // Keep a .bak of the prior on-disk content so a crash mid-write is
    // recoverable. Best-effort: a missing .bak must not block the write.
    if path.exists() {
        let _ = std::fs::copy(path, path.with_extension("bak"));
    }
    let sealed = crate::engine::maybe_encrypt(path, contents);
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, sealed)?;
    std::fs::rename(&tmp, path)
}

/// Append a line to a vault ledger, crypto-aware and under the per-path lock so
/// the decrypt → append → re-encrypt read-modify-write cannot race another writer.
pub(crate) fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    let lock = lock_for(path);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    crate::engine::vault_append_line(path, line)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Plaintext vault (no session key set) → write is a passthrough, but the
    // atomicity + .bak behavior is exercised without touching process-global key
    // state (which would race other tests).
    #[test]
    fn write_atomic_roundtrips_and_keeps_bak() {
        let dir = std::env::temp_dir().join(format!("prevail-vaultio-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("note.md");

        write_atomic(&f, "first").unwrap();
        assert_eq!(crate::read_to_string_retry(&f).unwrap(),"first");
        assert!(!f.with_extension("bak").exists(), "no .bak before the second write");

        write_atomic(&f, "second").unwrap();
        assert_eq!(crate::read_to_string_retry(&f).unwrap(),"second");
        // The .bak holds the prior content, so a crash mid-write is recoverable.
        assert_eq!(std::fs::read_to_string(f.with_extension("bak")).unwrap(), "first");
        // No leftover temp file after a successful rename.
        assert!(!f.with_extension("tmp").exists(), "temp file removed by rename");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn append_line_accumulates() {
        let dir = std::env::temp_dir().join(format!("prevail-vaultio-app-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("ledger.jsonl");
        append_line(&f, "a").unwrap();
        append_line(&f, "b").unwrap();
        let body = crate::read_to_string_retry(&f).unwrap();
        assert!(body.contains('a') && body.contains('b'));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
