// Settings sections extracted from App.tsx: the Connectors catalog (with its
// CONNECTOR_GROUPS data) and the Vault encryption card.
import { useEffect, useState } from "react";
import { Heart, Landmark, Loader2, Mail, MessageSquare, Shield } from "lucide-react";
import { siAirtable, siAsana, siCalendly, siCoinbase, siDiscord, siDropbox, siFitbit, siGithub, siGitlab, siGmail, siGooglecalendar, siGoogledrive, siGooglesheets, siHubspot, siLinear, siNotion, siObsidian, siQuickbooks, siReddit, siRobinhood, siShopify, siSpotify, siStrava, siStripe, siTelegram, siTodoist, siTrello, siWhatsapp, siWise, siYoutube, siZoom } from "simple-icons";
import { invoke } from "./bridge";
import { DesktopOnly } from "./emptystate";
import { backupVaultNow } from "./backup";
import type { Brand, Connector } from "./types";

export const CONNECTOR_GROUPS: { category: string; items: Connector[] }[] = [
  { category: "Finance", items: [
    { name: "Plaid (banks & cards)", domain: "wealth", icon: Landmark, color: "#111111" },
    { name: "Coinbase", domain: "wealth", brand: siCoinbase as Brand },
    { name: "Robinhood", domain: "wealth", brand: siRobinhood as Brand },
    { name: "Wise", domain: "wealth", brand: siWise as Brand },
    { name: "QuickBooks", domain: "business", brand: siQuickbooks as Brand },
    { name: "Stripe", domain: "business", brand: siStripe as Brand },
    { name: "Shopify", domain: "business", brand: siShopify as Brand },
  ]},
  { category: "Email & Calendar", items: [
    { name: "Gmail", domain: "general", brand: siGmail as Brand },
    { name: "Outlook / IMAP", domain: "general", icon: Mail, color: "#0A66C2" },
    { name: "Google Calendar", domain: "calendar", brand: siGooglecalendar as Brand },
    { name: "Calendly", domain: "calendar", brand: siCalendly as Brand },
  ]},
  { category: "Files & Notes", items: [
    { name: "Google Drive", domain: "general", brand: siGoogledrive as Brand },
    { name: "Google Sheets", domain: "general", brand: siGooglesheets as Brand },
    { name: "Dropbox", domain: "general", brand: siDropbox as Brand },
    { name: "Notion", domain: "general", brand: siNotion as Brand },
    { name: "Obsidian", domain: "general", brand: siObsidian as Brand },
  ]},
  { category: "Productivity", items: [
    { name: "Slack", domain: "general", icon: MessageSquare, color: "#4A154B" },
    { name: "Linear", domain: "career", brand: siLinear as Brand },
    { name: "Trello", domain: "general", brand: siTrello as Brand },
    { name: "Asana", domain: "general", brand: siAsana as Brand },
    { name: "Todoist", domain: "general", brand: siTodoist as Brand },
    { name: "Airtable", domain: "general", brand: siAirtable as Brand },
    { name: "Zoom", domain: "general", brand: siZoom as Brand },
    { name: "HubSpot", domain: "business", brand: siHubspot as Brand },
  ]},
  { category: "Developer", items: [
    { name: "GitHub", domain: "career", brand: siGithub as Brand },
    { name: "GitLab", domain: "career", brand: siGitlab as Brand },
  ]},
  { category: "Health & Fitness", items: [
    { name: "Apple Health", domain: "health", icon: Heart, color: "#FF2D55" },
    { name: "Strava", domain: "health", brand: siStrava as Brand },
    { name: "Fitbit", domain: "health", brand: siFitbit as Brand },
  ]},
  { category: "Social & Media", items: [
    { name: "Reddit", domain: "explore", brand: siReddit as Brand },
    { name: "YouTube", domain: "content", brand: siYoutube as Brand },
    { name: "Spotify", domain: "explore", brand: siSpotify as Brand },
    { name: "Discord", domain: "general", brand: siDiscord as Brand },
    { name: "WhatsApp", domain: "general", brand: siWhatsapp as Brand },
    { name: "Telegram", domain: "general", brand: siTelegram as Brand },
  ]},
];


// Catalog shapes - mirror resources/connectors/catalog.json. The Rust command
// returns it verbatim, so the frontend owns the type.
// A REAL app as the engine sees it (community/vault app with live state),
// distinct from a catalog entry (a browseable directory listing).
// Real brand SVG (simple-icons) when the app matched one at build time; else a
// pattern-tinted dot. Keeps the row scannable for all 1,400+ apps.

