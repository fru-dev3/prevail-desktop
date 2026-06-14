// Benchmark — reading saved runs, the questions CRUD bank, the effectiveness
// matrix, and the native runner. Extracted from lib.rs (which previously held
// these across four scattered sections). Read helpers come from the crate root;
// path-safety from crate::paths; spawn infra (for the native runner) from
// crate::children and the shared env builders.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::engine;
use crate::read_to_string_retry;
use crate::secs_to_ymdhms;

// ── Saved runs ────────────────────────────────────────────────────────
// Read saved runs from <vault>/benchmark/runs/.

#[derive(Serialize)]
pub(crate) struct BenchmarkRun {
    pub label: String,
    pub run_dir: String,
    pub judge_avg: Option<f64>,
    pub keyword_avg: Option<f64>,
    pub questions: usize,
    /// Run date parsed from the dir name (`YYYY-MM-DD_<label>`), so the UI
    /// can group runs by when they happened.
    pub date: String,
    /// Distinct domains the run actually covered (from its question records),
    /// so a domain-scoped view can show only the runs that touched it.
    pub domains: Vec<String>,
    /// False when the run has results but no score.json yet (scoring skipped
    /// or interrupted). Previously such runs were silently invisible.
    pub scored: bool,
    /// Batch membership: model runs launched together share one batch, so the
    /// UI can group a session of N models as a single unit (and rerun it).
    pub batch_id: Option<String>,
    pub batch_label: Option<String>,
    /// Directory creation time (ms since epoch). Lets the UI cluster
    /// pre-batch-era runs that were launched together into pseudo-batches.
    pub created_ms: u64,
    /// From meta.json (engine-written since the rerun fix): the exact target,
    /// so reruns don't have to parse directory names.
    pub cli: Option<String>,
    pub model: Option<String>,
    pub council: Option<bool>,
}

#[derive(Deserialize, Default)]
struct RunMetaFile {
    cli: Option<String>,
    model: Option<String>,
    council: Option<bool>,
}

fn read_run_meta(run_dir: &Path) -> RunMetaFile {
    read_to_string_retry(run_dir.join("meta.json"))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Strip the "_HH-MM-SS" dedupe suffix reruns carry, for display labels.
fn strip_rerun_suffix(label: &str) -> String {
    let b = label.as_bytes();
    if b.len() > 9 && b[b.len() - 9] == b'_' {
        let tail = &label[label.len() - 8..];
        let ok = tail.chars().enumerate().all(|(i, c)| match i {
            2 | 5 => c == '-',
            _ => c.is_ascii_digit(),
        });
        if ok {
            return label[..label.len() - 9].to_string();
        }
    }
    label.to_string()
}

fn dir_created_ms(p: &Path) -> u64 {
    std::fs::metadata(p)
        .and_then(|m| m.created().or_else(|_| m.modified()))
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Deserialize)]
struct BatchFile {
    id: String,
    label: Option<String>,
}

fn read_batch(run_dir: &Path) -> (Option<String>, Option<String>) {
    let p = run_dir.join("batch.json");
    if let Ok(raw) = read_to_string_retry(&p) {
        if let Ok(b) = serde_json::from_str::<BatchFile>(&raw) {
            let label = b.label.clone();
            return (Some(b.id), label);
        }
    }
    (None, None)
}

#[derive(Deserialize)]
struct ScoreFile {
    label: String,
    #[serde(rename = "runDir")]
    run_dir: String,
    #[serde(rename = "judge_avg")]
    judge_avg: Option<f64>,
    #[serde(rename = "keyword_avg")]
    keyword_avg: Option<f64>,
    #[serde(rename = "questionScores")]
    question_scores: Vec<serde_json::Value>,
}

/// Distinct `domain` fields from an array of question records.
fn distinct_domains(records: &[serde_json::Value]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in records {
        if let Some(d) = r.get("domain").and_then(|v| v.as_str()) {
            if !d.is_empty() && !out.iter().any(|x| x == d) {
                out.push(d.to_string());
            }
        }
    }
    out.sort();
    out
}

