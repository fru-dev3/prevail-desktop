// Intent ledger - the self-learning core. A chat IS an intent, and intents
// must never be lost. Every turn appends one JSON line to
// <vault>/<domain>/_intents.jsonl (<vault>/_intents.jsonl for the no-domain
// General space) the instant it happens: on send (the exact prompt) and on
// completion (the raw, unprocessed reply). Append-only, never overwritten -
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
    let file = crate::paths::v4_content_path(&dir, ".system/journal.jsonl", "_intents.jsonl");
    // Provenance: stamp WHERE this prompt came from (machine, app, version,
    // surface) server-side so every entry carries it without each caller
    // remembering to. Caller-provided values win; only missing fields are
    // filled. This is what lets the journal answer "which machine / which
    // surface is my activity coming from".
    let mut record = record;
    if let Some(obj) = record.as_object_mut() {
        obj.entry("host").or_insert_with(|| serde_json::json!(machine_hostname()));
        obj.entry("app").or_insert_with(|| serde_json::json!("prevail-desktop"));
        obj.entry("app_version").or_insert_with(|| serde_json::json!(env!("CARGO_PKG_VERSION")));
        obj.entry("surface").or_insert_with(|| serde_json::json!("chat"));
        // Deliberately rich: metadata is cheap now and irreplaceable later - a
        // future, smarter model mining this ledger benefits from every axis
        // (which OS build, which engine compiled the sidecar behavior, what
        // schema wrote the record).
        obj.entry("os").or_insert_with(|| serde_json::json!(os_version()));
        obj.entry("engine_version").or_insert_with(|| serde_json::json!(engine_version()));
        obj.entry("meta_v").or_insert_with(|| serde_json::json!(1));
    }
    let line = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    engine::vault_append_line(&file, &format!("{line}\n")).map_err(|e| format!("write intent: {e}"))?;
    Ok(())
}

/// OS name + version (e.g. "macOS 26.0"), resolved once.
fn os_version() -> String {
    static OS: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    OS.get_or_init(|| {
        let ver = std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty());
        match ver {
            Some(v) => format!("macOS {v}"),
            None => std::env::consts::OS.to_string(),
        }
    })
    .clone()
}

/// The engine (sidecar) version, resolved once per app run.
fn engine_version() -> String {
    static V: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    V.get_or_init(|| {
        std::process::Command::new(engine::resolve_prevail_bin())
            .arg("--version")
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_default()
    })
    .clone()
}

/// This machine's hostname, resolved once. Used to stamp provenance on journal
/// entries so multi-machine vaults can attribute activity (mini vs MBP vs Air).
pub(crate) fn machine_hostname() -> String {
    static HOST: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    HOST.get_or_init(|| {
        std::process::Command::new("hostname")
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "unknown-host".to_string())
    })
    .clone()
}

