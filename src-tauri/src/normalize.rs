// Vault normalizer: align a domain's context files to Prevail's canonical names so
// the app reads them. Some vaults (imported, hand-made, or older) name files
// differently - e.g. MEMORY.md instead of _memory.md, state.md instead of
// _state.md - which makes the Context panel show blanks even though the data is
// right there. This finds those and COPIES them to the canonical name.
//
// SAFE by design (Hard Rule: never lose user data):
//   * copy only - the original file is always kept,
//   * never overwrites an existing canonical file,
//   * dry-run first (`vault_normalize_plan`); apply only on the user's confirm.

use serde::Serialize;
use std::path::{Path, PathBuf};

// Variant filename -> canonical filename. Both upper/lower variants are listed so
// a case-sensitive filesystem is covered too (on case-insensitive macOS the two
// collapse to one source, and the dst-exists guard makes that idempotent).
const RENAMES: &[(&str, &str)] = &[
    ("MEMORY.md", "_memory.md"),
    ("memory.md", "_memory.md"),
    ("STATE.md", "_state.md"),
    ("state.md", "_state.md"),
    ("JOURNAL.md", "_journal.md"),
    ("journal.md", "_journal.md"),
    ("DECISIONS.jsonl", "_decisions.jsonl"),
    ("decisions.jsonl", "_decisions.jsonl"),
    ("INTENTS.jsonl", "_intents.jsonl"),
    ("intents.jsonl", "_intents.jsonl"),
];

#[derive(Serialize, Clone)]
pub struct NormalizeOp {
    pub domain: String,
    pub from: String, // absolute path of the variant file
    pub to: String,   // absolute path of the canonical file it will be copied to
    pub from_name: String,
    pub to_name: String,
    pub applied: bool,
}

fn plan_for_dir(name: &str, dir: &Path, ops: &mut Vec<NormalizeOp>) {
    for (from, to) in RENAMES {
        if from == to {
            continue;
        }
        let src = dir.join(from);
        let dst = dir.join(to);
        // Only when the variant exists AND the canonical doesn't (never overwrite),
        // and they aren't the same file (case-insensitive FS resolving from==to).
        if src.exists() && !dst.exists() && src != dst {
            ops.push(NormalizeOp {
                domain: name.to_string(),
                from: src.to_string_lossy().to_string(),
                to: dst.to_string_lossy().to_string(),
                from_name: (*from).to_string(),
                to_name: (*to).to_string(),
                applied: false,
            });
        }
    }
}

/// Dry run: every copy the normalizer WOULD make, without touching the disk.
#[tauri::command]
pub fn vault_normalize_plan(vault: String) -> Result<Vec<NormalizeOp>, String> {
    let mut ops: Vec<NormalizeOp> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (name, dir) in crate::paths::enumerate_domain_dirs(Path::new(&vault)) {
        if seen.insert(dir.to_string_lossy().to_string()) {
            plan_for_dir(&name, &dir, &mut ops);
        }
    }
    // General lives at the vault root (and build/ once tidied).
    plan_for_dir("General", Path::new(&vault), &mut ops);
    let b = crate::paths::build_root(&vault);
    if b != PathBuf::from(&vault) {
        plan_for_dir("General", &b, &mut ops);
    }
    Ok(ops)
}

/// Apply the plan: copy each variant file to its canonical name. Originals are
/// kept; nothing is deleted or overwritten. Returns the ops actually applied.
#[tauri::command]
pub fn vault_normalize_apply(vault: String) -> Result<Vec<NormalizeOp>, String> {
    let mut ops = vault_normalize_plan(vault)?;
    for op in ops.iter_mut() {
        // Re-check the guard at apply time (the plan may be a moment stale).
        if Path::new(&op.to).exists() || !Path::new(&op.from).exists() {
            continue;
        }
        std::fs::copy(&op.from, &op.to).map_err(|e| format!("copy {} -> {}: {e}", op.from_name, op.to_name))?;
        op.applied = true;
    }
    Ok(ops.into_iter().filter(|o| o.applied).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn copies_variant_names_to_canonical_never_deletes() {
        let vault = std::env::temp_dir().join(format!("prevail-normalize-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        let d = vault.join("domains").join("wealth");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("_state.md"), "# domain").unwrap(); // makes it a domain
        fs::write(d.join("MEMORY.md"), "remembered things").unwrap();
        fs::write(d.join("state.md"), "old state").unwrap(); // _state.md exists -> must be SKIPPED

        let plan = vault_normalize_plan(vault.to_string_lossy().to_string()).unwrap();
        // MEMORY.md -> _memory.md is planned; state.md -> _state.md is NOT (target exists).
        assert!(plan.iter().any(|o| o.from_name == "MEMORY.md"), "plan: {:?}", plan.iter().map(|o| &o.from_name).collect::<Vec<_>>());
        assert!(!plan.iter().any(|o| o.to_name == "_state.md"), "must not overwrite existing _state.md");

        let done = vault_normalize_apply(vault.to_string_lossy().to_string()).unwrap();
        assert!(done.iter().any(|o| o.to_name == "_memory.md"));
        // canonical now exists, original kept, existing _state.md untouched.
        assert_eq!(fs::read_to_string(d.join("_memory.md")).unwrap(), "remembered things");
        assert!(d.join("MEMORY.md").exists(), "original must be kept");
        assert_eq!(fs::read_to_string(d.join("_state.md")).unwrap(), "# domain", "existing canonical untouched");
        let _ = fs::remove_dir_all(&vault);
    }
}