/// `YYYY-MM-DD` prefix of a run directory name, if present.
fn run_dir_date(dir_name: &str) -> String {
    let head: String = dir_name.chars().take(10).collect();
    let ok = head.len() == 10
        && head.chars().enumerate().all(|(i, c)| match i {
            4 | 7 => c == '-',
            _ => c.is_ascii_digit(),
        });
    if ok { head } else { String::new() }
}

#[tauri::command]
pub(crate) fn benchmark_runs(vault: String) -> Result<Vec<BenchmarkRun>, String> {
    let runs_dir = Path::new(&vault).join("benchmark").join("runs");
    if !runs_dir.exists() {
        return Ok(vec![]);
    }
    let entries = std::fs::read_dir(&runs_dir).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let dir_name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let date = run_dir_date(&dir_name);
        let score_file = p.join("score.json");
        let (batch_id, batch_label) = read_batch(&p);
        let meta = read_run_meta(&p);
        if score_file.exists() {
            if let Ok(raw) = read_to_string_retry(&score_file) {
                if let Ok(parsed) = serde_json::from_str::<ScoreFile>(&raw) {
                    let domains = distinct_domains(&parsed.question_scores);
                    out.push(BenchmarkRun {
                        label: strip_rerun_suffix(&parsed.label),
                        run_dir: parsed.run_dir,
                        judge_avg: parsed.judge_avg,
                        keyword_avg: parsed.keyword_avg,
                        questions: parsed.question_scores.len(),
                        date,
                        domains,
                        scored: true,
                        batch_id,
                        batch_label,
                        created_ms: dir_created_ms(&p),
                        cli: meta.cli,
                        model: meta.model,
                        council: meta.council,
                    });
                    continue;
                }
            }
        }
        // Unscored (or unparseable score) run: surface it from results.json
        // instead of hiding it — the user must be able to SEE every run.
        let results_file = p.join("results.json");
        if results_file.exists() {
            if let Ok(raw) = read_to_string_retry(&results_file) {
                if let Ok(records) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
                    let domains = distinct_domains(&records);
                    let label = strip_rerun_suffix(
                        dir_name.splitn(2, '_').nth(1).unwrap_or(&dir_name),
                    );
                    out.push(BenchmarkRun {
                        label,
                        run_dir: p.to_string_lossy().to_string(),
                        judge_avg: None,
                        keyword_avg: None,
                        questions: records.len(),
                        date,
                        domains,
                        scored: false,
                        batch_id,
                        batch_label,
                        created_ms: dir_created_ms(&p),
                        cli: meta.cli.clone(),
                        model: meta.model.clone(),
                        council: meta.council,
                    });
                }
            }
        }
    }
    // Newest first, scored or not; ties broken by judge score.
    out.sort_by(|a, b| {
        b.date.cmp(&a.date).then_with(|| {
            let aj = a.judge_avg.unwrap_or(-1.0);
            let bj = b.judge_avg.unwrap_or(-1.0);
            bj.partial_cmp(&aj).unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    Ok(out)
}

#[tauri::command]
pub(crate) fn benchmark_run_detail(run_dir: String) -> Result<serde_json::Value, String> {
    if run_dir.contains("..") || !run_dir.contains("/benchmark/") {
        return Err("invalid run_dir".into());
    }
    let results_file = Path::new(&run_dir).join("results.json");
    let score_file = Path::new(&run_dir).join("score.json");
    let results = read_to_string_retry(&results_file)
        .map_err(|e| format!("results.json: {e}"))?;
    let score = read_to_string_retry(&score_file).map_err(|e| format!("score.json: {e}"))?;
    let results_v: serde_json::Value = serde_json::from_str(&results).map_err(|e| e.to_string())?;
    let score_v: serde_json::Value = serde_json::from_str(&score).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "records": results_v,
        "score": score_v,
    }))
}

