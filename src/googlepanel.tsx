// Google Workspace connector - ONE connection for the whole Google ecosystem
// (Gmail, Calendar, Drive, Docs, Sheets, Tasks, Meet, ...) via the `gws` CLI,
// across MULTIPLE Google profiles. Each profile is a separate gws config dir;
// the agent fans out across them. This panel detects the CLI, shows each
// profile's live health, lets you (re)authorize, and scaffolds the connector so
// chat + the Inbox-Zero loop can use it.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, RefreshCw, ExternalLink, Download, Link2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, listen } from "./bridge";
import { AppRowLogo } from "./panels3";
import type { BrandLogo } from "./types";

type CliStatus = { installed: boolean; version: string | null; bin: string | null };
type Profile = { configDir: string; label: string; email: string | null; status: "connected" | "expired" | "needs_scope" | "unknown" };

const GOOGLE_SVCS = ["Gmail", "Calendar", "Drive", "Docs", "Sheets", "Tasks", "People"];

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

  // One-click setup streaming state.
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [authLog, setAuthLog] = useState<string[]>([]);
  const [authing, setAuthing] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const sessionRef = useRef<string>("");

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

  // Step 1: install the CLI, streaming live progress.
  const runInstall = async () => {
    if (installing) return;
    setInstalling(true); setInstallLog([]); setMsg(null);
    const session = `gws-install-${crypto.randomUUID()}`;
    sessionRef.current = session;
    let unLine = () => {}; let unDone = () => {};
    try {
      await new Promise<void>(async (resolve) => {
        unLine = await listen<{ session: string; data: string }>("google_install:line", (e) => {
          if (e.payload.session !== session) return;
          const line = typeof e.payload.data === "string" ? e.payload.data : JSON.stringify(e.payload.data);
          if (line.trim()) setInstallLog((cur) => [...cur, line].slice(-200));
        });
        unDone = await listen<{ session: string; ok: boolean }>("google_install:done", (e) => {
          if (e.payload.session !== session) return;
          resolve();
        });
        invoke("google_cli_install_stream", { session }).catch((err) => {
          setInstallLog((cur) => [...cur, `Install failed: ${String(err).slice(0, 200)}`]);
          resolve();
        });
      });
    } finally {
      unLine(); unDone();
      await reload();
      setInstalling(false);
    }
  };

  // Step 2: browser OAuth, streaming live status incl. the auth URL.
  const runConnect = async (configDir: string | null) => {
    if (authing) return;
    setAuthing(true); setAuthLog([]); setAuthUrl(null); setMsg(null);
    const session = `gws-auth-${crypto.randomUUID()}`;
    sessionRef.current = session;
    let unLine = () => {}; let unDone = () => {};
    try {
      await new Promise<void>(async (resolve) => {
        unLine = await listen<{ session: string; data: string }>("google_auth:line", (e) => {
          if (e.payload.session !== session) return;
          const line = typeof e.payload.data === "string" ? e.payload.data : JSON.stringify(e.payload.data);
          if (!line.trim()) return;
          setAuthLog((cur) => [...cur, line].slice(-200));
          const m = line.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/[^\s"']+/);
          if (m) setAuthUrl(m[0]);
        });
        unDone = await listen<{ session: string; ok: boolean }>("google_auth:done", (e) => {
          if (e.payload.session !== session) return;
          resolve();
        });
        invoke("google_auth_login_stream", { session, configDir }).catch((err) => {
          setAuthLog((cur) => [...cur, `Sign-in failed: ${String(err).slice(0, 200)}`]);
          resolve();
        });
      });
    } finally {
      unLine(); unDone();
      await reload();
      // Keep the connector SKILL in sync with the live profiles.
      await invoke("google_scaffold", { vault: vaultPath }).catch(() => {});
      setAuthing(false);
    }
  };

  const connectedCount = profiles.filter((p) => p.status === "connected").length;
  const connectedProfiles = profiles.filter((p) => p.status === "connected");
  // Which setup step are we on: 1 install, 2 connect, 3 validated.
  const setupStep = !cli?.installed ? 1 : connectedCount === 0 ? 2 : 3;

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-start gap-3 border-b border-border-subtle px-5 py-4">
        <AppRowLogo app={{ title: "Google", id: "google" }} logos={logos ?? {}} size={36} fallback="letter" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-text-primary">Google</span>
            {cli?.installed && <span className="rounded border border-border-subtle px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted">gws{(() => { const m = cli.version?.match(/(\d+\.\d+\.\d+)/); return m ? ` ${m[1]}` : ""; })()}</span>}
            {connectedCount > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ok"><Check className="h-2.5 w-2.5" /> {connectedCount} connected</span>}
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
          <>
            <SetupStepper step={setupStep} />
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Download className="h-4 w-4 text-accent" /> Step 1. Install the Google Workspace CLI
              </div>
              <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-text-secondary">
                One click installs the small command-line helper Prevail uses to talk to Google. No terminal needed. We use Homebrew if you have it, otherwise we download it for you.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => void runInstall()} disabled={installing}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                  {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  {installing ? "Installing…" : "Install Google Workspace CLI"}
                </button>
                <button onClick={() => void openUrl("https://github.com/googleworkspace/cli")} className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">docs <ExternalLink className="h-3 w-3" /></button>
              </div>
              <StreamLog lines={installLog} busy={installing} idle="Click Install to begin." />
              {!installing && installLog.length > 0 && (
                <p className="mt-2 text-[11px] text-text-muted">If this did not work, you can install it yourself: <code className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-primary">brew install googleworkspace-cli</code></p>
              )}
            </div>
          </>
        ) : (
          <>
            <SetupStepper step={setupStep} />

            {/* Step 2. Connect via the browser (only until a profile is connected). */}
            {connectedCount === 0 && (
              <div className="rounded-lg border border-border bg-background p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <Link2 className="h-4 w-4 text-accent" /> Step 2. Connect your Google account
                </div>
                <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-text-secondary">
                  This opens your browser so you can pick your Google account and approve access. Come back here when you are done.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button onClick={() => void runConnect(null)} disabled={authing}
                    className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                    {authing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                    {authing ? "Waiting for you to approve in your browser…" : "Connect Google (opens your browser)"}
                  </button>
                  {authUrl && (
                    <button onClick={() => void openUrl(authUrl)} className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                      <ExternalLink className="h-3 w-3" /> Browser did not open? Click here
                    </button>
                  )}
                </div>
                <StreamLog lines={authLog} busy={authing} idle="Click Connect to begin." />
              </div>
            )}

            {/* Step 3. Validated. */}
            {connectedCount > 0 && (
              <div className="rounded-lg border border-ok/40 bg-ok/5 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <Check className="h-4 w-4 text-ok" /> Step 3. Connected and ready
                </div>
                <div className="mt-2 space-y-1">
                  {connectedProfiles.map((p) => (
                    <div key={p.configDir} className="flex items-center gap-2 text-[12px] text-text-secondary">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-ok" />
                      <span className="font-medium text-text-primary">{p.email || p.label}</span>
                      <span className="font-mono text-[10px] text-text-muted">{p.label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {GOOGLE_SVCS.map((s) => (
                    <span key={s} className="rounded-full border border-ok/30 bg-surface px-2 py-0.5 text-[11px] text-text-secondary">{s}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Profiles - one Google account each. */}
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Profiles</div>
              {profiles.length === 0 ? (
                <div className="text-[12px] text-text-muted">No profiles yet. Add one to sign in to a Google account.</div>
              ) : profiles.map((p) => {
                const meta = STATUS_META[p.status];
                const rowBusy = busy === p.configDir || authing;
                return (
                  <div key={p.configDir} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                    <span className="text-sm font-medium text-text-primary">{p.email || p.label}</span>
                    <span className="font-mono text-[10px] text-text-muted">{p.label}</span>
                    <span className={`ml-auto inline-flex items-center gap-1 text-[11px] ${meta.tint}`}>
                      {(p.status === "expired" || p.status === "needs_scope") && <AlertTriangle className="h-3 w-3" />}{meta.label}
                    </span>
                    {p.status !== "connected" && (
                      <button onClick={() => void runConnect(p.configDir)} disabled={busy !== null || authing} className="inline-flex items-center gap-1 rounded-md border border-accent-border px-2 py-0.5 text-[11px] text-accent hover:bg-accent-soft disabled:opacity-50">
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

            {/* What the agent can do with Google, and the read vs write model. */}
            <div className="rounded-lg border border-border-subtle bg-background px-3 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Available to chat and the agent</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {["Gmail", "Calendar", "Drive", "Docs", "Sheets", "Tasks"].map((s) => (
                  <span key={s} className="rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[11px] text-text-secondary">{s}</span>
                ))}
              </div>
              <p className="mt-2 max-w-prose text-[11px] leading-relaxed text-text-muted">
                Reading runs automatically inside chat. Anything that writes (send an email, change or delete something) is proposed and waits for your approval under Needs you.
              </p>
            </div>

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

// The 3-step setup progress header: Install -> Connect -> Ready.
function SetupStepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = ["Install", "Connect", "Ready"];
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = step > n;
        const active = step === n;
        return (
          <div key={label} className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              done ? "bg-ok/10 text-ok" : active ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"
            }`}>
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
                done ? "bg-ok text-background" : active ? "bg-accent text-background" : "bg-border text-text-muted"
              }`}>{done ? <Check className="h-2.5 w-2.5" /> : n}</span>
              {label}
            </span>
            {i < steps.length - 1 && <span className={`h-px w-5 ${step > n ? "bg-ok/50" : "bg-border"}`} />}
          </div>
        );
      })}
    </div>
  );
}

// Live, scrolling log area for a streamed setup step.
function StreamLog({ lines, busy, idle }: { lines: string[]; busy: boolean; idle: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [lines.length]);
  if (!busy && lines.length === 0) return null;
  return (
    <div ref={ref} className="mt-3 max-h-44 overflow-y-auto rounded-md border border-border-subtle bg-surface-warm/40 p-2 font-mono text-[11px] leading-relaxed text-text-secondary">
      {lines.length === 0 ? (
        <div className="flex items-center gap-1.5 text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> {idle}</div>
      ) : (
        lines.map((l, i) => <div key={i} className="whitespace-pre-wrap break-words">{l}</div>)
      )}
      {busy && lines.length > 0 && <div className="mt-1 flex items-center gap-1.5 text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> working…</div>}
    </div>
  );
}