// Each connector PATTERN maps to one ingestion tier. Short label + tint so a
// row scans at a glance without per-brand icons (the catalog has hundreds).

// Friendly domain headings. Falls back to titleCase for anything unmapped.

// App lock (F4 Phase 0) - set/change/remove the passcode that gates opening the
// desktop app. Honest about scope: it locks the UI, it does NOT yet encrypt the
// vault files on disk.

// Vault encryption (F4 Phase 1) - encrypt the vault at rest, or decrypt it back.
// Self-verifying in the engine (auto-rollback if anything is unreadable), and
// shows the one-time recovery code on encryption.

export function VaultEncryptionCard({ vaultPath }: { vaultPath: string }) {
  const [status, setStatus] = useState<{ encrypted: boolean; unlocked: boolean } | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const refresh = async () => {
    try { setStatus(await invoke("engine_vault_status", { vault: vaultPath })); } catch { setStatus(null); }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [vaultPath]);
  async function encrypt() {
    if (pass.length < 8) { setNote("Passcode must be at least 8 characters."); return; }
    if (!window.confirm("Encrypt this vault? Make sure you have a backup first. You'll get a one-time recovery code: save it.")) return;
    setBusy(true); setNote(null); setRecovery(null);
    try {
      await backupVaultNow(vaultPath); // automatic pre-encryption snapshot
      const r = await invoke<{ ok: boolean; recoveryCode?: string | null; error?: string }>("engine_vault_encrypt", { vault: vaultPath, passcode: pass });
      if (r.ok) {
        if (r.recoveryCode) setRecovery(r.recoveryCode);
        await invoke("engine_vault_unlock", { vault: vaultPath, passcode: pass }).catch(() => {});
        setNote("Vault encrypted. Save your recovery code somewhere safe.");
        setPass("");
        await refresh();
      } else {
        setNote(r.error ?? "Encryption failed.");
      }
    } catch (e) { setNote(`Failed: ${String(e)}`); } finally { setBusy(false); }
  }
  async function decrypt() {
    setBusy(true); setNote(null);
    try {
      await backupVaultNow(vaultPath); // automatic pre-decryption snapshot
      const r = await invoke<{ ok: boolean; error?: string }>("engine_vault_decrypt", { vault: vaultPath, passcode: pass });
      if (r.ok) { setNote("Vault decrypted back to plaintext. Reloading…"); setPass(""); await refresh(); setTimeout(() => window.location.reload(), 800); }
      else setNote(r.error ?? "Wrong passcode.");
    } catch (e) { setNote(`Failed: ${String(e)}`); } finally { setBusy(false); }
  }
  if (!status) return null;
  return (
    <DesktopOnly feature="Vault encryption">
    <div className="mb-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
        <Shield className="h-3.5 w-3.5" /> Vault encryption {status.encrypted ? "· on" : "· off"}
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {status.encrypted
          ? "Your vault files are encrypted at rest with AES-256-GCM. They're unreadable on disk without your passcode."
          : "Encrypt your vault files at rest so they can't be read off disk. Editing in external apps (Obsidian, Finder) stops working while encrypted."}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder={status.encrypted ? "Passcode" : "New passcode (min 8 chars)"}
          className="w-56 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none"
        />
        {status.encrypted ? (
          <button onClick={decrypt} disabled={busy || !pass} className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Decrypt vault
          </button>
        ) : (
          <button onClick={encrypt} disabled={busy || pass.length < 8} className="inline-flex items-center gap-2 rounded-md border border-accent-border bg-accent px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />} Encrypt vault
          </button>
        )}
      </div>
      {recovery && (
        <div className="mt-3 rounded-lg border border-accent-border bg-accent-soft p-3">
          <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent">Recovery code: save this now</div>
          <div className="mt-1 select-all font-mono text-sm text-text-primary">{recovery}</div>
          <div className="mt-1 text-[11px] text-text-muted">If you forget your passcode, this is the only other way to unlock your vault. It won't be shown again.</div>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent-hover"
          >
            I saved it · Restart Prevail
          </button>
          <span className="ml-2 text-[11px] text-text-muted">Restarting re-opens the vault through the unlock screen so every view reads it correctly.</span>
        </div>
      )}
      {note && <div className="mt-2 text-xs text-text-secondary">{note}</div>}
    </div>
    </DesktopOnly>
  );
}