// ── Questions bank ────────────────────────────────────────────────────
// CRUD over <vault>/benchmark/questions/*.md. The markdown format
// (frontmatter + ## Prompt/## Context/## Notes) mirrors the CLI's
// canonical-bench.ts readQuestion/writeDraftQuestion exactly, so the CLI and
// the desktop read/write the same files interchangeably.

#[derive(Serialize)]
pub(crate) struct BenchQuestion {
    id: String,
    domain: String,
    prompt: String,
    context: String,
    notes: String,
    council: bool,
    expected_decision: String,
    expected_verdict_keywords: Vec<String>,
    path: String,
    created: Option<String>, // YYYY-MM-DD the question entered the suite
    source: Option<String>,  // "user" | "ai"
    edited: Option<String>,  // YYYY-MM-DD last edit (prior text snapshotted in _versions/)
    archived: bool,          // kept for history, excluded from new runs
}

#[derive(Deserialize)]
pub(crate) struct BenchQuestionInput {
    id: Option<String>,
    domain: String,
    prompt: String,
    context: Option<String>,
    notes: Option<String>,
    council: Option<bool>,
    expected_decision: Option<String>,
    expected_verdict_keywords: Option<Vec<String>>,
}

// Pull a `## Heading` section body out of the markdown (until the next ##).
fn extract_section(body: &str, heading: &str) -> String {
    let needle = format!("## {heading}");
    let mut lines = body.lines();
    let mut found = false;
    let mut out: Vec<&str> = Vec::new();
    while let Some(l) = lines.next() {
        if found {
            if l.trim_start().starts_with("## ") {
                break;
            }
            out.push(l);
        } else if l.trim() == needle {
            found = true;
        }
    }
    out.join("\n").trim().to_string()
}

