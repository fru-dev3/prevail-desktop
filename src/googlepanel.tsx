// Google Workspace connector - ONE connection for the whole Google ecosystem
// (Gmail, Calendar, Drive, Docs, Sheets, Tasks, Meet, ...) via the `gws` CLI,
// across MULTIPLE Google profiles. Each profile is a separate gws config dir;
// the agent fans out across them. This panel detects the CLI, walks a
// non-technical user through a one-click Install -> Connect -> Ready setup,
// shows each profile's live health, and scaffolds the connector so chat + the
// Inbox-Zero loop can use it.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle, Check, Loader2, Plus, RefreshCw, ExternalLink, Download, Link2,
  Mail, CalendarDays, HardDrive, FileText, Sheet, ListTodo, Users, Eye, ShieldCheck, Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, listen } from "./bridge";
import { AppRowLogo } from "./panels3";
import type { BrandLogo } from "./types";

type CliStatus = { installed: boolean; version: string | null; bin: string | null };
type Profile = { configDir: string; label: string; email: string | null; status: "connected" | "expired" | "needs_scope" | "unknown" };

// The services the agent reaches through one Google connection, each with its
// own glyph so the surface reads as a product, not a list of words.
const SERVICES: { name: string; Icon: LucideIcon }[] = [
  { name: "Gmail", Icon: Mail },
  { name: "Calendar", Icon: CalendarDays },
  { name: "Drive", Icon: HardDrive },
  { name: "Docs", Icon: FileText },
  { name: "Sheets", Icon: Sheet },
  { name: "Tasks", Icon: ListTodo },
  { name: "People", Icon: Users },
];

