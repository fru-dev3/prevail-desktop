// Vault consolidation: move the duplicate root-level domains/ and apps/ into the
// canonical <vault>/data/ container. Per the rule, data/ holds ONLY apps + domains;
// the General bucket's loose files stay at the vault root (untouched).
//
// SAFE by design (Hard Rule: never lose user data):
//   * copy only, recursively, file by file,
//   * NEVER overwrites a file that already exists at the destination,
//   * leaves every original in place (the user deletes the old copies later),
//   * dry-run first (`vault_consolidate_plan`), apply on confirm.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct ConsolidateOp {
    pub from: String,
    pub to: String,
    pub label: String, // short, human: "domains/wealth/_state.md"
    pub applied: bool,
}

// Plan every file copy under `from` -> `to` whose destination is ABSENT. Recurses
// directories; only ever proposes copies that don't clobber existing data.
fn plan_copy(from: &Path, to: &Path, rel: &str, ops: &mut Vec<ConsolidateOp>) {
    if from.is_dir() {
        let Ok(rd) = std::fs::read_dir(from) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            plan_copy(&e.path(), &to.join(&name), &child_rel, ops);
        }
    } else if from.is_file() && !to.exists() {
        ops.push(ConsolidateOp {
            from: from.to_string_lossy().to_string(),
            to: to.to_string_lossy().to_string(),
            label: rel.to_string(),
            applied: false,
        });
    }
}

/// Dry run: every copy the consolidation would make to reach the canonical data/
/// layout. No disk changes.
#[tauri::command]
pub fn vault_consolidate_plan(vault: String) -> Result<Vec<ConsolidateOp>, String> {
    let root = PathBuf::from(&vault);
    let data = root.join("data");
    let mut ops: Vec<ConsolidateOp> = Vec::new();
    // ONLY domains + apps belong in data/. Merge any root-level copies in (missing
    // files only); General loose files at the root are intentionally left alone.
    plan_copy(&root.join("domains"), &data.join("domains"), "domains", &mut ops);
    plan_copy(&root.join("apps"), &data.join("apps"), "apps", &mut ops);
    Ok(ops)
}

/// Apply the plan: copy each file to its canonical home under data/. Creates parent
/// dirs, never overwrites, leaves originals. Returns the ops actually applied.
#[tauri::command]
pub fn vault_consolidate_apply(vault: String) -> Result<Vec<ConsolidateOp>, String> {
    let mut ops = vault_consolidate_plan(vault)?;
    for op in ops.iter_mut() {
        let to = Path::new(&op.to);
        if to.exists() || !Path::new(&op.from).exists() {
            continue; // guard re-checked at apply time
        }
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        std::fs::copy(&op.from, &op.to).map_err(|e| format!("copy {}: {e}", op.label))?;
        // Verify the copy landed byte-for-byte (size check) before claiming success.
        let ok = std::fs::metadata(&op.from).map(|m| m.len()).ok() == std::fs::metadata(to).map(|m| m.len()).ok();
        if !ok {
            return Err(format!("verify failed for {}", op.label));
        }
        op.applied = true;
    }
    Ok(ops.into_iter().filter(|o| o.applied).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn moves_only_domains_and_apps_into_data_never_overwrites() {
        let vault = std::env::temp_dir().join(format!("prevail-consolidate-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        // Root-level duplicates: a domain + an app, plus a loose General file that
        // must be LEFT ALONE (data/ holds only apps + domains).
        fs::create_dir_all(vault.join("domains").join("wealth")).unwrap();
        fs::write(vault.join("domains").join("wealth").join("_state.md"), "wealth state").unwrap();
        fs::create_dir_all(vault.join("apps").join("paypal")).unwrap();
        fs::write(vault.join("apps").join("paypal").join("manifest.json"), "{}").unwrap();
        fs::write(vault.join("_journal.md"), "# Journal").unwrap();
        // data/ already has the domain file with different content -> must NOT overwrite.
        fs::create_dir_all(vault.join("data").join("domains").join("wealth")).unwrap();
        fs::write(vault.join("data").join("domains").join("wealth").join("_state.md"), "KEEP").unwrap();

        let v = vault.to_string_lossy().to_string();
        let plan = vault_consolidate_plan(v.clone()).unwrap();
        assert!(plan.iter().any(|o| o.label == "apps/paypal/manifest.json"));
        assert!(!plan.iter().any(|o| o.label == "domains/wealth/_state.md"), "must not overwrite existing");
        assert!(!plan.iter().any(|o| o.label.contains("journal")), "General loose files stay at root");

        let done = vault_consolidate_apply(v).unwrap();
        assert!(done.iter().any(|o| o.label == "apps/paypal/manifest.json"));
        assert_eq!(fs::read_to_string(vault.join("data").join("apps").join("paypal").join("manifest.json")).unwrap(), "{}");
        assert!(vault.join("apps").join("paypal").join("manifest.json").exists(), "original kept");
        assert!(!vault.join("data").join("_journal.md").exists(), "General files not moved into data/");
        assert_eq!(fs::read_to_string(vault.join("data").join("domains").join("wealth").join("_state.md")).unwrap(), "KEEP");
        let _ = fs::remove_dir_all(&vault);
    }
}
