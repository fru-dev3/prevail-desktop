// Email native bridge (A6) — IMAP poll + SMTP reply.
//
// The most universal surface: the user emails their council and gets a reply.
// Inbound is an IMAP poll for UNSEEN messages (the `imap` crate is blocking, so
// each poll runs on spawn_blocking); the plain-text body is extracted with
// mailparse. The reply is sent over SMTP (lettre) back to the message's From
// address. Off by default; the IMAP password lives in the Keychain.
//
// First implementation — verify against a real mailbox before relying on it.
// (Gmail etc. require an app-specific password, which is the user's credential.)

use std::sync::{Arc, Mutex};
use std::time::Duration;

use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tokio::sync::{watch, Mutex as AsyncMutex};

use crate::telegram_bridge::{record_exchange, resolve_domain, run_cli, BridgeConfig, BridgeStatus, RouteRule};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmailConfig {
    pub imap_host: String,
    #[serde(default)]
    pub imap_port: Option<u16>, // default 993
    pub smtp_host: String,
    #[serde(default)]
    pub smtp_port: Option<u16>, // default 587 (STARTTLS)
    pub username: String,
    pub password: String, // Keychain if empty
    pub from_addr: String, // the council's From: address
    pub cli: String,
    pub model: Option<String>,
    pub domain: Option<String>,
    #[serde(default)]
    pub vault: Option<String>,
    #[serde(default)]
    pub routes: Vec<RouteRule>,
    #[serde(default)]
    pub poll_secs: Option<u64>,
}

#[derive(Default)]
pub struct EmailState {
    inner: Mutex<Inner>,
}
#[derive(Default)]
struct Inner {
    stop_tx: Option<watch::Sender<bool>>,
    handle: Option<JoinHandle<()>>,
    status: Arc<AsyncMutex<BridgeStatus>>,
}

struct Inbound {
    from: String,
    subject: String,
    body: String,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

impl EmailState {
    pub async fn status(&self) -> BridgeStatus {
        let arc = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).status.clone() };
        let g = arc.lock().await;
        g.clone()
    }
    pub async fn stop(&self) {
        let (tx, h, arc) = {
            let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            (i.stop_tx.take(), i.handle.take(), i.status.clone())
        };
        if let Some(tx) = tx { let _ = tx.send(true); }
        if let Some(h) = h { h.abort(); }
        arc.lock().await.running = false;
    }
    pub async fn start(&self, cfg: EmailConfig) -> Result<(), String> {
        crate::bunker::guard_cloud()?;
        self.stop().await;
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let status = Arc::new(AsyncMutex::new(BridgeStatus { running: true, ..Default::default() }));
        let status_task = status.clone();
        let poll = Duration::from_secs(cfg.poll_secs.unwrap_or(20).max(10));

        let handle = tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => { if *stop_rx.borrow() { break; } }
                    _ = tokio::time::sleep(poll) => {
                        let c = cfg.clone();
                        // IMAP is blocking — fetch on a blocking thread.
                        let fetched = tauri::async_runtime::spawn_blocking(move || fetch_imap(&c)).await;
                        let msgs = match fetched {
                            Ok(Ok(m)) => m,
                            Ok(Err(e)) => { status_task.lock().await.last_error = Some(e); continue; }
                            Err(e) => { status_task.lock().await.last_error = Some(format!("imap task: {e}")); continue; }
                        };
                        for inc in msgs {
                            { let mut s = status_task.lock().await; s.inbound_count += 1; s.last_inbound_ts = Some(now_secs()); }
                            let prompt = if inc.subject.is_empty() { inc.body.clone() } else { format!("{}\n\n{}", inc.subject, inc.body) };
                            let bcfg = bridge_cfg(&cfg);
                            let domain = cfg.domain.clone().or_else(|| resolve_domain(&bcfg, &prompt));
                            let reply = match run_cli(&cfg.cli, cfg.model.as_deref(), &prompt).await {
                                Ok(r) => r,
                                Err(e) => { status_task.lock().await.last_error = Some(e); continue; }
                            };
                            let c2 = cfg.clone();
                            let to = inc.from.clone();
                            let subj = inc.subject.clone();
                            let reply2 = reply.clone();
                            let sent = tauri::async_runtime::spawn_blocking(move || send_smtp(&c2, &to, &subj, &reply2)).await;
                            match sent {
                                Ok(Ok(())) => {
                                    if let Some(dm) = domain.as_deref() { record_exchange(&bcfg, dm, &prompt, &reply); }
                                    let mut s = status_task.lock().await; s.outbound_count += 1; s.last_outbound_ts = Some(now_secs());
                                }
                                Ok(Err(e)) => { status_task.lock().await.last_error = Some(e); }
                                Err(e) => { status_task.lock().await.last_error = Some(format!("smtp task: {e}")); }
                            }
                        }
                    }
                }
            }
        });
        let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        i.stop_tx = Some(stop_tx);
        i.handle = Some(handle);
        i.status = status;
        Ok(())
    }
}

fn bridge_cfg(cfg: &EmailConfig) -> BridgeConfig {
    BridgeConfig {
        token: String::new(), chat_id: cfg.username.clone(), cli: cfg.cli.clone(),
        model: cfg.model.clone(), domain: cfg.domain.clone(), vault: cfg.vault.clone(), routes: cfg.routes.clone(),
    }
}

