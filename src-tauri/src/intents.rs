// Intent ledger — the self-learning core. A chat IS an intent, and intents
// must never be lost. Every turn appends one JSON line to
// <vault>/<domain>/_intents.jsonl (<vault>/_intents.jsonl for the no-domain
// General space) the instant it happens: on send (the exact prompt) and on
// completion (the raw, unprocessed reply). Append-only, never overwritten —
// this is the rebuild-from-scratch source of truth. Each record carries the
// domain, model, and every preference in effect, so a future (better) model
// can be re-run against the original intent and the result rebuilt.
//
// Also home to the decision log (_decisions.jsonl) and the auto-built journal
// (_journal.md). Extracted from lib.rs. Path-safety lives in paths.rs.

use std::fs;
use std::path::PathBuf;

use crate::engine;
use crate::paths::domain_dir;
use crate::{read_dir_retry, read_to_string_retry};

#[tauri::command]
pub(crate) fn intent_append(
    vault: String,
    domain: Option<String>,
    record: serde_json::Value,
) -> Result<(), String> {
    let dir = domain_dir(&vault, &domain);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir intents: {e}"))?;
    let file = dir.join("_intents.jsonl");
    let line = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    engine::vault_append_line(&file, &format!("{line}\n")).map_err(|e| format!("write intent: {e}"))?;
    Ok(())
}

/// I6: read back the intents ledger so the desktop can surface it (newest
/// first). Each line is an "intent" record written by `intent_append` the
/// instant a chat is sent — what the user asked + the prefs in effect.
#[tauri::command]
pub(crate) fn intents_read(
    vault: String,
    domain: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = domain_dir(&vault, &domain);
    let file = dir.join("_intents.jsonl");
    let text = match read_to_string_retry(&file) {
        Ok(t) => t,
        Err(_) => return Ok(vec![]),
    };
    let mut out: Vec<serde_json::Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        // Only the "intent" kind (the ledger also carries other record kinds).
        .filter(|v: &serde_json::Value| v.get("kind").and_then(|k| k.as_str()) == Some("intent"))
        .collect();
    out.reverse(); // newest first
    if let Some(n) = limit {
        out.truncate(n);
    }
    Ok(out)
}

/// Append a human-readable line to the domain journal so the journal is
/// built automatically from every conversation — not only when the user
/// manually clicks "New chat". Newest entries go directly under the header.
#[tauri::command]
pub(crate) fn journal_append(vault: String, domain: Option<String>, entry: String) -> Result<(), String> {
    let dir = domain_dir(&vault, &domain);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir journal: {e}"))?;
    let path = dir.join("_journal.md");
    const HEADER: &str = "# Journal\n\n";
    let existing = read_to_string_retry(&path).unwrap_or_default();
    let body = existing.strip_prefix(HEADER).unwrap_or(&existing).to_string();
    let merged = format!("{HEADER}{}\n{body}", entry.trim_end());
    fs::write(&path, engine::maybe_encrypt(&path, &merged)).map_err(|e| format!("write journal: {e}"))?;
    Ok(())
}

/// Every intent across the whole vault (each domain's _intents.jsonl plus the
/// vault-root general ledger), tagged with its domain, newest first. Powers the
/// Settings > Intents browser.
#[tauri::command]
pub(crate) fn intents_read_all(vault: String, limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    let root = PathBuf::from(&vault);
    let mut dirs: Vec<(String, PathBuf)> = vec![("general".into(), root.clone())];
    if let Ok(it) = read_dir_retry(&root) {
        for e in it.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() && !name.starts_with('.') && !name.starts_with('_') {
                dirs.push((name, p));
            }
        }
    }
    let mut out: Vec<serde_json::Value> = Vec::new();
    for (dom, dir) in dirs {
        let Ok(text) = read_to_string_retry(&dir.join("_intents.jsonl")) else { continue };
        for l in text.lines().filter(|l| !l.trim().is_empty()) {
            let Ok(mut v) = serde_json::from_str::<serde_json::Value>(l) else { continue };
            if v.get("kind").and_then(|k| k.as_str()) != Some("intent") {
                continue;
            }
            if let Some(obj) = v.as_object_mut() {
                obj.insert("domain".into(), serde_json::json!(dom));
            }
            out.push(v);
        }
    }
    out.sort_by_key(|v| std::cmp::Reverse(v.get("ts").and_then(|t| t.as_i64()).unwrap_or(0)));
    if let Some(n) = limit {
        out.truncate(n);
    }
    Ok(out)
}

/// Append a DECISION to the domain's append-only decision log
/// (`<domain>/_decisions.jsonl`). A council verdict, an accepted recommendation,
/// or a user-stated preference ("make Mayo my favorite hospital") is a decision
/// — durable, provenance-tagged, and fed into state derivation + scoring so the
/// domain actually learns. Mirrors `intent_append`. (feedback v0.4.1 I1/I5)
#[tauri::command]
pub(crate) fn decision_append(
    vault: String,
    domain: Option<String>,
    record: serde_json::Value,
) -> Result<(), String> {
    let dir = domain_dir(&vault, &domain);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir decisions: {e}"))?;
    let file = dir.join("_decisions.jsonl");
    let line = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    engine::vault_append_line(&file, &format!("{line}\n")).map_err(|e| format!("write decision: {e}"))?;
    Ok(())
}

/// Read the domain's decision log (newest first), capped at `limit`. Used by
/// the Insights surface + to attach a feedback rating to a prior verdict.
#[tauri::command]
pub(crate) fn decisions_read(
    vault: String,
    domain: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = domain_dir(&vault, &domain);
    let file = dir.join("_decisions.jsonl");
    let text = match read_to_string_retry(&file) {
        Ok(t) => t,
        Err(_) => return Ok(vec![]),
    };
    let mut out: Vec<serde_json::Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    out.reverse(); // newest first
    if let Some(n) = limit {
        out.truncate(n);
    }
    Ok(out)
}

/// Attach a thumbs up/down (and optional note) to a recorded decision, keyed by
/// its `id`. Rewrites the JSONL with the matching record's `feedback` set so the
/// distiller/learning loop can prefer the model+framework+lens combos that
/// produced liked verdicts. (feedback v0.4.1 I5)
#[tauri::command]
pub(crate) fn decision_feedback(
    vault: String,
    domain: Option<String>,
    id: String,
    rating: String, // "up" | "down" | "clear"
    note: Option<String>,
) -> Result<(), String> {
    let dir = domain_dir(&vault, &domain);
    let file = dir.join("_decisions.jsonl");
    let text = read_to_string_retry(&file).map_err(|e| format!("read _decisions.jsonl: {e}"))?;
    let mut lines: Vec<serde_json::Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    let mut found = false;
    for rec in lines.iter_mut() {
        if rec.get("id").and_then(|v| v.as_str()) == Some(id.as_str()) {
            if let Some(obj) = rec.as_object_mut() {
                if rating == "clear" {
                    obj.remove("feedback");
                } else {
                    obj.insert(
                        "feedback".into(),
                        serde_json::json!({ "rating": rating, "note": note }),
                    );
                }
            }
            found = true;
            break;
        }
    }
    if !found {
        return Err(format!("decision not found: {id}"));
    }
    let body: String = lines
        .iter()
        .filter_map(|r| serde_json::to_string(r).ok())
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&file, engine::maybe_encrypt(&file, &format!("{body}\n"))).map_err(|e| format!("write _decisions.jsonl: {e}"))?;
    Ok(())
}
