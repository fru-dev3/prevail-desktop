// Retrospect — "where did my attention go?" It rolls the per-domain intent
// ledgers (_intents.jsonl, one record per prompt) up into time periods so the UI
// can show, by day / week / month / year: how many prompts, split by domain, and
// the threads of work underneath. Pure read-over of data Prevail already writes;
// no new capture. The counts and threads are REAL (straight from the ledger); the
// one-line "theme" headline is added later by a cached distill pass.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_LONG: [&str; 12] = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December",
];

// Civil date (year, month 1-12, day 1-31) from a day-count since the Unix epoch.
// Howard Hinnant's days_from_civil inverse — exact, no external crate.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// Local day-index for an epoch-ms timestamp, given the browser's tz offset (the
// value of Date.getTimezoneOffset(): minutes to ADD to local to reach UTC).
fn local_days(ts_ms: i64, tz_off_min: i64) -> i64 {
    let local_ms = ts_ms - tz_off_min * 60_000;
    local_ms.div_euclid(86_400_000)
}

// Monday-based day index (Mon = 0 … Sun = 6). Epoch day 0 = 1970-01-01 = Thursday.
fn weekday_mon(days: i64) -> i64 {
    (days + 3).rem_euclid(7)
}

// Bucket key + human label for a timestamp under the chosen vantage.
fn period_key(ts_ms: i64, vantage: &str, tz: i64) -> (String, String) {
    let days = local_days(ts_ms, tz);
    let (y, m, d) = civil_from_days(days);
    match vantage {
        "day" => (
            format!("{y:04}-{m:02}-{d:02}"),
            format!("{} {}, {}", MONTHS[(m - 1) as usize], d, y),
        ),
        "week" => {
            let mon = days - weekday_mon(days);
            let sun = mon + 6;
            let (my, mm, md) = civil_from_days(mon);
            let (_sy, sm, sd) = civil_from_days(sun);
            let label = if mm == sm {
                format!("{} {}–{}", MONTHS[(mm - 1) as usize], md, sd)
            } else {
                format!("{} {} – {} {}", MONTHS[(mm - 1) as usize], md, MONTHS[(sm - 1) as usize], sd)
            };
            (format!("{my:04}-W{mon}"), label)
        }
        "year" => (format!("{y:04}"), format!("{y}")),
        _ => (
            format!("{y:04}-{m:02}"),
            format!("{} {}", MONTHS_LONG[(m - 1) as usize], y),
        ),
    }
}

#[derive(Default)]
struct Bucket {
    label: String,
    total: u64,
    first_ts: i64,
    by_domain: HashMap<String, u64>,
    // session id -> (domain, first message, earliest ts, count)
    threads: HashMap<String, ThreadAcc>,
}

struct ThreadAcc {
    domain: String,
    message: String,
    ts: i64,
    count: u64,
}

// Find every domain intent ledger under the vault: v4 (`data/domains/<d>`),
// legacy flat (`<vault>/<d>`), and the General bucket at the vault root.
fn discover_ledgers(vault: &Path) -> Vec<(String, PathBuf)> {
    let mut out: Vec<(String, PathBuf)> = Vec::new();
    let mut push_if = |domain: String, dir: &Path| {
        // v4: raw prompt ledger (the journal) is .system/journal.jsonl; fall back
        // to the legacy flat _intents.jsonl on un-migrated domains.
        let v4 = dir.join(".system/journal.jsonl");
        let led = if v4.exists() { v4 } else { dir.join("_intents.jsonl") };
        if led.exists() {
            out.push((domain, led));
        }
    };
    // General at the vault root.
    push_if("general".into(), vault);
    // v4 domains.
    let v4 = vault.join("data").join("domains");
    for base in [v4.as_path(), vault] {
        if let Ok(rd) = std::fs::read_dir(base) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                    // Skip plumbing dirs so a flat-layout walk doesn't grab build/, data/, etc.
                    if name.is_empty() || name.starts_with('.') || matches!(name.as_str(), "data" | "build" | "_meta" | "node_modules") {
                        continue;
                    }
                    push_if(name, &p);
                }
            }
        }
    }
    out
}