// Blocking IMAP poll: fetch UNSEEN, parse the plain-text body, leave them marked
// seen (the fetch of the body sets \Seen unless we PEEK — we WANT them consumed).
fn fetch_imap(cfg: &EmailConfig) -> Result<Vec<Inbound>, String> {
    let host = cfg.imap_host.as_str();
    let port = cfg.imap_port.unwrap_or(993);
    let tls = native_tls::TlsConnector::builder().build().map_err(|e| format!("tls: {e}"))?;
    let client = imap::connect((host, port), host, &tls).map_err(|e| format!("imap connect: {e}"))?;
    let mut session = client.login(&cfg.username, &cfg.password).map_err(|e| format!("imap login: {}", e.0))?;
    session.select("INBOX").map_err(|e| format!("imap select: {e}"))?;
    let unseen = session.search("UNSEEN").map_err(|e| format!("imap search: {e}"))?;
    let mut out = Vec::new();
    for uid in unseen.into_iter().take(10) {
        let fetches = match session.fetch(uid.to_string(), "RFC822") {
            Ok(f) => f,
            Err(_) => continue,
        };
        for msg in fetches.iter() {
            if let Some(raw) = msg.body() {
                if let Ok(parsed) = mailparse::parse_mail(raw) {
                    let from = header(&parsed, "From");
                    let subject = header(&parsed, "Subject");
                    let body = plain_text_body(&parsed);
                    if !from.is_empty() && !body.trim().is_empty() {
                        out.push(Inbound { from: extract_addr(&from), subject, body });
                    }
                }
            }
        }
    }
    let _ = session.logout();
    Ok(out)
}

fn header(mail: &mailparse::ParsedMail, name: &str) -> String {
    use mailparse::MailHeaderMap;
    mail.headers.get_first_value(name).unwrap_or_default()
}

// The first text/plain part's decoded body (falls back to the top-level body).
fn plain_text_body(mail: &mailparse::ParsedMail) -> String {
    if mail.subparts.is_empty() {
        return mail.get_body().unwrap_or_default();
    }
    for part in &mail.subparts {
        if part.ctype.mimetype == "text/plain" {
            if let Ok(b) = part.get_body() { return b; }
        }
        let nested = plain_text_body(part);
        if !nested.trim().is_empty() { return nested; }
    }
    mail.get_body().unwrap_or_default()
}

// "Name <a@b.com>" → "a@b.com"; a bare address passes through.
fn extract_addr(from: &str) -> String {
    if let (Some(lt), Some(gt)) = (from.find('<'), from.find('>')) {
        if gt > lt { return from[lt + 1..gt].trim().to_string(); }
    }
    from.trim().to_string()
}

fn send_smtp(cfg: &EmailConfig, to: &str, in_subject: &str, body: &str) -> Result<(), String> {
    let subject = if in_subject.to_lowercase().starts_with("re:") { in_subject.to_string() } else { format!("Re: {in_subject}") };
    let email = Message::builder()
        .from(cfg.from_addr.parse().map_err(|e| format!("from addr: {e}"))?)
        .to(to.parse().map_err(|e| format!("to addr: {e}"))?)
        .subject(subject)
        .body(body.to_string())
        .map_err(|e| format!("build email: {e}"))?;
    let creds = Credentials::new(cfg.username.clone(), cfg.password.clone());
    let mailer = SmtpTransport::starttls_relay(&cfg.smtp_host)
        .map_err(|e| format!("smtp relay: {e}"))?
        .port(cfg.smtp_port.unwrap_or(587))
        .credentials(creds)
        .build();
    mailer.send(&email).map_err(|e| format!("smtp send: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn email_bridge_start(state: tauri::State<'_, EmailState>, cfg: EmailConfig) -> Result<BridgeStatus, String> {
    let mut cfg = cfg;
    if cfg.password.trim().is_empty() {
        cfg.password = crate::ingestion::keychain::get("prevail.providers", "native-email").unwrap_or_default();
        if cfg.password.trim().is_empty() { return Err("no email password configured".into()); }
    }
    state.start(cfg).await?;
    Ok(state.status().await)
}
#[tauri::command]
pub async fn email_bridge_stop(state: tauri::State<'_, EmailState>) -> Result<BridgeStatus, String> {
    state.stop().await; Ok(state.status().await)
}
#[tauri::command]
pub async fn email_bridge_status(state: tauri::State<'_, EmailState>) -> Result<BridgeStatus, String> {
    Ok(state.status().await)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extract_addr_handles_named_and_bare() {
        assert_eq!(extract_addr("Fru <fru@example.com>"), "fru@example.com");
        assert_eq!(extract_addr("bare@example.com"), "bare@example.com");
    }
    #[test]
    fn plain_text_body_reads_simple_mail() {
        let raw = b"Subject: Hi\r\nFrom: a@b.com\r\n\r\nHello there";
        let m = mailparse::parse_mail(raw).unwrap();
        assert!(plain_text_body(&m).contains("Hello there"));
        assert_eq!(header(&m, "Subject"), "Hi");
    }
}
