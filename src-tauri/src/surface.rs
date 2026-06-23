// Proactive "Surface" — the engine looking at a domain's data and bringing
// things up for you: questions worth asking + suggested next actions/goals.
//
// Reads a domain's distilled memory, state, and recent intents, asks a cheap
// model to surface what you should notice/do, and caches the result at
// <vault>/<domain>/_surface.json (regenerated on demand or when stale). The
// desktop shows these on the domain home; clicking one seeds the composer.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct SurfaceResult {
    pub questions: Vec<String>,
    pub actions: Vec<String>,
    #[serde(default)]
    pub generated_at: i64, // epoch ms
    #[serde(default)]
    pub stale: bool, // true when returned cache is older than the TTL
}

const TTL_MS: i64 = 6 * 60 * 60 * 1000; // 6h

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// Per-domain privacy.localOnly (manifest.json), honored in addition to global
// Bunker so a domain flagged local-only never reaches a cloud model (O33).
fn domain_local_only(dir: &Path) -> bool {
    crate::read_to_string_retry(dir.join("manifest.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| {
            v.get("privacy")
                .and_then(|p| p.get("localOnly"))
                .and_then(|b| b.as_bool())
        })
        .unwrap_or(false)
}

// Build the proactive prompt from a domain's vault context.
fn build_prompt(domain: &str, context: &str) -> String {
    format!(
        "You are an expert {domain} coach reviewing this person's \"{domain}\" space. \
Talk like a sharp, practical human advisor — never like a system reporting file \
status. Based ONLY on the context below, return STRICT JSON (no prose, no code \
fence): {{\"questions\": [3-5 sharp, specific questions worth resolving that \
reference their actual situation], \"actions\": [3-5 concrete, high-leverage next \
steps]}}.\n\
RULES for actions: each must be specific and doable — name the exact document to \
add, the data to gather, the decision to make, or the task to schedule. If \
something important is MISSING, turn it into a concrete fetch/add step (e.g. \
\"Add your latest bank statement to set a net-worth baseline\" — NOT \"add more \
data\" or \"knowledge files are thin\"). Build on decisions already made; never \
re-ask a settled question. Keep each item under ~110 chars.\n\n--- CONTEXT ---\n{context}"
    )
}

// Gather a compact context blob: distilled memory + state + recent intents.
fn gather_context(dir: &Path) -> String {
    let mut out = String::new();
    let read_head = |p: PathBuf, label: &str, max: usize, out: &mut String| {
        if let Ok(s) = crate::read_to_string_retry(&p) {
            let s = s.trim();
            if !s.is_empty() {
                out.push_str(&format!("## {label}\n"));
                out.push_str(&s.chars().take(max).collect::<String>());
                out.push_str("\n\n");
            }
        }
    };
    read_head(dir.join("_memory.md"), "Long-term memory", 2000, &mut out);
    read_head(dir.join("state.md"), "State", 1500, &mut out);
    read_head(dir.join("_state.md"), "State", 1500, &mut out);
    read_head(dir.join("goals.md"), "Goals", 1000, &mut out);
    // Decisions already made — so the coach builds on them instead of re-asking
    // settled questions (council verdicts + chat/distill-extracted decisions).
    if let Ok(raw) = crate::read_to_string_retry(dir.join("_decisions.jsonl")) {
        let decs: Vec<String> = raw
            .lines()
            .rev()
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .filter_map(|v| {
                v.get("decision")
                    .or_else(|| v.get("verdict"))
                    .and_then(|d| d.as_str())
                    .map(|s| s.trim().chars().take(160).collect::<String>())
            })
            .filter(|s| !s.is_empty())
            .take(6)
            .collect();
        if !decs.is_empty() {
            out.push_str("## Decisions already made\n");
            for d in decs.iter().rev() {
                out.push_str(&format!("- {d}\n"));
            }
            out.push('\n');
        }
    }
    // Last few intent messages from the ledger.
    if let Ok(raw) = crate::read_to_string_retry(dir.join("_intents.jsonl")) {
        let msgs: Vec<String> = raw
            .lines()
            .rev()
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .filter(|v| v.get("kind").and_then(|k| k.as_str()) == Some("intent"))
            .filter_map(|v| v.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()))
            .take(8)
            .collect();
        if !msgs.is_empty() {
            out.push_str("## Recent things the user asked\n");
            for m in msgs.iter().rev() {
                out.push_str(&format!("- {}\n", m.chars().take(140).collect::<String>()));
            }
        }
    }
    out
}

// Parse the model's JSON (tolerant — extract the first {...} block).
fn parse_surface(output: &str) -> SurfaceResult {
    let start = output.find('{');
    let end = output.rfind('}');
    let mut res = SurfaceResult::default();
    if let (Some(s), Some(e)) = (start, end) {
        if e > s {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&output[s..=e]) {
                let arr = |k: &str| -> Vec<String> {
                    v.get(k)
                        .and_then(|a| a.as_array())
                        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.trim().to_string())).filter(|s| !s.is_empty()).collect())
                        .unwrap_or_default()
                };
                res.questions = arr("questions");
                res.actions = arr("actions");
            }
        }
    }
    res
}