fn parse_bench_question(path: &Path) -> Option<BenchQuestion> {
    let raw = read_to_string_retry(path).ok()?;
    let mut id = String::new();
    let mut domain = String::new();
    let mut council = false;
    let mut created = String::new();
    let mut source = String::new();
    let mut edited = String::new();
    let mut archived = false;
    let mut expected_decision = String::new();
    let mut keywords: Vec<String> = Vec::new();
    let mut body_start = 0usize;
    let lines: Vec<&str> = raw.lines().collect();
    if lines.first().map(|l| l.trim()) == Some("---") {
        let mut i = 1;
        while i < lines.len() && lines[i].trim() != "---" {
            if let Some((k, v)) = lines[i].split_once(':') {
                let key = k.trim();
                let val = v.trim();
                match key {
                    "id" => id = val.to_string(),
                    "domain" => domain = val.to_string(),
                    "council" => council = val == "true",
                    "expected_decision" => {
                        expected_decision = val.trim_matches('"').to_string()
                    }
                    "created" => created = val.to_string(),
                    "source" => source = val.to_string(),
                    "edited" => edited = val.to_string(),
                    "archived" => archived = val == "true",
                    "expected_verdict_keywords" => {
                        if val.starts_with('[') && val.ends_with(']') {
                            keywords = val[1..val.len() - 1]
                                .split(',')
                                .map(|s| s.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
                                .filter(|s| !s.is_empty() && !s.starts_with('<'))
                                .collect();
                        }
                    }
                    _ => {}
                }
            }
            i += 1;
        }
        body_start = i + 1;
    }
    if id.is_empty() || domain.is_empty() {
        return None;
    }
    let body = lines.get(body_start..).map(|s| s.join("\n")).unwrap_or_default();
    let clean = |s: String| if s.starts_with('<') && s.ends_with('>') { String::new() } else { s };
    Some(BenchQuestion {
        id,
        domain,
        prompt: clean(extract_section(&body, "Prompt")),
        context: clean(extract_section(&body, "Context")),
        notes: clean(extract_section(&body, "Notes")),
        council,
        expected_decision: if expected_decision.starts_with('<') { String::new() } else { expected_decision },
        expected_verdict_keywords: keywords,
        path: path.to_string_lossy().to_string(),
        created: if created.is_empty() { None } else { Some(created) },
        source: if source.is_empty() { None } else { Some(source) },
        edited: if edited.is_empty() { None } else { Some(edited) },
        archived,
    })
}

#[tauri::command]
pub(crate) fn benchmark_questions(vault: String) -> Result<Vec<BenchQuestion>, String> {
    let dir = Path::new(&vault).join("benchmark").join("questions");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if let Some(q) = parse_bench_question(&p) {
            out.push(q);
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in s.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if (ch == ' ' || ch == '-' || ch == '_') && !last_dash {
            out.push('-');
            last_dash = true;
        }
        if out.len() >= 50 {
            break;
        }
    }
    out.trim_matches('-').to_string()
}

#[tauri::command]
pub(crate) fn benchmark_save_question(vault: String, q: BenchQuestionInput) -> Result<BenchQuestion, String> {
    let dir = Path::new(&vault).join("benchmark").join("questions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Determine the id: keep existing, else slug from domain + prompt (unique).
    let id = match &q.id {
        Some(existing) if !existing.is_empty() => existing.clone(),
        _ => {
            let base = format!("{}-{}", slugify(&q.domain), {
                let s = slugify(&q.prompt);
                if s.is_empty() { "draft".into() } else { s }
            });
            let mut candidate = base.clone();
            let mut n = 2;
            while dir.join(format!("{candidate}.md")).exists() {
                candidate = format!("{base}-{n}");
                n += 1;
            }
            candidate
        }
    };
    let council = q.council.unwrap_or(false);
    let esc = |s: &str| -> String {
        if s.contains([':', '#', '"', '\n']) {
            format!("\"{}\"", s.replace('"', "\\\""))
        } else {
            s.to_string()
        }
    };
    let kw = q.expected_verdict_keywords.clone().unwrap_or_default();
    let kw_line = if kw.is_empty() {
        "[]".to_string()
    } else {
        format!("[{}]", kw.iter().map(|k| esc(k)).collect::<Vec<_>>().join(", "))
    };
    let path = dir.join(format!("{id}.md"));
    // Lifecycle: an edit never erases the version a past benchmark ran
    // against. Snapshot the existing file into _versions/ first, and carry
    // the original created/source/archived forward.
    let prior = parse_bench_question(&path);
    if let Some(p) = &prior {
        let changed = p.prompt != q.prompt.trim()
            || p.expected_decision != q.expected_decision.clone().unwrap_or_default()
            || p.expected_verdict_keywords != q.expected_verdict_keywords.clone().unwrap_or_default();
        if changed {
            let vdir = dir.join("_versions");
            let _ = fs::create_dir_all(&vdir);
            let stamp = {
                let secs = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                let (y, mo, d, h, mi, s) = secs_to_ymdhms(secs);
                format!("{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}")
            };
            let _ = fs::copy(&path, vdir.join(format!("{id}.{stamp}.md")));
        }
    }
    let today = {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let (y, mo, d, _, _, _) = secs_to_ymdhms(secs);
        format!("{y:04}-{mo:02}-{d:02}")
    };
    let created = prior.as_ref().and_then(|p| p.created.clone()).unwrap_or_else(|| today.clone());
    let source = prior.as_ref().and_then(|p| p.source.clone()).unwrap_or_else(|| "user".to_string());
    let archived = prior.as_ref().map(|p| p.archived).unwrap_or(false);
    let mut md = String::new();
    md.push_str("---\n");
    md.push_str(&format!("id: {id}\n"));
    md.push_str(&format!("domain: {}\n", q.domain));
    md.push_str(&format!("created: {created}\n"));
    md.push_str(&format!("source: {source}\n"));
    if archived {
        md.push_str("archived: true\n");
    }
    if prior.is_some() {
        md.push_str(&format!("edited: {today}\n"));
    }
    md.push_str(&format!("council: {council}\n"));
    md.push_str(&format!(
        "expected_decision: {}\n",
        esc(q.expected_decision.as_deref().unwrap_or(""))
    ));
    md.push_str(&format!("expected_verdict_keywords: {kw_line}\n"));
    md.push_str("---\n\n");
    md.push_str("## Prompt\n\n");
    md.push_str(q.prompt.trim());
    md.push_str("\n\n## Context\n\n");
    md.push_str(q.context.as_deref().unwrap_or("").trim());
    md.push_str("\n\n## Notes\n\n");
    md.push_str(q.notes.as_deref().unwrap_or("").trim());
    md.push('\n');
    fs::write(&path, engine::maybe_encrypt(&path, &md)).map_err(|e| e.to_string())?;
    parse_bench_question(&path).ok_or_else(|| "failed to re-read saved question".into())
}

/// Archive / unarchive a question in place: flips the frontmatter flag, so
/// the file (and every past run that referenced it) stays intact while new
/// runs and the active list exclude it.
#[tauri::command]
pub(crate) fn benchmark_set_question_archived(path: String, archived: bool) -> Result<(), String> {
    if !path.replace('\\', "/").contains("/benchmark/questions/") || !path.ends_with(".md") {
        return Err("not a benchmark question file".into());
    }
    let raw = read_to_string_retry(&path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = raw.lines().map(str::to_string).collect();
    // Remove any existing archived: line inside the frontmatter block.
    if lines.first().map(|l| l.trim()) == Some("---") {
        let end = lines.iter().skip(1).position(|l| l.trim() == "---").map(|i| i + 1);
        if let Some(end) = end {
            lines.retain({
                let mut idx = 0usize;
                move |l| {
                    let keep = !(idx > 0 && idx < end && l.trim_start().starts_with("archived:"));
                    idx += 1;
                    keep
                }
            });
            if archived {
                lines.insert(1, "archived: true".to_string());
            }
            fs::write(Path::new(&path), engine::maybe_encrypt(Path::new(&path), &format!("{}\n", lines.join("\n")))).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("malformed question file (no frontmatter)".into())
}

#[tauri::command]
pub(crate) fn benchmark_delete_question(path: String) -> Result<(), String> {
    // Guard: only delete inside a benchmark/questions directory.
    if !path.replace('\\', "/").contains("/benchmark/questions/") || !path.ends_with(".md") {
        return Err("refusing to delete: not a benchmark question file".into());
    }
    fs::remove_file(&path).map_err(|e| e.to_string())
}

// Export/import the question set as one portable JSON document, so a suite
// can be shared, backed up, or moved between vaults. Format:
//   { "schema": "prevail.bench/v1", "questions": [BenchQuestionInput…] }

#[tauri::command]
pub(crate) fn benchmark_export_questions(vault: String, dest: Option<String>) -> Result<String, String> {
    let questions = benchmark_questions(vault)?;
    let items: Vec<serde_json::Value> = questions
        .iter()
        .map(|q| {
            serde_json::json!({
                "id": q.id,
                "domain": q.domain,
                "prompt": q.prompt,
                "context": q.context,
                "notes": q.notes,
                "council": q.council,
                "expected_decision": q.expected_decision,
                "expected_verdict_keywords": q.expected_verdict_keywords,
            })
        })
        .collect();
    let doc = serde_json::to_string_pretty(&serde_json::json!({
        "schema": "prevail.bench/v1",
        "questions": items,
    }))
    .map_err(|e| e.to_string())?;
    if let Some(dest) = dest {
        fs::write(&dest, &doc).map_err(|e| format!("write {dest}: {e}"))?;
    }
    Ok(doc)
}

#[derive(Serialize)]
pub(crate) struct BenchImportReport {
    created: Vec<String>,
    skipped: Vec<String>,
}

#[tauri::command]
pub(crate) fn benchmark_import_questions(vault: String, json: String) -> Result<BenchImportReport, String> {
    let doc: serde_json::Value = serde_json::from_str(&json).map_err(|e| format!("invalid JSON: {e}"))?;
    if doc.get("schema").and_then(|s| s.as_str()) != Some("prevail.bench/v1") {
        return Err("not a prevail.bench/v1 file (missing/incorrect \"schema\")".into());
    }
    let items = doc
        .get("questions")
        .and_then(|q| q.as_array())
        .ok_or("missing \"questions\" array")?;
    let dir = Path::new(&vault).join("benchmark").join("questions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut report = BenchImportReport { created: vec![], skipped: vec![] };
    for item in items {
        let q: BenchQuestionInput = match serde_json::from_value(item.clone()) {
            Ok(q) => q,
            Err(_) => {
                report.skipped.push(
                    item.get("id").and_then(|v| v.as_str()).unwrap_or("(malformed)").to_string(),
                );
                continue;
            }
        };
        // Never overwrite an existing question on import — skip and report.
        if let Some(id) = &q.id {
            if !id.is_empty() && dir.join(format!("{id}.md")).exists() {
                report.skipped.push(id.clone());
                continue;
            }
        }
        match benchmark_save_question(vault.clone(), q) {
            Ok(saved) => report.created.push(saved.id),
            Err(_) => report.skipped.push("(write failed)".into()),
        }
    }
    Ok(report)
}

// ── Effectiveness matrix ──────────────────────────────────────────────
// Per-run, per-domain effectiveness, so the UI can pivot "which model is best
// for which domain". Reads every run's score.json.

#[derive(Deserialize)]
struct ScoreQuestion {
    domain: String,
    judge_score: Option<f64>,
    keyword_score: Option<f64>,
}

#[derive(Deserialize)]
struct MatrixScoreFile {
    label: String,
    #[serde(rename = "runDir")]
    run_dir: String,
    judge_avg: Option<f64>,
    keyword_avg: Option<f64>,
    #[serde(rename = "questionScores")]
    question_scores: Vec<ScoreQuestion>,
}

#[derive(Serialize)]
pub(crate) struct DomainCell {
    judge_avg: Option<f64>,
    keyword_avg: Option<f64>,
    count: usize,
}

#[derive(Serialize)]
pub(crate) struct MatrixRow {
    label: String,
    run_dir: String,
    judge_avg: Option<f64>,
    keyword_avg: Option<f64>,
    per_domain: std::collections::HashMap<String, DomainCell>,
}

#[tauri::command]
pub(crate) fn benchmark_matrix(vault: String) -> Result<Vec<MatrixRow>, String> {
    let runs_dir = Path::new(&vault).join("benchmark").join("runs");
    if !runs_dir.exists() {
        return Ok(vec![]);
    }
    let mut rows = Vec::new();
    for entry in fs::read_dir(&runs_dir).map_err(|e| e.to_string())?.flatten() {
        let score_file = entry.path().join("score.json");
        if !score_file.exists() {
            continue;
        }
        let raw = match read_to_string_retry(&score_file) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let parsed: MatrixScoreFile = match serde_json::from_str(&raw) {
            Ok(p) => p,
            Err(_) => continue,
        };
        // Group this run's questions by domain.
        let mut by_domain: std::collections::HashMap<String, (Vec<f64>, Vec<f64>)> =
            std::collections::HashMap::new();
        for qs in &parsed.question_scores {
            let e = by_domain.entry(qs.domain.clone()).or_default();
            if let Some(j) = qs.judge_score {
                e.0.push(j);
            }
            if let Some(k) = qs.keyword_score {
                e.1.push(k);
            }
        }
        let avg = |xs: &[f64]| -> Option<f64> {
            if xs.is_empty() {
                None
            } else {
                Some((xs.iter().sum::<f64>() / xs.len() as f64 * 10.0).round() / 10.0)
            }
        };
        let mut per_domain = std::collections::HashMap::new();
        for (d, (js, ks)) in by_domain {
            let count = js.len().max(ks.len());
            per_domain.insert(d, DomainCell { judge_avg: avg(&js), keyword_avg: avg(&ks), count });
        }
        rows.push(MatrixRow {
            label: parsed.label,
            run_dir: parsed.run_dir,
            judge_avg: parsed.judge_avg,
            keyword_avg: parsed.keyword_avg,
            per_domain,
        });
    }
    Ok(rows)
}
