// Google Workspace connector - ONE connection for the whole Google ecosystem
// (Gmail, Calendar, Drive, Docs, Sheets, Tasks, Meet, ...) via the `gws` CLI,
// across MULTIPLE Google profiles. Each profile is a separate gws config dir;
// the agent fans out across them. This panel detects the CLI, shows each
// profile's live health, lets you (re)authorize, and scaffolds the connector so
// chat + the Inbox-Zero loop can use it.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, RefreshCw, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "./bridge";
import { AppRowLogo } from "./panels3";
import type { BrandLogo } from "./types";

type CliStatus = { installed: boolean; version: string | null; bin: string | null };
type Profile = { configDir: string; label: string; email: string | null; status: "connected" | "expired" | "needs_scope" | "unknown" };

const STATUS_META: Record<Profile["status"], { label: string; tint: string; dot: string }> = {
  connected:   { label: "Connected",            tint: "text-ok",      dot: "bg-ok" },
  expired:     { label: "Token expired",        tint: "text-warn",    dot: "bg-warn" },
  needs_scope: { label: "Needs Gmail access",   tint: "text-warn",    dot: "bg-warn" },
  unknown:     { label: "Not verified",         tint: "text-text-muted", dot: "bg-text-muted/50" },
};

export function GoogleWorkspacePanel({ vaultPath, logos }: { vaultPath: string; logos?: Record<string, BrandLogo> }) {
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const s = await invoke<CliStatus>("google_cli_status");
      setCli(s);
      if (s.installed) setProfiles(await invoke<Profile[]>("google_profiles"));
    } catch (e) { console.error("google status", e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const authorize = async (label: string, configDir: string | null) => {
    setBusy(configDir ?? `new:${label}`); setMsg("Opening your browser to sign in to Google. Pick the account, grant access, then come back.");
    try {
      await invoke("google_profile_login", { label, configDir });
      setMsg("Signed in. Re-checking profiles…");
      await reload();
      // Keep the connector SKILL in sync with the live profiles.
      await invoke("google_scaffold", { vault: vaultPath }).catch(() => {});
      setMsg(null);
    } catch (e) { setMsg(`Sign-in failed: ${String(e).slice(0, 200)}`); }
    finally { setBusy(null); }
  };

  const connect = async () => {
    setBusy("scaffold"); setMsg(null);
    try {
      const r = await invoke<{ ok: boolean; profiles: number }>("google_scaffold", { vault: vaultPath });
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
      setMsg(r.ok ? `Connected. Your agent can now use Google across ${r.profiles} profile${r.profiles === 1 ? "" : "s"} (chat + the Inbox-Zero loop).` : "Could not connect.");
    } catch (e) { setMsg(`Connect failed: ${String(e).slice(0, 200)}`); }
    finally { setBusy(null); }
  };

  const connectedCount = profiles.filter((p) => p.status === "connected").length;

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-start gap-3 border-b border-border-subtle px-5 py-4">
        <AppRowLogo app={{ title: "Google", id: "google" }} logos={logos ?? {}} size={36} fallback="letter" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-text-primary">Google</span>
            {cli?.installed && <span className="rounded border border-border-subtle px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-text-muted">gws{(() => { const m = cli.version?.match(/(\d+\.\d+\.\d+)/); return m ? ` ${m[1]}` : ""; })()}</span>}
            {connectedCount > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ok"><Check className="h-2.5 w-2.5" /> {connectedCount} connected</span>}
          </div>
          <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-text-secondary">One connection for the whole Google ecosystem - Gmail, Calendar, Drive, Docs, Sheets, Tasks, Meet - across every Google profile. The agent pulls, summarizes, and replies per profile.</p>
        </div>
        <button onClick={() => void reload()} disabled={loading} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
        </button>
      </div>

      <div className="space-y-3 px-5 py-4">
        {loading && !cli ? (
          <div className="flex items-center gap-2 text-[12px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the Google Workspace CLI…</div>
        ) : !cli?.installed ? (
          <div className="rounded-lg border border-dashed border-border bg-background p-3 text-[12px] text-text-secondary">
            The Google Workspace CLI (<span className="font-mono">gws</span>) isn't installed. Install it, then click Refresh.
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded bg-surface-warm px-2 py-1 font-mono text-[11px] text-text-primary">brew install googleworkspace/tap/gws</code>
              <button onClick={() => void openUrl("https://github.com/googleworkspace/cli")} className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">docs <ExternalLink className="h-3 w-3" /></button>
            </div>
          </div>
        ) : (
          <>
            {/* Profiles - one Google account each. */}
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Profiles</div>
              {profiles.length === 0 ? (
                <div className="text-[12px] text-text-muted">No profiles yet. Add one to sign in to a Google account.</div>
              ) : profiles.map((p) => {
                const meta = STATUS_META[p.status];
                const rowBusy = busy === p.configDir;
                return (
                  <div key={p.configDir} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                    <span className="text-sm font-medium text-text-primary">{p.email || p.label}</span>
                    <span className="font-mono text-[10px] text-text-muted">{p.label}</span>
                    <span className={`ml-auto inline-flex items-center gap-1 text-[11px] ${meta.tint}`}>
                      {(p.status === "expired" || p.status === "needs_scope") && <AlertTriangle className="h-3 w-3" />}{meta.label}
                    </span>
                    {p.status !== "connected" && (
                      <button onClick={() => void authorize(p.label, p.configDir)} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-md border border-accent-border px-2 py-0.5 text-[11px] text-accent hover:bg-accent-soft disabled:opacity-50">
                        {rowBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />} Re-authorize
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add a profile. */}
            {adding ? (
              <div className="flex flex-wrap items-center gap-2">
                <input autoFocus value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="profile name (e.g. work, personal)"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-text-primary focus:border-accent-border focus:outline-none" />
                <button onClick={() => { const l = newLabel.trim(); if (l) { setAdding(false); setNewLabel(""); void authorize(l, null); } }} disabled={!newLabel.trim() || busy !== null}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50"><ExternalLink className="h-3.5 w-3.5" /> Sign in</button>
                <button onClick={() => { setAdding(false); setNewLabel(""); }} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-md border border-dashed border-accent-border px-2.5 py-1.5 text-xs text-accent hover:bg-accent-soft/40 disabled:opacity-50">
                <Plus className="h-3.5 w-3.5" /> Add a Google profile
              </button>
            )}

            {/* Make it usable by the agent. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
              <button onClick={() => void connect()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                {busy === "scaffold" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Connect for the agent
              </button>
              <span className="text-[11px] text-text-muted">Writes the Google connector + a SKILL so chat and the Inbox-Zero loop fan out across your profiles.</span>
            </div>
          </>
        )}
        {msg && <div className="text-[12px] text-text-secondary">{msg}</div>}
      </div>
    </div>
  );
}
