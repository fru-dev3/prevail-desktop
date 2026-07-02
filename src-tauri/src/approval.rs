// approval — server-side single-use approval tokens (C1 / O16).
//
// Consequential backend commands (e.g. loop_execute_action) must not trust that
// "the UI said the user approved". Instead: the backend MINTS an unguessable,
// short-lived token bound to the EXACT action payload; the UI passes it back when
// executing; the backend verifies-and-consumes it (single-use) bound to the same
// payload. A replayed, tampered, expired, or UI-fabricated token is rejected.
//
// Process-local by design: tokens live only in this process's memory, so a token
// is meaningless to anything but the engine that minted it.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

struct Pending {
    payload: String,
    exp: u64,
}

fn registry() -> &'static Mutex<HashMap<String, Pending>> {
    static R: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

const TTL_SECS: u64 = 180;

/// Canonical payload for an action so mint/verify agree byte-for-byte. The 0x1F
/// unit separator can't appear in a domain/action, so fields can't be confused.
pub fn action_payload(domain: &str, action: &str) -> String {
    format!("{domain}\u{1f}{action}")
}

/// Mint a single-use approval token bound to `payload`, valid for TTL_SECS.
pub fn mint(payload: &str) -> String {
    use rand::RngCore;
    let mut b = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut b);
    let token: String = b.iter().map(|x| format!("{x:02x}")).collect();
    let t = now();
    let mut g = registry().lock().unwrap_or_else(|e| e.into_inner());
    g.retain(|_, p| p.exp > t); // opportunistic GC of expired tokens
    g.insert(token.clone(), Pending { payload: payload.to_string(), exp: t + TTL_SECS });
    token
}

/// Verify a token for `payload` and consume it (single-use). Returns false for an
/// unknown/replayed/expired token or a payload mismatch.
pub fn verify_and_consume(token: &str, payload: &str) -> bool {
    let mut g = registry().lock().unwrap_or_else(|e| e.into_inner());
    // Only CONSUME on a valid match — a wrong-payload (or expired) attempt must
    // not burn a still-legitimate token. Single-use applies to success.
    match g.get(token) {
        Some(p) if p.exp > now() && p.payload == payload => {
            g.remove(token);
            true
        }
        _ => false,
    }
}

// ── X2: graduated autonomy classifier ───────────────────────────────────────
// Upgrades the brake from binary (allow / ask / never) to a graduated decision,
// the Cursor Auto-review pattern: an allowlisted class runs immediately, a
// reversible one runs sandboxed (auto, because it can be undone), reads are
// free, and only genuinely consequential classes (send/spend/irreversible/
// credential/unknown) stop for approval. This is the pure decision logic; the
// autonomy UI configures the per-class Decision and consumes this tier.

/// Graduated execution tier for one action, from its policy class + the user's
/// configured decision for that class.
///   "allow"   - run immediately (allowlisted / a read)
///   "sandbox" - run now but reversibly, no prompt (safe because it can be undone)
///   "ask"     - require explicit approval before running
///   "block"   - never run (hard denied)
pub fn classify_tier(class: &str, decision: &str) -> &'static str {
    match decision {
        "never" => "block",
        "allow" => "allow",
        // decision == "ask" (or anything unset): grade by how risky the class is.
        _ => match class {
            "read" => "allow",             // reads never need a prompt
            "reversible" => "sandbox",     // undoable → run, but reversibly
            "external_send" | "financial" | "irreversible" | "credential" => "ask",
            _ => "ask",                    // "unknown" and anything new: be cautious
        },
    }
}

/// Command form of `classify_tier` for the autonomy engine / UI.
#[tauri::command]
pub fn autonomy_classify(class: String, decision: String) -> String {
    classify_tier(&class, &decision).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graduated_classifier_tiers() {
        // Hard config wins regardless of class.
        assert_eq!(classify_tier("irreversible", "allow"), "allow");
        assert_eq!(classify_tier("read", "never"), "block");
        // decision "ask": graded by class risk.
        assert_eq!(classify_tier("read", "ask"), "allow");
        assert_eq!(classify_tier("reversible", "ask"), "sandbox");
        assert_eq!(classify_tier("external_send", "ask"), "ask");
        assert_eq!(classify_tier("financial", "ask"), "ask");
        assert_eq!(classify_tier("credential", "ask"), "ask");
        assert_eq!(classify_tier("unknown", "ask"), "ask");
        // Unset decision defaults to the cautious branch too.
        assert_eq!(classify_tier("reversible", ""), "sandbox");
    }

    #[test]
    fn mint_then_verify_once_bound_to_payload() {
        let p = action_payload("career", "email the recruiter");
        let tok = mint(&p);
        // wrong payload rejected
        assert!(!verify_and_consume(&tok, &action_payload("career", "delete everything")));
        // correct payload accepted...
        assert!(verify_and_consume(&tok, &p));
        // ...but only once (single-use)
        assert!(!verify_and_consume(&tok, &p));
    }

    #[test]
    fn unknown_and_fabricated_tokens_rejected() {
        assert!(!verify_and_consume("deadbeef", &action_payload("x", "y")));
        assert!(!verify_and_consume("", &action_payload("x", "y")));
    }

    #[test]
    fn expired_token_rejected() {
        let p = action_payload("d", "a");
        let tok = mint(&p);
        // force-expire the entry
        {
            let mut g = registry().lock().unwrap();
            if let Some(e) = g.get_mut(&tok) {
                e.exp = 0;
            }
        }
        assert!(!verify_and_consume(&tok, &p));
    }
}