/// I6: read back the intents ledger so the desktop can surface it (newest
/// first). Each line is an "intent" record written by `intent_append` the
/// instant a chat is sent - what the user asked + the prefs in effect.
#[tauri::command]
pub(crate) fn intents_read(
    vault: String,
    domain: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    let file = crate::paths::v4_content_path(&domain_dir(&vault, &domain), ".system/journal.jsonl", "_intents.jsonl");
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
/// built automatically from every conversation - not only when the user
/// manually clicks "New chat". Newest entries go directly under the header.
#[tauri::command]
pub(crate) fn journal_append(vault: String, domain: Option<String>, entry: String) -> Result<(), String> {
    let dir = domain_dir(&vault, &domain);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir journal: {e}"))?;
    let path = crate::paths::v4_content_path(&dir, "memory/journal.md", "_journal.md");
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
// E1: async command (off the UI thread); the sync body is intents_read_all_impl
// so internal Rust callers use it directly.
#[tauri::command]
pub(crate) async fn intents_read_all(vault: String, limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    intents_read_all_impl(vault, limit)
}

pub(crate) fn intents_read_all_impl(vault: String, limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    let root = PathBuf::from(&vault);
    // General resolves to its real home (v4 <vault>/data/domains/general, else
    // legacy vault root) - NOT build/, which never held the intent ledger.
    let mut dirs: Vec<(String, PathBuf)> = vec![("general".into(), crate::paths::general_dir(&vault))];
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    seen.insert("general".into());
    // Scan every layout, newest first so a v4 domain wins a name clash: v4
    // (<vault>/data/domains/<d>), then v3 (<vault>/domains/<d>), then legacy
    // (<vault>/<d>). This is the bug fix for "intents/journal blank" - the old
    // code only looked at v3 + legacy and missed the v4 data/domains home where
    // every conversation actually lands.
    for container in [root.join("data").join("domains"), root.join("domains"), root.clone()] {
        let Ok(it) = read_dir_retry(&container) else { continue };
        for e in it.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            // Skip infra dirs and internal / app-scope (_-prefixed) pseudo-domains.
            if p.is_dir()
                && !name.starts_with('.')
                && !name.starts_with('_')
                && name != "domains" && name != "apps" && name != "data" && name != "build"
                && seen.insert(name.clone())
            {
                dirs.push((name, p));
            }
        }
    }
    let mut out: Vec<serde_json::Value> = Vec::new();
    for (dom, dir) in dirs {
        let Ok(text) = read_to_string_retry(&crate::paths::v4_content_path(&dir, ".system/journal.jsonl", "_intents.jsonl")) else { continue };
        for l in text.lines().filter(|l| !l.trim().is_empty()) {
            let Ok(mut v) = serde_json::from_str::<serde_json::Value>(l) else { continue };
            if v.get("kind").and_then(|k| k.as_str()) != Some("intent") {
                continue;
            }
            if let Some(obj) = v.as_object_mut() {
                obj.insert("domain".into(), serde_json::json!(dom));
                // Native ledger prompts were typed in the Prevail desktop chat;
                // tag the surface so distilled intents can show provenance, the
                // same way captured cross-tool prompts carry their tool slug.
                obj.entry("surface").or_insert(serde_json::json!("prevail"));
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

// ── Intent distillation (T10) ────────────────────────────────────────────────
// The raw ledger is provenance; on its own it's just a list of prompts. This
// lifts it into the thing the user actually cares about: a small set of
// HIGH-LEVEL intents (the goal behind the prompts - "Is Toyota better than
// Honda?" → "evaluating a vehicle purchase; underlying need: transportation"),
// each with the evidence prompts, the domains it spans, a status, and concrete
// recommended next actions. Written to <vault>/_meta/intents_distilled.json so
// the desktop can render a drill-down and (later) turn actions into tasks/loops.

#[derive(serde::Deserialize)]
pub(crate) struct IntentsDistillCfg {
    pub vault: String,
    pub provider: String, // cli used to distill: claude | codex | ollama | …
    pub model: String,    // cheap model id, e.g. claude-haiku-4-5
    #[serde(default)]
    pub limit: Option<usize>,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn build_intents_prompt(activity: &str, existing_domains: &[String]) -> String {
    // The user's existing domains, so the distiller REUSES them instead of
    // coining a new granular label for every cluster (which fragments the vault
    // into dozens of overlapping domains). Domains must stay broad/encompassing.
    let domains_line = if existing_domains.is_empty() {
        "(none yet)".to_string()
    } else {
        existing_domains.join(", ")
    };
    format!(
        "You are Prevail's intent analyst. Below is a chronological log of the user's \
prompts. Each line is `[domain via surface] prompt` (or just `[surface] prompt`). \
The SURFACE is the app or tool the prompt was typed in - e.g. claude (Claude Code), \
codex, gemini, antigravity, opencode, or prevail (the Prevail desktop chat).\n\n\
Your job is NOT to summarize the prompts. Infer the HIGH-LEVEL INTENTS behind \
them - the real goals the user is pursuing - by clustering related prompts \
across sessions, domains, and surfaces. Lift each cluster up a level of abstraction: e.g. \
prompts comparing car models map to the intent \"Evaluating a vehicle purchase\" \
with underlying need \"transportation\", not \"asked about Toyota vs Honda\".\n\n\
The user's EXISTING DOMAINS are: {domains_line}.\n\
DOMAIN RULES (critical - the user manages these by hand and does NOT want domain sprawl):\n\
- For the \"domains\" field, STRONGLY PREFER an existing domain from the list above. Reuse beats creating.\n\
- A domain is a BROAD, encompassing area of life or work (e.g. \"career\", \"health\", \"finance\", a major project), NOT a sub-topic, skill, tool, or facet. Things like \"software architecture\", \"product design\", \"ui/ux\", \"integration\", \"ai/agent systems\" are all FACETS of one project or domain - map them to that single existing domain, never to separate new domains.\n\
- Only use a domain name NOT in the list when the intent genuinely fits NO existing domain AND is itself a broad new life/work area worth tracking on its own. This should be rare. When in doubt, reuse the closest existing domain.\n\
- Do not output two domain names that are facets of the same thing. Collapse them.\n\n\
Return ONLY a JSON array (no prose, no markdown fences). Each element:\n\
{{\n  \"title\": short intent name,\n  \"goal\": one sentence - what they are really trying to achieve,\n  \"underlying_need\": the deeper need behind it,\n  \"domains\": [domains it spans - prefer existing ones],\n  \"sources\": [the distinct surfaces these prompts came from, e.g. \"claude\", \"codex\", \"prevail\"],\n  \"status\": \"active\" | \"dormant\" | \"resolved\",\n  \"confidence\": 0.0-1.0,\n  \"open_questions\": [the next things to figure out],\n  \"evidence\": [2-4 short quoted snippets from the prompts that support this],\n  \"recommendations\": [concrete next actions Prevail could take or suggest]\n}}\n\n\
Produce 3-8 intents, most important first. Be specific and genuinely useful; \
never invent facts not supported by the prompts. For \"sources\", list ONLY surfaces \
that actually appear in this intent's prompts; never invent one.\n\n\
OUTPUT FORMAT (non-negotiable): your entire response MUST be a single JSON array. \
Begin with `[` and end with `]`. No preamble, no explanation, no markdown fences. \
If there is nothing to report, output exactly `[]`.\n\n\
PROMPT LOG:\n{activity}\n"
    )
}

/// Strip a leading/trailing markdown code fence (```json ... ```), returning the
/// inner content. No fence -> the input trimmed.
fn strip_code_fences(s: &str) -> &str {
    let s = s.trim();
    if let Some(rest) = s.strip_prefix("```") {
        // Drop an optional language tag on the fence's first line.
        let rest = rest.splitn(2, '\n').nth(1).unwrap_or(rest);
        return rest.trim_end().strip_suffix("```").unwrap_or(rest).trim();
    }
    s
}

/// The balanced `[ ... ]` slice that STARTS at byte index `start` (which must be
/// a `[`), string/escape aware. None if it never closes.
fn balanced_array_from(s: &str, start: usize) -> Option<&str> {
    let b = s.as_bytes();
    let (mut depth, mut in_str, mut esc) = (0i32, false, false);
    for i in start..b.len() {
        let c = b[i];
        if esc {
            esc = false;
        } else if in_str {
            match c {
                b'\\' => esc = true,
                b'"' => in_str = false,
                _ => {}
            }
        } else {
            match c {
                b'"' => in_str = true,
                b'[' => depth += 1,
                b']' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(&s[start..=i]);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// Pull the JSON array out of a model's output. Robust to markdown fences, a
/// `{"intents":[...]}` wrapper, and leading/trailing prose - the old first-`[`/
/// last-`]` slice failed ("model output had no JSON array") whenever the model
/// added any preamble. Returns the parsed array of intent objects.
fn parse_intents_output(out: &str) -> Result<serde_json::Value, String> {
    let cleaned = strip_code_fences(out);
    // 1) Whole thing already parses as an array, or a {"intents":[...]} wrapper.
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(cleaned) {
        if v.is_array() {
            return Ok(v);
        }
        if let Some(arr) = v.get("intents").filter(|a| a.is_array()) {
            return Ok(arr.clone());
        }
    }
    // 2) Try each `[` in turn: take the balanced array starting there and parse
    // it; return the first that is a valid JSON array. This skips stray prose
    // brackets like "[see below]" that aren't valid JSON.
    let mut from = 0usize;
    while let Some(rel) = cleaned[from..].find('[') {
        let start = from + rel;
        if let Some(slice) = balanced_array_from(cleaned, start) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(slice) {
                if v.is_array() {
                    return Ok(v);
                }
            }
        }
        from = start + 1;
    }
    Err("model output had no JSON array".into())
}

/// Count every intent record across the vault. Cheap signal the daemon uses to
/// decide whether enough NEW prompts have arrived to be worth a model pass.
pub(crate) fn count_intents(vault: &str) -> usize {
    intents_read_all_impl(vault.to_string(), None).map(|v| v.len()).unwrap_or(0)
}

// ── Capture streams as a distiller source ─────────────────────────────────────
// <vault>/_meta/prompts.<tool>.jsonl hold the prompts the user typed in OTHER
// harnesses (Claude Code, Codex, …), captured by `prevail capture`. They feed
// the SAME distiller as the native ledger, so intents span every tool the user
// drives: the same question asked across three CLIs becomes one intent.

fn capture_stream_dir(vault: &str) -> PathBuf {
    crate::paths::build_root(vault).join("_meta").join("prompts")
}

/// Per-file line counts for every capture stream (filename -> non-empty lines).
/// The cheap signal the daemon turns into per-stream offsets: it never parses,
/// just counts, so a "nothing new" check stays inexpensive.
pub(crate) fn capture_stream_line_counts(vault: &str) -> std::collections::BTreeMap<String, usize> {
    let mut counts = std::collections::BTreeMap::new();
    let Ok(rd) = read_dir_retry(&capture_stream_dir(vault)) else { return counts };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.ends_with(".jsonl") {
            if let Ok(text) = read_to_string_retry(&e.path()) {
                let n = text.lines().filter(|l| !l.trim().is_empty()).count();
                counts.insert(name, n);
            }
        }
    }
    counts
}

/// Capture-stream prompts as intent-shaped records (message + ts + the tool as a
/// `domain` provenance tag), newest first, capped at `limit`. Mirrors the shape
/// `intents_read_all` returns so the two merge cleanly in the distiller.
fn read_capture_prompts(vault: &str, limit: Option<usize>) -> Vec<serde_json::Value> {
    // Dedup by exact prompt text, keeping the newest occurrence. Prevail's own
    // background model calls (distill/taskgen/skillgen/…) prepend the same
    // ideal-state preamble and, if the capture hook is installed, each spawn
    // self-records the identical prompt - so the journal filled with 5x copies
    // of "# THE USER'S IDEAL STATE …". Collapsing identical prompts removes that
    // noise on read. (The deeper fix is to stop capturing internal calls.)
    use std::collections::HashMap;
    let mut by_prompt: HashMap<String, serde_json::Value> = HashMap::new();
    let Ok(rd) = read_dir_retry(&capture_stream_dir(vault)) else { return Vec::new() };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.ends_with(".jsonl") {
            continue;
        }
        let Ok(text) = read_to_string_retry(&e.path()) else { continue };
        for l in text.lines().filter(|l| !l.trim().is_empty()) {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(l) else { continue };
            let prompt = v.get("prompt").and_then(|p| p.as_str()).unwrap_or("");
            if prompt.trim().is_empty() {
                continue;
            }
            let tool = v.get("tool").and_then(|t| t.as_str()).unwrap_or("cli");
            let ts = v.get("epoch_ms").and_then(|t| t.as_i64()).unwrap_or(0);
            let rec = serde_json::json!({
                "kind": "intent",
                "message": prompt,
                "domain": tool,
                // The surface the prompt was typed in (claude | codex | gemini |
                // …), preserved so distilled intents can show their provenance.
                "surface": tool,
                "ts": ts,
                "source": v.get("source").and_then(|s| s.as_str()).unwrap_or("sync"),
                // Which machine captured it (the capture layer stamps its own
                // hostname per record; older records simply lack it).
                "host": v.get("host").and_then(|h| h.as_str()).unwrap_or(""),
            });
            // Keep the newest occurrence of each identical prompt.
            match by_prompt.get(prompt) {
                Some(existing) if existing.get("ts").and_then(|t| t.as_i64()).unwrap_or(0) >= ts => {}
                _ => { by_prompt.insert(prompt.to_string(), rec); }
            }
        }
    }
    let mut out: Vec<serde_json::Value> = by_prompt.into_values().collect();
    out.sort_by_key(|v| std::cmp::Reverse(v.get("ts").and_then(|t| t.as_i64()).unwrap_or(0)));
    if let Some(n) = limit {
        out.truncate(n);
    }
    out
}

/// Captured cross-tool prompts (Claude Code, Codex, …) as journal rows, newest
/// first. Exposes the same records the distiller reads so the desktop Intent
/// journal can show prompts typed OUTSIDE Prevail alongside the native ledger.
/// Each row carries `surface` (the tool slug) and `source` (push|sync).
#[tauri::command]
pub(crate) fn capture_prompts_read(
    vault: String,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    Ok(read_capture_prompts(&vault, limit))
}

/// The reusable distillation core - called by both the manual command and the
/// background daemon. Reads the ledger, runs one model pass, writes
/// <vault>/_meta/intents_distilled.json, and returns the document.
pub(crate) async fn distill_intents_core(
    vault: &str,
    provider: &str,
    model: &str,
    limit: usize,
) -> Result<serde_json::Value, String> {
    // Merge the native ledger with the captured cross-tool prompt streams, then
    // keep the newest `limit` across both so a unified chronological log feeds
    // the model.
    let mut intents = intents_read_all_impl(vault.to_string(), Some(limit))?;
    intents.extend(read_capture_prompts(vault, Some(limit)));
    intents.sort_by_key(|v| std::cmp::Reverse(v.get("ts").and_then(|t| t.as_i64()).unwrap_or(0)));
    intents.truncate(limit);
    if intents.is_empty() {
        return Err("No prompts captured yet. Chat a bit, or run capture sync.".into());
    }
    // Oldest-first so the model reads the narrative in order; cap each line.
    let mut activity = String::new();
    for v in intents.iter().rev() {
        let dom = v.get("domain").and_then(|d| d.as_str()).unwrap_or("general");
        let surface = v.get("surface").and_then(|s| s.as_str()).unwrap_or("prevail");
        let msg = v.get("message").and_then(|m| m.as_str()).unwrap_or("");
        if msg.trim().is_empty() {
            continue;
        }
        let m: String = msg.chars().take(400).collect();
        // `[domain via surface]` when they differ (native ledger), else `[surface]`
        // (captured cross-tool prompts, where domain == tool == surface). Gives
        // the model both the life-domain hint and the provenance tag. The
        // machine (host) rides along when known, so the distiller can also see
        // WHERE activity happens (hub vs laptop) and weigh it.
        let host = v.get("host").and_then(|h| h.as_str()).unwrap_or("");
        let mut tag = if dom == surface {
            surface.to_string()
        } else {
            format!("{dom} via {surface}")
        };
        if !host.is_empty() {
            tag = format!("{tag} @ {host}");
        }
        activity.push_str(&format!("[{tag}] {}\n", m.replace('\n', " ")));
    }
    if activity.trim().is_empty() {
        return Err("No prompt text to analyze.".into());
    }
    let ideal = crate::ideal_state_preamble(std::path::Path::new(vault));
    let existing_domains = crate::vault::list_domain_names(vault);
    let prompt = format!("{ideal}{}", build_intents_prompt(&activity, &existing_domains));

    crate::bunker::guard_cli(provider)?;
    let model_opt = if model.is_empty() { None } else { Some(model) };
    let out = crate::telegram_bridge::run_cli(provider, model_opt, &prompt).await?;
    if out.trim().is_empty() {
        return Err("intent distiller produced no output".into());
    }
    let arr = parse_intents_output(&out)?;
    let doc = serde_json::json!({
        "generated_ts": now_secs(),
        "source_count": intents.len(),
        "intents": arr,
    });
    let meta_dir = crate::paths::build_root(vault).join("_meta");
    fs::create_dir_all(&meta_dir).map_err(|e| format!("mkdir _meta: {e}"))?;
    let path = meta_dir.join("intents_distilled.json");
    let body = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    fs::write(&path, engine::maybe_encrypt(&path, &body))
        .map_err(|e| format!("write intents_distilled.json: {e}"))?;
    Ok(doc)
}

/// Distill the raw intent ledger into high-level intents + recommendations and
/// persist them to <vault>/_meta/intents_distilled.json. Runs a single model
/// pass (a cheap model is plenty). Returns the written document.
#[tauri::command]
pub(crate) async fn intents_distill(
    cfg: IntentsDistillCfg,
) -> Result<serde_json::Value, String> {
    distill_intents_core(&cfg.vault, &cfg.provider, &cfg.model, cfg.limit.unwrap_or(200)).await
}

/// Read the last distilled-intents document (empty shell if none yet).
#[tauri::command]
pub(crate) fn intents_distilled_read(vault: String) -> Result<serde_json::Value, String> {
    let path = crate::paths::build_root(&vault).join("_meta").join("intents_distilled.json");
    match read_to_string_retry(&path) {
        Ok(raw) => {
            let text = engine::maybe_decrypt(&path, raw);
            serde_json::from_str(&text).map_err(|e| format!("parse intents_distilled.json: {e}"))
        }
        Err(_) => Ok(serde_json::json!({ "generated_ts": 0, "source_count": 0, "intents": [] })),
    }
}

/// Append a DECISION to the domain's append-only decision log
/// (`<domain>/_decisions.jsonl`). A council verdict, an accepted recommendation,
/// or a user-stated preference ("make Mayo my favorite hospital") is a decision
/// - durable, provenance-tagged, and fed into state derivation + scoring so the
/// domain actually learns. Mirrors `intent_append`. (feedback v0.4.1 I1/I5)
#[tauri::command]
pub(crate) fn decision_append(
    vault: String,
    domain: Option<String>,
    record: serde_json::Value,
) -> Result<(), String> {
    let dir = domain_dir(&vault, &domain);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir decisions: {e}"))?;
    let file = crate::paths::v4_content_path(&domain_dir(&vault, &domain), "memory/decisions.jsonl", "_decisions.jsonl");
    // Dedup: skip if an identical decision (same prompt + verdict + action) is
    // already logged - a re-render or retry shouldn't create a duplicate entry.
    let dkey = |v: &serde_json::Value| -> String {
        let g = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
        format!("{}\u{1}{}\u{1}{}", g("prompt"), g("verdict"), g("action"))
    };
    let nk = dkey(&record);
    if nk != "\u{1}\u{1}" {
        if let Ok(existing) = read_to_string_retry(&file) {
            if existing.lines().filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok()).any(|v| dkey(&v) == nk) {
                return Ok(()); // already recorded
            }
        }
    }
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
    // Read the primary ledger, plus (for General) the pre-build/ root copy, and
    // merge - so a tidied vault that split decisions across root + build/ shows a
    // single deduped list instead of hiding half of them.
    let primary = crate::paths::v4_content_path(&domain_dir(&vault, &domain), "memory/decisions.jsonl", "_decisions.jsonl");
    let mut files = vec![primary.clone()];
    if domain.is_none() {
        let root_copy = std::path::PathBuf::from(&vault).join("_decisions.jsonl");
        if root_copy != primary { files.push(root_copy); }
    }
    let mut out: Vec<serde_json::Value> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for f in files {
        let Ok(text) = read_to_string_retry(&f) else { continue };
        for v in text.lines().filter(|l| !l.trim().is_empty()).filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok()) {
            let g = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
            let key = format!("{}\u{1}{}\u{1}{}", g("prompt"), g("verdict"), g("action"));
            if seen.insert(key) { out.push(v); }
        }
    }
    // Newest first (entries carry an epoch-ms `ts`).
    out.sort_by(|a, b| b.get("ts").and_then(|x| x.as_i64()).unwrap_or(0).cmp(&a.get("ts").and_then(|x| x.as_i64()).unwrap_or(0)));
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
    let file = crate::paths::v4_content_path(&domain_dir(&vault, &domain), "memory/decisions.jsonl", "_decisions.jsonl");
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

#[cfg(test)]
mod capture_source_tests {
    use super::*;

    #[test]
    fn reads_and_counts_capture_streams() {
        let vault = std::env::temp_dir().join(format!("prevail-capture-src-{}", std::process::id()));
        let prompts_dir = vault.join("_meta").join("prompts");
        fs::create_dir_all(&prompts_dir).unwrap();
        // One file per tool in _meta/prompts/; one blank-prompt record (ignored).
        fs::write(
            prompts_dir.join("claude.jsonl"),
            "{\"prompt\":\"buy a car\",\"tool\":\"claude\",\"epoch_ms\":100,\"source\":\"push\"}\n\
             {\"prompt\":\"\",\"tool\":\"claude\",\"epoch_ms\":150}\n\
             {\"prompt\":\"sell the old car\",\"tool\":\"claude\",\"epoch_ms\":200,\"source\":\"sync\"}\n",
        )
        .unwrap();
        fs::write(
            prompts_dir.join("codex.jsonl"),
            "{\"prompt\":\"refactor module\",\"tool\":\"codex\",\"epoch_ms\":300}\n",
        )
        .unwrap();

        let vs = vault.to_string_lossy().to_string();

        let counts = capture_stream_line_counts(&vs);
        assert_eq!(counts.get("claude.jsonl"), Some(&3)); // blank line counts as a line
        assert_eq!(counts.get("codex.jsonl"), Some(&1));

        let prompts = read_capture_prompts(&vs, None);
        // 3 real prompts (blank-prompt record dropped), newest first by ts.
        assert_eq!(prompts.len(), 3);
        assert_eq!(prompts[0].get("message").and_then(|m| m.as_str()), Some("refactor module"));
        assert_eq!(prompts[0].get("domain").and_then(|d| d.as_str()), Some("codex"));
        let limited = read_capture_prompts(&vs, Some(2));
        assert_eq!(limited.len(), 2);

        let _ = fs::remove_dir_all(&vault);
    }
}

#[cfg(test)]
mod parse_intents_tests {
    use super::*;

    #[test]
    fn parses_bare_array() {
        let v = parse_intents_output("[{\"title\":\"a\"}]").unwrap();
        assert!(v.is_array());
        assert_eq!(v.as_array().unwrap().len(), 1);
    }

    #[test]
    fn parses_array_wrapped_in_prose() {
        // The old first-'['/last-']' slice broke when prose contained a stray '['.
        let out = "Here are the intents [see below]:\n[{\"title\":\"a\"},{\"title\":\"b\"}]\nDone.";
        let v = parse_intents_output(out).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 2);
    }

    #[test]
    fn parses_fenced_json() {
        let out = "```json\n[{\"title\":\"a\"}]\n```";
        let v = parse_intents_output(out).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 1);
    }

    #[test]
    fn unwraps_intents_object() {
        let out = "{\"intents\": [{\"title\":\"a\"}]}";
        let v = parse_intents_output(out).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 1);
    }

    #[test]
    fn empty_array_is_ok() {
        let v = parse_intents_output("[]").unwrap();
        assert_eq!(v.as_array().unwrap().len(), 0);
    }

    #[test]
    fn genuine_prose_with_no_array_errors() {
        assert!(parse_intents_output("I cannot help with that.").is_err());
    }
}