fn cache_path(vault: &str, domain: &str) -> PathBuf {
    crate::paths::domain_dir_pub(vault, domain).join("_surface.json")
}

#[tauri::command]
pub async fn domain_surface(
    vault: String,
    domain: String,
    provider: String,
    model: String,
    force: bool,
) -> Result<SurfaceResult, String> {
    let dir = crate::paths::domain_dir_pub(&vault, &domain);
    let cache = cache_path(&vault, &domain);

    // Serve fresh cache unless forced.
    if !force {
        if let Ok(s) = crate::read_to_string_retry(&cache) {
            if let Ok(mut r) = serde_json::from_str::<SurfaceResult>(&s) {
                if now_ms() - r.generated_at < TTL_MS {
                    r.stale = false;
                    return Ok(r);
                }
            }
        }
    }

    let context = gather_context(&dir);
    let prompt = format!(
        "{}{}",
        crate::ideal_state_preamble(Path::new(&vault)),
        build_prompt(&domain, &context),
    );
    // Bunker Mode: proactive surface generation still runs — but instead of
    // refusing a cloud provider outright, transparently switch to an available
    // local model (Ollama / LM Studio / MLX). Insights are useful offline too,
    // so there's no reason to go dark. `resolve_cli` NEVER returns a cloud CLI
    // under Bunker, so the local-only guarantee holds; it only hard-blocks when
    // no local provider is up (so the UI can prompt the user to start one).
    let effective = crate::bunker::resolve_cli_forced(&provider, domain_local_only(&dir))?;
    // When Bunker swapped a cloud provider for a local one, the requested cloud
    // model id (e.g. "claude-haiku-4-5") is meaningless to it — drop it and let
    // the local provider use its default model.
    let switched = effective != provider;
    let model_opt = if switched || model.is_empty() { None } else { Some(model.as_str()) };
    let out = crate::telegram_bridge::run_cli(&effective, model_opt, &prompt).await?;
    let mut res = parse_surface(&out);
    if res.questions.is_empty() && res.actions.is_empty() {
        return Err("could not parse a surface from the model output".into());
    }
    res.generated_at = now_ms();
    res.stale = false;
    if let Some(parent) = cache.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = crate::vaultio::write_atomic(&cache, &serde_json::to_string_pretty(&res).unwrap_or_default());
    Ok(res)
}

/// Draft a per-domain Ideal State from the domain's real context (memory, state,
/// decisions, recent intents). Returns 2-4 sentences describing what a thriving
/// version of this domain looks like — grounded in the user's actual situation,
/// not generic. The desktop puts it in the editor for review before saving.
#[tauri::command]
pub async fn domain_draft_ideal(
    vault: String,
    domain: String,
    provider: String,
    model: String,
) -> Result<String, String> {
    let dir = crate::paths::domain_dir_pub(&vault, &domain);
    let context = gather_context(&dir);
    let prompt = format!(
        "{}You are helping define the IDEAL STATE for this person's \"{domain}\" domain — a \
short, vivid description of what a thriving {domain} looks like FOR THEM, used as the \
standing target their AI council and background loops work toward.\n\n\
Write 2-4 sentences, second person or declarative (no preamble, no headers, no quotes). \
Make it specific and grounded in the context below — reference their actual situation, \
goals, and decisions where possible — but aspirational. Return ONLY the ideal-state text.\n\n\
--- CONTEXT ---\n{context}",
        crate::ideal_state_preamble(Path::new(&vault)),
    );
    let effective = crate::bunker::resolve_cli_forced(&provider, domain_local_only(&dir))?;
    let switched = effective != provider;
    let model_opt = if switched || model.is_empty() { None } else { Some(model.as_str()) };
    let out = crate::telegram_bridge::run_cli(&effective, model_opt, &prompt).await?;
    let cleaned = out.trim().trim_matches('"').trim().to_string();
    if cleaned.is_empty() {
        return Err("the model returned an empty draft".into());
    }
    Ok(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_surface_extracts_json_amid_prose() {
        let out = "Here you go:\n{\"questions\":[\"Q1\",\"Q2\"],\"actions\":[\"A1\"]}\nhope that helps";
        let r = parse_surface(out);
        assert_eq!(r.questions, vec!["Q1", "Q2"]);
        assert_eq!(r.actions, vec!["A1"]);
    }

    #[test]
    fn parse_surface_empty_on_garbage() {
        let r = parse_surface("no json here");
        assert!(r.questions.is_empty() && r.actions.is_empty());
    }

    #[test]
    fn build_prompt_includes_domain_and_context() {
        let p = build_prompt("wealth", "net worth up 5%");
        assert!(p.contains("wealth"));
        assert!(p.contains("net worth up 5%"));
        assert!(p.contains("questions"));
    }
}