/// Roll the intent ledgers up into time periods. `vantage` is day|week|month|year.
/// Returns `{ vantage, periods: [{ key, label, total, byDomain:[{domain,count}],
/// threads:[{domain,message,ts,count}] }] }`, newest period first.
#[tauri::command]
pub fn retrospect_rollup(
    vault: String,
    vantage: String,
    tz_offset_minutes: Option<i64>,
) -> Result<serde_json::Value, String> {
    let vault_path = Path::new(&vault);
    if !vault_path.exists() {
        return Err(format!("vault not found: {vault}"));
    }
    let vantage = match vantage.as_str() {
        "day" | "week" | "month" | "year" => vantage,
        _ => "month".to_string(),
    };
    let tz = tz_offset_minutes.unwrap_or(0);
    let mut buckets: HashMap<String, Bucket> = HashMap::new();
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();

    for (domain, ledger) in discover_ledgers(vault_path) {
        if !seen.insert(ledger.clone()) {
            continue; // a domain matched under both roots — count it once
        }
        let text = match std::fs::read_to_string(&ledger) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let v: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            // Only real prompt intents (kind "intent" or unset); skip other records.
            if let Some(k) = v.get("kind").and_then(|k| k.as_str()) {
                if k != "intent" {
                    continue;
                }
            }
            let ts = v.get("ts").and_then(|t| t.as_i64()).unwrap_or(0);
            if ts <= 0 {
                continue;
            }
            let dom = v
                .get("domain")
                .and_then(|d| d.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(&domain)
                .to_string();
            let message = v
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let session = v
                .get("session")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();

            let (key, label) = period_key(ts, &vantage, tz);
            let b = buckets.entry(key.clone()).or_default();
            if b.label.is_empty() {
                b.label = label;
            }
            b.total += 1;
            if b.first_ts == 0 || ts < b.first_ts {
                b.first_ts = ts;
            }
            *b.by_domain.entry(dom.clone()).or_insert(0) += 1;
            let tk = if session.is_empty() { format!("{key}-{ts}") } else { session };
            let t = b.threads.entry(tk).or_insert_with(|| ThreadAcc {
                domain: dom.clone(),
                message: message.clone(),
                ts,
                count: 0,
            });
            t.count += 1;
            if ts < t.ts {
                t.ts = ts;
                if !message.is_empty() {
                    t.message = message.clone();
                }
            }
        }
    }

    // Serialize: periods newest-first (by key desc, which is chrono order for our keys).
    let mut keys: Vec<String> = buckets.keys().cloned().collect();
    keys.sort();
    keys.reverse();
    let periods: Vec<serde_json::Value> = keys
        .iter()
        .map(|k| {
            let b = &buckets[k];
            let mut by_domain: Vec<(String, u64)> = b.by_domain.iter().map(|(d, c)| (d.clone(), *c)).collect();
            by_domain.sort_by(|a, c| c.1.cmp(&a.1).then(a.0.cmp(&c.0)));
            let by_domain_json: Vec<serde_json::Value> = by_domain
                .iter()
                .map(|(d, c)| serde_json::json!({ "domain": d, "count": c }))
                .collect();
            let mut threads: Vec<&ThreadAcc> = b.threads.values().collect();
            threads.sort_by(|a, c| c.count.cmp(&a.count).then(c.ts.cmp(&a.ts)));
            let threads_json: Vec<serde_json::Value> = threads
                .iter()
                .filter(|t| !t.message.is_empty())
                .take(24)
                .map(|t| serde_json::json!({ "domain": t.domain, "message": t.message, "ts": t.ts, "count": t.count }))
                .collect();
            serde_json::json!({
                "key": k,
                "label": b.label,
                "total": b.total,
                "byDomain": by_domain_json,
                "threads": threads_json,
            })
        })
        .collect();

    Ok(serde_json::json!({ "vantage": vantage, "periods": periods }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_epoch_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(31), (1970, 2, 1));
        // 2026-07-03 is day 20637 since epoch.
        let (y, m, _d) = civil_from_days(20637);
        assert_eq!((y, m), (2026, 7));
    }

    #[test]
    fn period_keys() {
        // 1783049959466 ms ~ 2026-07-01 UTC.
        let (mk, ml) = period_key(1783049959466, "month", 0);
        assert_eq!(mk, "2026-07");
        assert!(ml.contains("July") && ml.contains("2026"));
        let (yk, _) = period_key(1783049959466, "year", 0);
        assert_eq!(yk, "2026");
    }
}
