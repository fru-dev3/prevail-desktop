// X8: server-side Web Push (RFC 8291 / VAPID) so the WebUI can deliver a
// notification to a browser tab that is BACKGROUNDED OR CLOSED. The desktop host
// is the push origin (it runs the WebUI server and already detects approvals);
// browsers subscribe via the service worker and POST their subscription here.
//
// Flow:
//   1. On first use we generate a VAPID EC P-256 keypair and persist it.
//   2. The client GETs the public key, subscribes with pushManager, and POSTs
//      the resulting subscription.
//   3. push_all() sends an encrypted payload to every stored subscription,
//      signed with VAPID; the service worker's `push` handler shows it.
//
// Delivery itself rides the browser's push service (FCM/Mozilla), so it can only
// be exercised end-to-end against a real device; the crypto, key persistence,
// subscription storage, and message construction are all unit-testable here.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::read_to_string_retry;

fn b64url(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn config_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join("Library/Application Support/sh.prevail.desktop"))
}

fn vapid_path() -> Option<PathBuf> {
    Some(config_dir()?.join("webui-vapid.json"))
}
fn subs_path() -> Option<PathBuf> {
    Some(config_dir()?.join("webui-push-subs.json"))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VapidKeys {
    /// PKCS#8/SEC1 PEM private key (fed to web-push's VapidSignatureBuilder).
    pub private_pem: String,
    /// Uncompressed public point, base64url (the client's applicationServerKey).
    pub public_b64url: String,
}

/// Generate a fresh VAPID EC P-256 keypair (via OpenSSL, already a dependency).
pub fn generate_keys() -> Result<VapidKeys, String> {
    use openssl::bn::BigNumContext;
    use openssl::ec::{EcGroup, EcKey, PointConversionForm};
    use openssl::nid::Nid;
    let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).map_err(|e| e.to_string())?;
    let key = EcKey::generate(&group).map_err(|e| e.to_string())?;
    let private_pem = String::from_utf8(key.private_key_to_pem().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let mut ctx = BigNumContext::new().map_err(|e| e.to_string())?;
    let point = key
        .public_key()
        .to_bytes(&group, PointConversionForm::UNCOMPRESSED, &mut ctx)
        .map_err(|e| e.to_string())?;
    Ok(VapidKeys { private_pem, public_b64url: b64url(&point) })
}

/// Load the persisted VAPID keypair, generating + saving one on first use.
pub fn load_or_create_keys() -> Result<VapidKeys, String> {
    let path = vapid_path().ok_or("no config dir")?;
    if path.exists() {
        let raw = read_to_string_retry(&path).map_err(|e| e.to_string())?;
        if let Ok(k) = serde_json::from_str::<VapidKeys>(&raw) {
            return Ok(k);
        }
    }
    let keys = generate_keys()?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, serde_json::to_string(&keys).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(keys)
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
pub struct PushSub {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}

/// In-memory subscription set, mirrored to disk so it survives a restart.
#[derive(Default)]
pub struct PushStore {
    subs: Mutex<Vec<PushSub>>,
}

impl PushStore {
    pub fn load(&self) {
        let Some(path) = subs_path() else { return };
        if let Ok(raw) = read_to_string_retry(&path) {
            if let Ok(v) = serde_json::from_str::<Vec<PushSub>>(&raw) {
                *self.subs.lock().unwrap_or_else(|e| e.into_inner()) = v;
            }
        }
    }
    fn persist(&self, subs: &[PushSub]) {
        let Some(path) = subs_path() else { return };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(s) = serde_json::to_string(subs) {
            let _ = std::fs::write(&path, s);
        }
    }
    /// Add (or de-dup) a subscription. Returns the current count.
    pub fn add(&self, sub: PushSub) -> usize {
        let mut g = self.subs.lock().unwrap_or_else(|e| e.into_inner());
        if !g.iter().any(|s| s.endpoint == sub.endpoint) {
            g.push(sub);
            self.persist(&g);
        }
        g.len()
    }
    pub fn all(&self) -> Vec<PushSub> {
        self.subs.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    /// Drop subscriptions the push service has permanently rejected (410/404).
    pub fn remove_endpoints(&self, dead: &[String]) {
        if dead.is_empty() {
            return;
        }
        let mut g = self.subs.lock().unwrap_or_else(|e| e.into_inner());
        g.retain(|s| !dead.contains(&s.endpoint));
        self.persist(&g);
    }
}

/// Send one notification payload to every stored subscription, signed with
/// VAPID. Prunes subscriptions the service permanently rejects. Async: run on
/// the tauri runtime. Returns the number sent.
pub async fn push_all(store: &PushStore, title: &str, body: &str) -> Result<usize, String> {
    use web_push::{
        ContentEncoding, SubscriptionInfo, VapidSignatureBuilder, WebPushClient,
        WebPushMessageBuilder,
    };
    let subs = store.all();
    if subs.is_empty() {
        return Ok(0);
    }
    let keys = load_or_create_keys()?;
    let payload = serde_json::json!({ "title": title, "body": body, "tag": "prevail" }).to_string();
    let client = web_push::HyperWebPushClient::new();
    let mut sent = 0usize;
    let mut dead: Vec<String> = Vec::new();
    for s in &subs {
        let info = SubscriptionInfo::new(s.endpoint.clone(), s.p256dh.clone(), s.auth.clone());
        let sig = match VapidSignatureBuilder::from_pem(keys.private_pem.as_bytes(), &info)
            .and_then(|b| b.build())
        {
            Ok(sig) => sig,
            Err(e) => return Err(format!("vapid sign: {e}")),
        };
        let mut builder = WebPushMessageBuilder::new(&info);
        builder.set_payload(ContentEncoding::Aes128Gcm, payload.as_bytes());
        builder.set_vapid_signature(sig);
        let msg = match builder.build() {
            Ok(m) => m,
            Err(e) => return Err(format!("build push: {e}")),
        };
        match client.send(msg).await {
            Ok(_) => sent += 1,
            Err(web_push::WebPushError::EndpointNotFound(_))
            | Err(web_push::WebPushError::EndpointNotValid(_)) => dead.push(s.endpoint.clone()),
            Err(_) => { /* transient; keep the subscription, skip this round */ }
        }
    }
    store.remove_endpoints(&dead);
    Ok(sent)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_distinct_p256_vapid_keys() {
        let a = generate_keys().expect("gen a");
        let b = generate_keys().expect("gen b");
        assert!(a.private_pem.contains("EC PRIVATE KEY") || a.private_pem.contains("PRIVATE KEY"));
        // Uncompressed P-256 point = 65 bytes → 87 base64url chars, and unique.
        assert!(a.public_b64url.len() >= 80);
        assert_ne!(a.public_b64url, b.public_b64url);
    }

    #[test]
    fn store_dedups_and_prunes() {
        let store = PushStore::default();
        let s = PushSub { endpoint: "https://x/1".into(), p256dh: "p".into(), auth: "a".into() };
        assert_eq!(store.add(s.clone()), 1);
        assert_eq!(store.add(s.clone()), 1); // de-dup by endpoint
        store.remove_endpoints(&["https://x/1".into()]);
        assert_eq!(store.all().len(), 0);
    }
}