const STATUS_META: Record<Profile["status"], { label: string; tint: string; dot: string }> = {
  connected:   { label: "Connected",          tint: "text-ok",         dot: "bg-ok" },
  expired:     { label: "Token expired",       tint: "text-warn",       dot: "bg-warn" },
  needs_scope: { label: "Needs Gmail access",  tint: "text-warn",       dot: "bg-warn" },
  unknown:     { label: "Not verified",        tint: "text-text-muted", dot: "bg-text-muted/50" },
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
  const setupStep = (!cli?.installed ? 1 : connectedCount === 0 ? 2 : 3) as 1 | 2 | 3;
  const cliVersion = (() => { const m = cli?.version?.match(/(\d+\.\d+\.\d+)/); return m ? m[1] : null; })();

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      {/* Hero header. */}
      <div className="relative flex flex-wrap items-center gap-3 border-b border-border-subtle bg-gradient-to-br from-accent-soft/40 to-transparent px-5 py-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface shadow-sm ring-1 ring-border-subtle">
          <AppRowLogo app={{ title: "Google", id: "google" }} logos={logos ?? {}} size={28} fallback="letter" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-semibold tracking-tight text-text-primary">Google Workspace</span>
            {cliVersion && <span className="rounded-md border border-border-subtle bg-surface px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted">gws {cliVersion}</span>}
            {connectedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ok">
                <Check className="h-2.5 w-2.5" /> {connectedCount} connected
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-text-secondary">One connection for Gmail, Calendar, Drive, Docs, Sheets and Tasks, across every Google account.</p>
        </div>
        <button onClick={() => void reload()} disabled={loading} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface/70 px-2 py-1 text-[11px] text-text-secondary backdrop-blur hover:border-accent-border hover:text-accent disabled:opacity-50">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
        </button>
      </div>

      <div className="space-y-4 px-5 py-5">
        {loading && !cli ? (
          <div className="flex items-center gap-2 text-[12px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the Google Workspace CLI…</div>
        ) : (
          <>
            <SetupStepper step={setupStep} />

            {/* Step 1. Install. */}
            {setupStep === 1 && (
              <StepCard icon={Download} title="Install the Google Workspace helper" subtitle="One click. No terminal. Prevail installs the small command-line helper it uses to talk to Google (via Homebrew, or a direct download).">
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button onClick={() => void runInstall()} disabled={installing}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-background shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50">
                    {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    {installing ? "Installing…" : "Install now"}
                  </button>
                  <button onClick={() => void openUrl("https://github.com/googleworkspace/cli")} className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-accent">docs <ExternalLink className="h-3 w-3" /></button>
                </div>
                <StreamLog lines={installLog} busy={installing} idle="Starting the installer…" />
                {!installing && installLog.length > 0 && (
                  <p className="mt-2 text-[11px] text-text-muted">Prefer to do it yourself? <code className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-primary">brew install googleworkspace-cli</code></p>
                )}
              </StepCard>
            )}

            {/* Step 2. Connect via the browser. */}
            {setupStep === 2 && (
              <StepCard icon={Link2} title="Connect your Google account" subtitle="This opens your browser so you can choose your account and approve access. Come back here when you are done.">
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button onClick={() => void runConnect(null)} disabled={authing}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-background shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50">
                    {authing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                    {authing ? "Waiting for you in the browser…" : "Connect Google"}
                  </button>
                  {authUrl && (
                    <button onClick={() => void openUrl(authUrl)} className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                      <ExternalLink className="h-3 w-3" /> Browser did not open? Click here
                    </button>
                  )}
                </div>
                <StreamLog lines={authLog} busy={authing} idle="Opening Google sign-in…" />
              </StepCard>
            )}

            {/* Step 3. Validated. */}
            {setupStep === 3 && (
              <div className="rounded-xl border border-ok/40 bg-ok/5 p-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ok/15 text-ok"><Check className="h-4 w-4" /></span>
                  <div>
                    <div className="text-sm font-semibold text-text-primary">Connected and ready</div>
                    <div className="text-[12px] text-text-secondary">Your agent can use Google across {connectedCount} account{connectedCount === 1 ? "" : "s"}.</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {connectedProfiles.map((p) => (
                    <span key={p.configDir} className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-surface px-2.5 py-1 text-[11px] text-text-secondary">
                      <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                      <span className="font-medium text-text-primary">{p.email || p.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Profiles - one Google account each (shown once the CLI is installed). */}
            {cli?.installed && (
              <div className="space-y-1.5">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Accounts</div>
                {profiles.length === 0 ? (
                  <div className="text-[12px] text-text-muted">No accounts yet. Add one to sign in.</div>
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

                {adding ? (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <input autoFocus value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="account name (e.g. work, personal)"
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-text-primary focus:border-accent-border focus:outline-none" />
                    <button onClick={() => { const l = newLabel.trim(); if (l) { setAdding(false); setNewLabel(""); void authorize(l, null); } }} disabled={!newLabel.trim() || busy !== null}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50"><ExternalLink className="h-3.5 w-3.5" /> Sign in</button>
                    <button onClick={() => { setAdding(false); setNewLabel(""); }} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setAdding(true)} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-md border border-dashed border-accent-border px-2.5 py-1.5 text-xs text-accent hover:bg-accent-soft/40 disabled:opacity-50">
                    <Plus className="h-3.5 w-3.5" /> Add another Google account
                  </button>
                )}
              </div>
            )}

            {/* What the agent can do, and the read vs write model - shown visually. */}
            {cli?.installed && (
              <div className="rounded-xl border border-border-subtle bg-background p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Available to your agent</div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {SERVICES.map(({ name, Icon }) => (
                    <span key={name} className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                      <Icon className="h-3.5 w-3.5 text-text-muted" /> {name}
                    </span>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Eye className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-text-primary">Reading is instant</div>
                      <div className="text-[11px] leading-snug text-text-muted">Ask in chat and the agent reads it right away.</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ok/15 text-ok"><ShieldCheck className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-text-primary">Writing asks first</div>
                      <div className="text-[11px] leading-snug text-text-muted">Send, change or delete waits for your OK under Needs you.</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Make it usable by the agent. */}
            {cli?.installed && (
              <div className="flex flex-wrap items-center gap-2.5 border-t border-border-subtle pt-3.5">
                <button onClick={() => void connect()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-background shadow-sm hover:bg-accent-hover disabled:opacity-50">
                  {busy === "scaffold" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Connect for the agent
                </button>
                <span className="max-w-prose text-[11px] leading-snug text-text-muted">Adds the Google connector and a skill so chat and the Inbox-Zero loop fan out across your accounts.</span>
              </div>
            )}
          </>
        )}
        {msg && <div className="rounded-lg border border-border-subtle bg-background px-3 py-2 text-[12px] text-text-secondary">{msg}</div>}
      </div>
    </div>
  );
}

// The 3-step setup progress rail: Install -> Connect -> Ready, with the line
// between nodes filling green as each step completes.
function SetupStepper({ step }: { step: 1 | 2 | 3 }) {
  const steps: { label: string; Icon: LucideIcon }[] = [
    { label: "Install", Icon: Download },
    { label: "Connect", Icon: Link2 },
    { label: "Ready", Icon: Check },
  ];
  return (
    <div className="flex items-center">
      {steps.map((s, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = step > n;
        const active = step === n;
        const Icon = done ? Check : s.Icon;
        return (
          <Fragment key={s.label}>
            <div className="flex flex-col items-center gap-1.5">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
                done ? "border-ok bg-ok text-background" : active ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-text-muted"
              }`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${done ? "text-ok" : active ? "text-accent" : "text-text-muted"}`}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <span className={`mx-1.5 mb-5 h-0.5 flex-1 rounded-full transition-colors ${step > n ? "bg-ok" : "bg-border"}`} />}
          </Fragment>
        );
      })}
    </div>
  );
}

// A setup step card: an icon tile + title + subtitle + the step's controls.
function StepCard({ icon: Icon, title, subtitle, children }: { icon: LucideIcon; title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">{title}</div>
          <p className="mt-0.5 max-w-prose text-[12px] leading-relaxed text-text-secondary">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

// Live, scrolling log for a streamed setup step, styled as a small terminal so
// progress reads as "something real is happening" without dominating the card.
function StreamLog({ lines, busy, idle }: { lines: string[]; busy: boolean; idle: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [lines.length]);
  if (!busy && lines.length === 0) return null;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border-subtle bg-[#0c0c0d]">
      <div className="flex items-center gap-1.5 border-b border-white/5 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="ml-1 font-mono text-[9px] uppercase tracking-wider text-white/30">setup log</span>
        {busy && <Loader2 className="ml-auto h-3 w-3 animate-spin text-white/40" />}
      </div>
      <div ref={ref} className="max-h-44 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-white/70">
        {lines.length === 0 ? (
          <div className="text-white/40">{idle}</div>
        ) : (
          lines.map((l, i) => <div key={i} className="whitespace-pre-wrap break-words">{l}</div>)
        )}
      </div>
    </div>
  );
}
