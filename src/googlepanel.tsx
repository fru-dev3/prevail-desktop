// Google Workspace connector - ONE connection for the whole Google ecosystem
// (Gmail, Calendar, Drive, Docs, Sheets, Tasks, Meet, ...) via the `gws` CLI,
// across MULTIPLE Google profiles. Each profile is a separate gws config dir;
// the agent fans out across them. This panel detects the CLI, walks a
// non-technical user through a one-click Install -> Connect -> Ready setup,
// shows each profile's live health, and scaffolds the connector so chat + the
// Inbox-Zero loop can use it.
//
// Like every other app, Google also exposes Setup / Skills / Soul / Connections
// tabs (so the user keeps access to Skills + a soul for app id "google"),
// rendered INSIDE this panel rather than through the generic AppDetail.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle, Boxes, Check, Loader2, Plus, RefreshCw, ExternalLink, Download, Link2,
  Eye, ShieldCheck, Trash2, Sparkles, Pencil, Play, X, Globe, MessageSquare, Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, listen } from "./bridge";
import { favKeyOf, toggleFavorite, useFavorites } from "./appfavorites";
import { AppRowLogo } from "./panels3";
import { ConnectorRunPanel, type ConnectorRunMode } from "./connectorrun";
import type { BrandLogo, ChatEvent } from "./types";

type CliStatus = { installed: boolean; version: string | null; bin: string | null };
type Profile = { configDir: string; label: string; email: string | null; status: "connected" | "expired" | "needs_scope" | "unknown" };

// The Google app id used for the shared Skills / Soul / Connections engine
// commands - identical to what the generic AppDetail uses for any other app.
const GOOGLE_APP_ID = "google";
const GOOGLE_WEBSITE = "https://workspace.google.com";

// A runnable skill as the UI displays it (same contract the engine returns for
// every app). We only DISPLAY what the engine returns.
type AppSkill = {
  id: string; name?: string; method?: string; primary?: boolean;
  source?: "starter" | "learned"; trigger?: string; summary?: string;
  runner?: string; favorite?: boolean;
};
function skillMethod(s: AppSkill): "Browser" | "MCP" | "API" | "Other" {
  const m = (s.method || s.runner || "").toLowerCase();
  if (m.includes("mcp")) return "MCP";
  if (m.includes("api") || m.includes("http") || m.includes("oauth")) return "API";
  if (m === "other") return "Other";
  return "Browser";
}

// Real, colored brand marks for each Google product (not monochrome lucide
// glyphs), so the "Available to your agent" surface reads as the actual
// products. Inline multicolor SVGs keep them crisp at chip size and need no
// network/logo-map lookup. Each is recognizable at ~16px.
function GoogleServiceLogo({ name, size = 16 }: { name: string; size?: number }) {
  const box = { width: size, height: size, display: "block" as const };
  switch (name) {
    case "Gmail":
      return (
        <svg style={box} viewBox="0 0 256 193" aria-hidden>
          <path fill="#4285F4" d="M58.182 192.05V93.14L27.507 65.077 0 49.504v125.091c0 9.658 7.825 17.455 17.455 17.455z" />
          <path fill="#34A853" d="M197.818 192.05h40.727c9.659 0 17.455-7.826 17.455-17.455V49.504l-31.156 17.837-27.026 25.798z" />
          <path fill="#EA4335" d="M58.182 93.14V49.504L128 102.06l69.818-52.557V93.14L128 145.34z" />
          <path fill="#FBBC04" d="M197.818 8.69v84.95L256 49.504V26.231c0-21.585-24.64-33.89-41.89-20.945z" />
          <path fill="#C5221F" d="M0 49.504V26.231C0 4.646 24.64-7.659 41.89 5.286L58.182 17.504v76.136z" />
        </svg>
      );
    case "Calendar":
      return (
        <svg style={box} viewBox="0 0 200 200" aria-hidden>
          <path fill="#fff" d="M152 48H48v104h104z" />
          <path fill="#1967d2" d="M152 200l48-48h-48z" />
          <path fill="#fbbc04" d="M200 48h-48v104h48z" />
          <path fill="#34a853" d="M152 152H48v48h104z" />
          <path fill="#188038" d="M0 152v32a16 16 0 0 0 16 16h32v-48z" />
          <path fill="#1967d2" d="M200 48V16a16 16 0 0 0-16-16h-32v48z" />
          <path fill="#4285f4" d="M152 0H16A16 16 0 0 0 0 16v136h48V48h104z" />
          <text x="100" y="134" fontSize="86" fontWeight={700} textAnchor="middle" fill="#4285f4" fontFamily="Arial, sans-serif">31</text>
        </svg>
      );
    case "Drive":
      return (
        <svg style={box} viewBox="0 0 87.3 78" aria-hidden>
          <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
          <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" />
          <path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
          <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
          <path fill="#2684fc" d="M59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
          <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
        </svg>
      );
    case "Docs":
      return (
        <svg style={box} viewBox="0 0 47 65" aria-hidden>
          <path fill="#4285f4" d="M29.4 0H4.7A4.7 4.7 0 0 0 0 4.7v55.6A4.7 4.7 0 0 0 4.7 65h37.6a4.7 4.7 0 0 0 4.7-4.7V17.6z" />
          <path fill="#a1c2fa" d="M29.4 0v13a4.7 4.7 0 0 0 4.7 4.7h12.9z" />
          <g fill="#fff">
            <rect x="11.75" y="26" width="23.5" height="2.3" rx="1" />
            <rect x="11.75" y="32.5" width="23.5" height="2.3" rx="1" />
            <rect x="11.75" y="39" width="23.5" height="2.3" rx="1" />
            <rect x="11.75" y="45.5" width="15" height="2.3" rx="1" />
          </g>
        </svg>
      );
    case "Sheets":
      return (
        <svg style={box} viewBox="0 0 47 65" aria-hidden>
          <path fill="#0f9d58" d="M29.4 0H4.7A4.7 4.7 0 0 0 0 4.7v55.6A4.7 4.7 0 0 0 4.7 65h37.6a4.7 4.7 0 0 0 4.7-4.7V17.6z" />
          <path fill="#87ceac" d="M29.4 0v13a4.7 4.7 0 0 0 4.7 4.7h12.9z" />
          <path fill="#fff" d="M11 28h25v22H11z" />
          <g fill="#0f9d58">
            <rect x="11" y="34" width="25" height="1.4" />
            <rect x="11" y="40" width="25" height="1.4" />
            <rect x="11" y="45" width="25" height="1.4" />
            <rect x="19" y="28" width="1.4" height="22" />
            <rect x="27" y="28" width="1.4" height="22" />
          </g>
        </svg>
      );
    case "Tasks":
      return (
        <svg style={box} viewBox="0 0 24 24" aria-hidden>
          <rect x="2" y="2" width="20" height="20" rx="5" fill="#4285F4" />
          <path d="M7 12.2l3.2 3.2L17 8.6" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "People":
      return (
        <svg style={box} viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="8" r="4" fill="#4285F4" />
          <path d="M12 14c-4.4 0-8 2.7-8 6v1h16v-1c0-3.3-3.6-6-8-6z" fill="#669df6" />
        </svg>
      );
    default:
      return null;
  }
}

// The services the agent reaches through one Google connection. Each renders
// its real, colored brand mark (see GoogleServiceLogo).
const SERVICES = ["Gmail", "Calendar", "Drive", "Docs", "Sheets", "Tasks", "People"] as const;

const STATUS_META: Record<Profile["status"], { label: string; tint: string; dot: string }> = {
  connected:   { label: "Connected",          tint: "text-ok",         dot: "bg-ok" },
  expired:     { label: "Token expired",       tint: "text-warn",       dot: "bg-warn" },
  needs_scope: { label: "Needs Gmail access",  tint: "text-warn",       dot: "bg-warn" },
  unknown:     { label: "Not verified",        tint: "text-text-muted", dot: "bg-text-muted/50" },
};

type GoogleTab = "setup" | "skills" | "soul" | "connections" | "chat";

export function GoogleWorkspacePanel({ vaultPath, logos }: { vaultPath: string; logos?: Record<string, BrandLogo> }) {
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const scaffoldedRef = useRef(false);
  const [tab, setTab] = useState<GoogleTab>("setup");

  // Favorites + chat, identical to the generic AppDetail: the star pins Google
  // to the home sidebar (keyed by app id "google"), and opening the Google chat
  // reuses the same "prevail:open-app" navigation any other app fires.
  const favs = useFavorites();
  const favKey = favKeyOf(GOOGLE_APP_ID);
  const isFav = favs.has(favKey);
  const openGoogleChat = useCallback(() => {
    window.dispatchEvent(new CustomEvent("prevail:open-app", { detail: { id: GOOGLE_APP_ID, title: "Google Workspace", domains: [] } }));
  }, []);

  // One-click setup streaming state.
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [authLog, setAuthLog] = useState<string[]>([]);
  const [authing, setAuthing] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const sessionRef = useRef<string>("");

  // Skills (shared engine command for app id "google").
  const [skills, setSkills] = useState<AppSkill[]>([]);
  const loadSkills = useCallback(() => {
    invoke<AppSkill[]>("engine_app_skills", { id: GOOGLE_APP_ID })
      .then((s) => setSkills(Array.isArray(s) ? s : []))
      .catch(() => setSkills([]));
  }, []);
  const [runningSkill, setRunningSkill] = useState<string | null>(null);
  const [learnMode, setLearnMode] = useState<ConnectorRunMode | null>(null);
  const [composing, setComposing] = useState(false);
  const [goalText, setGoalText] = useState("");

  // Soul (apps/google/soul.md), same construct any app uses.
  const [soulText, setSoulText] = useState("");
  const [soulDraft, setSoulDraft] = useState("");
  const [editSoul, setEditSoul] = useState(false);
  const [soulBusy, setSoulBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const s = await invoke<CliStatus>("google_cli_status");
      setCli(s);
      if (s.installed) {
        const ps = await invoke<Profile[]>("google_profiles");
        setProfiles(ps);
        // Once at least one account is connected, make sure the agent-facing
        // connector exists (idempotent). Done automatically so there is no
        // separate "connect for the agent" step for the user to puzzle over.
        if (ps.some((p) => p.status === "connected") && !scaffoldedRef.current) {
          scaffoldedRef.current = true;
          invoke("google_scaffold", { vault: vaultPath })
            .then(() => window.dispatchEvent(new CustomEvent("prevail:apps-changed")))
            .catch(() => { scaffoldedRef.current = false; });
        }
      }
    } catch (e) { console.error("google status", e); }
    finally { setLoading(false); }
  }, [vaultPath]);
  useEffect(() => { void reload(); }, [reload]);

  // Skills + soul load once (they exist independent of CLI install state, so the
  // user keeps access to them even before connecting).
  useEffect(() => { loadSkills(); }, [loadSkills]);
  useEffect(() => {
    let live = true;
    invoke<{ soul?: string }>("engine_app_get_soul", { id: GOOGLE_APP_ID })
      .then((r) => { if (live) setSoulText(typeof r?.soul === "string" ? r.soul : ""); })
      .catch(() => { if (live) setSoulText(""); });
    return () => { live = false; };
  }, []);

  const openSoulEditor = useCallback(() => { setSoulDraft(soulText); setEditSoul(true); }, [soulText]);
  const saveSoul = useCallback(async () => {
    setSoulBusy(true);
    try {
      const r = await invoke<{ ok?: boolean; soul?: string }>("engine_app_set_soul", { id: GOOGLE_APP_ID, soul: soulDraft });
      if (r?.ok !== false) { setSoulText(typeof r?.soul === "string" ? r.soul : soulDraft.trim()); setEditSoul(false); }
    } catch { /* leave editor open on failure */ } finally { setSoulBusy(false); }
  }, [soulDraft]);

  // Remove a Google account (delete its gws config dir) so the user can clear a
  // stuck/half-set-up account and start fresh. Re-scaffolds afterward.
  const removeProfile = async (configDir: string) => {
    setBusy(configDir); setMsg(null);
    try {
      await invoke("google_profile_remove", { configDir });
      await reload();
      await invoke("google_scaffold", { vault: vaultPath }).catch(() => {});
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
    } catch (e) { setMsg(`Could not remove that account: ${String(e).slice(0, 200)}`); }
    finally { setBusy(null); setConfirmRemove(null); }
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

  // Step 2: browser OAuth, streaming live status incl. the auth URL. `label`
  // names a NEW account; omit it (configDir given) to re-authorize an existing
  // one. The same streamed flow powers Connect, Re-authorize, and Add account,
  // so none of them is ever a silent spinner.
  const runConnect = async (configDir: string | null, label?: string) => {
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
        invoke("google_auth_login_stream", { session, configDir, label: label ?? null }).catch((err) => {
          setAuthLog((cur) => [...cur, `Sign-in failed: ${String(err).slice(0, 200)}`]);
          resolve();
        });
      });
    } finally {
      unLine(); unDone();
      scaffoldedRef.current = false; // re-scaffold against the new profile set
      await reload();
      await invoke("google_scaffold", { vault: vaultPath }).catch(() => {});
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
      setAuthing(false);
    }
  };

  const connectedCount = profiles.filter((p) => p.status === "connected").length;
  const connectedProfiles = profiles.filter((p) => p.status === "connected");
  // Which setup step are we on: 1 install, 2 connect, 3 validated.
  const setupStep = (!cli?.installed ? 1 : connectedCount === 0 ? 2 : 3) as 1 | 2 | 3;
  const cliVersion = (() => { const m = cli?.version?.match(/(\d+\.\d+\.\d+)/); return m ? m[1] : null; })();

  const humanizeSkill = (sid: string) => sid.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const TABS: { id: GoogleTab; label: string; icon: LucideIcon }[] = [
    { id: "setup", label: "Setup", icon: Link2 },
    { id: "skills", label: "Skills", icon: Boxes },
    { id: "soul", label: "Soul", icon: Sparkles },
    { id: "connections", label: "Connections", icon: Globe },
    { id: "chat", label: "Chat", icon: MessageSquare },
  ];

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
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => toggleFavorite(favKey)} title={isFav ? "On your home screen, click to remove" : "Add to your home screen"} aria-pressed={isFav}
            className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${isFav ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"}`}>
            <Star className={`h-4 w-4 ${isFav ? "fill-accent" : ""}`} />
          </button>
          <button onClick={() => void reload()} disabled={loading} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface/70 px-2 py-1 text-[11px] text-text-secondary backdrop-blur hover:border-accent-border hover:text-accent disabled:opacity-50">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
          </button>
          <button onClick={openGoogleChat} title="Open in chat"
            className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-background hover:bg-accent-hover">
            <MessageSquare className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tab bar - Google gets the same Setup / Skills / Soul / Connections
          surface as every other app, kept within this panel. */}
      <div className="border-b border-border-subtle px-5">
        <div className="flex flex-wrap items-center gap-1 py-2.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => {
                  // Chat reuses the existing app-chat navigation (the same event
                  // the header chat button fires) instead of rendering inline.
                  if (t.id === "chat") { openGoogleChat(); return; }
                  setTab(t.id);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-accent text-background shadow-sm" : "text-text-muted hover:bg-surface-warm hover:text-text-secondary"}`}>
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {t.id === "skills" && skills.length > 0 && <span className={`rounded-full px-1.5 py-px font-mono text-[9px] ${active ? "bg-background/20 text-background" : "bg-surface-warm text-text-muted"}`}>{skills.length}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4 px-5 py-5">
        {/* SETUP TAB - the Install -> Connect -> Ready flow + accounts + services. */}
        {tab === "setup" && (loading && !cli ? (
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

            {/* Step 3. Validated - richer two-column layout so the right side is
                used (#42b): accounts on the left, services + a manage/sync action
                on the right. */}
            {setupStep === 3 && (
              <div className="rounded-xl border border-ok/40 bg-ok/5 p-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ok/15 text-ok"><Check className="h-4 w-4" /></span>
                  <div>
                    <div className="text-sm font-semibold text-text-primary">Connected and ready</div>
                    <div className="text-[12px] text-text-secondary">Your agent can use Google across {connectedCount} account{connectedCount === 1 ? "" : "s"}.</div>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {/* Left: the connected accounts, each named clearly (#41). */}
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Connected account{connectedCount === 1 ? "" : "s"}</div>
                    <div className="mt-2 space-y-1.5">
                      {connectedProfiles.map((p) => (
                        <div key={p.configDir} className="flex items-center gap-2 rounded-lg border border-ok/30 bg-surface px-2.5 py-1.5">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
                          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary">{p.email || p.label}</span>
                          {p.email && p.label && p.label !== p.email && (
                            <span className="shrink-0 rounded-md border border-border-subtle bg-background px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted">{p.label}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Right: what the agent can reach + a re-sync action. */}
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Available services</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {SERVICES.map((name) => (
                        <span key={name} className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-2 py-1 text-[11px] font-medium text-text-secondary">
                          <GoogleServiceLogo name={name} size={14} /> {name}
                        </span>
                      ))}
                    </div>
                    <button onClick={() => { scaffoldedRef.current = false; void invoke("google_scaffold", { vault: vaultPath }).then(() => { window.dispatchEvent(new CustomEvent("prevail:apps-changed")); setMsg("Re-synced Google to your agent."); }).catch((e) => setMsg(`Could not re-sync: ${String(e).slice(0, 160)}`)); }}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:border-accent-border hover:text-accent">
                      <RefreshCw className="h-3 w-3" /> Re-sync to agent
                    </button>
                  </div>
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
                      {confirmRemove === p.configDir ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
                          Remove?
                          <button onClick={() => void removeProfile(p.configDir)} disabled={busy !== null} className="rounded px-1.5 py-0.5 font-medium text-err hover:bg-err/10 disabled:opacity-50">Yes</button>
                          <button onClick={() => setConfirmRemove(null)} className="rounded px-1.5 py-0.5 hover:bg-surface-warm">No</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmRemove(p.configDir)} disabled={busy !== null || authing} title="Remove this account and start fresh" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-err/10 hover:text-err disabled:opacity-50">
                          {busy === p.configDir ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  );
                })}

                {adding ? (
                  <div className="pt-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <input autoFocus value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="a name for this account (e.g. work, personal)"
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-text-primary focus:border-accent-border focus:outline-none" />
                      <button onClick={() => { const l = newLabel.trim(); if (l) { setAdding(false); setNewLabel(""); void runConnect(null, l); } }} disabled={!newLabel.trim() || authing || busy !== null}
                        className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50"><ExternalLink className="h-3.5 w-3.5" /> Sign in</button>
                      <button onClick={() => { setAdding(false); setNewLabel(""); }} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-text-muted">A separate Google account opens its own browser sign-in. Some accounts need extra Google setup the first time; if sign-in does not finish, the log will say what is needed and your main account keeps working.</p>
                  </div>
                ) : (
                  <button onClick={() => setAdding(true)} disabled={authing || busy !== null} className="inline-flex items-center gap-1 rounded-md border border-dashed border-accent-border px-2.5 py-1.5 text-xs text-accent hover:bg-accent-soft/40 disabled:opacity-50">
                    <Plus className="h-3.5 w-3.5" /> Add another Google account
                  </button>
                )}

                {/* Live sign-in log for Re-authorize / Add account once already
                    set up (the Step 2 card is gone by then), so these never spin
                    silently and any error (e.g. an account needing extra setup)
                    is visible. */}
                {authing && setupStep === 3 && (
                  <div className="pt-1">
                    {authUrl && (
                      <button onClick={() => void openUrl(authUrl)} className="mb-1 inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                        <ExternalLink className="h-3 w-3" /> Browser did not open? Click here
                      </button>
                    )}
                    <StreamLog lines={authLog} busy={authing} idle="Opening Google sign-in…" />
                  </div>
                )}
              </div>
            )}

            {/* What the agent can do, and the read vs write model - shown visually. */}
            {cli?.installed && (
              <div className="rounded-xl border border-border-subtle bg-background p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Available to your agent</div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {SERVICES.map((name) => (
                    <span key={name} className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                      <GoogleServiceLogo name={name} size={15} /> {name}
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
          </>
        ))}

        {/* SKILLS TAB - the app's REAL runnable skills for app id "google",
            including shipped starter packs. Same kind of content AppDetail shows;
            run streams progress inline, and you can teach your own. */}
        {tab === "skills" && (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Sparkles className="h-4 w-4 text-accent" /> Skills{skills.length > 0 && <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-muted">{skills.length}</span>}</div>
              {!learnMode && !composing && (
                <button onClick={() => { setGoalText(""); setComposing(true); }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10">
                  <Plus className="h-3.5 w-3.5" /> Learn New Skill
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[12px] text-text-muted">Actions Prevail can run for you across Google. Starter skills ship ready to run; you can also teach your own. Each runs by a method (Browser, MCP, or API), and your primary skill is the one Prevail runs by default.</p>

            {learnMode ? (
              <div className="mt-3">
                <ConnectorRunPanel appId={GOOGLE_APP_ID} mode={learnMode} goal={goalText || undefined} url={GOOGLE_WEBSITE}
                  onDone={(ok) => { loadSkills(); if (ok) setLearnMode(null); }}
                  onClose={() => setLearnMode(null)} />
              </div>
            ) : composing ? (
              <div className="mt-3 space-y-2 rounded-lg border border-border-subtle bg-surface p-3">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary"><Sparkles className="h-4 w-4 text-accent" /> Tell me what to do</div>
                <textarea autoFocus rows={3} value={goalText} onChange={(e) => setGoalText(e.target.value)}
                  placeholder={'e.g. "Each morning, summarize my unread Gmail and the day on my Calendar."'}
                  className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-muted/60 focus:border-accent-border focus:outline-none" />
                <div className="flex items-center gap-2">
                  <button onClick={() => { setComposing(false); setLearnMode("learn"); }} disabled={!goalText.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" /> Start learning</button>
                  <button onClick={() => setComposing(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
                </div>
                <p className="text-[11px] text-text-muted">I'll learn the steps and remember them so you can run this again any time.</p>
              </div>
            ) : (
              <>
                {runningSkill && (() => {
                  const rs = skills.find((s) => s.id === runningSkill);
                  return (
                    <GoogleSkillRun
                      skill={runningSkill}
                      label={rs ? (rs.name || humanizeSkill(rs.id)) : humanizeSkill(runningSkill)}
                      vaultPath={vaultPath}
                      onClose={() => setRunningSkill(null)}
                      onDone={(ok) => { if (ok) loadSkills(); }}
                    />
                  );
                })()}
                {skills.length === 0 ? (
                  <div className="mt-3 rounded-lg border border-dashed border-border bg-surface/40 px-4 py-4 text-center">
                    <div className="text-[13px] text-text-secondary">No skills yet.</div>
                    <div className="mt-0.5 text-[12px] text-text-muted">Click <span className="text-accent">Learn New Skill</span> and say what to do; saved in <code className="rounded bg-surface-warm px-1 font-mono text-[11px]">vault/apps/google/skills/</code>.</div>
                  </div>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {skills.map((s, i) => {
                      const primary = s.primary ?? s.favorite ?? i === 0;
                      const running = runningSkill === s.id;
                      const disabled = !!learnMode || (!!runningSkill && !running);
                      return (
                        <li key={s.id} className="flex items-center gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Boxes className="h-3.5 w-3.5" /></span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-medium text-text-primary">{s.name || humanizeSkill(s.id)}</span>
                              {primary && <span className="rounded-full border border-accent-border bg-accent-soft px-1.5 py-px font-mono text-[8px] uppercase tracking-wider text-accent">Primary</span>}
                              <span className="rounded-md border border-border-subtle bg-surface px-1.5 py-px font-mono text-[8px] uppercase tracking-wider text-text-muted">{skillMethod(s)}</span>
                            </div>
                            {s.summary && <div className="mt-0.5 truncate text-[11px] text-text-muted">{s.summary}</div>}
                          </div>
                          <button onClick={() => setRunningSkill(s.id)} disabled={disabled}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-40">
                            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {/* SOUL TAB - the editable note (apps/google/soul.md), same as any app. */}
        {tab === "soul" && (
          <div className="max-w-2xl space-y-4">
            <div className="rounded-xl border border-border-subtle bg-background/50 p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Sparkles className="h-4 w-4 text-accent" /> Soul</h3>
                {!editSoul && <button onClick={openSoulEditor} title="Edit soul" className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:border-accent-border hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>}
              </div>
              {editSoul ? (
                <div className="mt-2 flex flex-col">
                  <textarea autoFocus rows={5} value={soulDraft} onChange={(e) => setSoulDraft(e.target.value)}
                    placeholder="Why Google is in your harness: what it feeds your world."
                    className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted/60 focus:border-accent-border focus:outline-none" />
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={saveSoul} disabled={soulBusy} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{soulBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save</button>
                    <button onClick={() => setEditSoul(false)} className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary">Cancel</button>
                    <span className="ml-auto font-mono text-[10px] text-text-muted/70">apps/google/soul.md</span>
                  </div>
                </div>
              ) : soulText.trim() ? (
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">{soulText.trim()}</p>
              ) : (
                <button onClick={openSoulEditor} className="mt-2 flex flex-col items-start justify-center rounded-lg border border-dashed border-border bg-surface/40 px-4 py-5 text-left hover:border-accent-border">
                  <span className="text-[13px] text-text-secondary">Give Google a soul.</span>
                  <span className="mt-0.5 text-[12px] text-text-muted">Why it's in your harness: your AI reads this as standing context.</span>
                </button>
              )}
            </div>
            <div className="rounded-xl border border-border-subtle bg-background/50 p-5">
              <h3 className="text-sm font-semibold text-text-primary">How this connection works</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">Google Workspace is one connection that reaches Gmail, Calendar, Drive, Docs, Sheets, Tasks and Contacts across every account you sign in. Prevail talks to Google through the local gws helper, so reading happens on this Mac and nothing leaves it unless you act. Reading is instant; sending, changing or deleting waits for your OK under Needs you.</p>
            </div>
          </div>
        )}

        {/* CONNECTIONS TAB - the accounts, named clearly (#41), the services the
            agent can reach, and a re-sync action. */}
        {tab === "connections" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border-subtle bg-background/50 p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Globe className="h-4 w-4 text-accent" /> Connected accounts</h3>
                <button onClick={() => setTab("setup")} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:border-accent-border hover:text-accent">Manage</button>
              </div>
              {connectedProfiles.length === 0 ? (
                <p className="mt-2 text-[12px] text-text-muted">No Google account is connected yet. Open <button onClick={() => setTab("setup")} className="text-accent hover:underline">Setup</button> to sign in.</p>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {connectedProfiles.map((p) => (
                    <div key={p.configDir} className="flex items-center gap-2 rounded-lg border border-ok/30 bg-surface px-3 py-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-ok" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">{p.email || p.label}</span>
                      {p.email && p.label && p.label !== p.email && (
                        <span className="shrink-0 rounded-md border border-border-subtle bg-background px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted">{p.label}</span>
                      )}
                      <span className="shrink-0 text-[11px] text-ok">Connected</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-border-subtle bg-background/50 p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text-primary">Available services</h3>
                {connectedProfiles.length > 0 && (
                  <button onClick={() => { scaffoldedRef.current = false; void invoke("google_scaffold", { vault: vaultPath }).then(() => { window.dispatchEvent(new CustomEvent("prevail:apps-changed")); setMsg("Re-synced Google to your agent."); }).catch((e) => setMsg(`Could not re-sync: ${String(e).slice(0, 160)}`)); }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:border-accent-border hover:text-accent">
                    <RefreshCw className="h-3 w-3" /> Re-sync to agent
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {SERVICES.map((name) => (
                  <span key={name} className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                    <GoogleServiceLogo name={name} size={15} /> {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {msg && <div className="rounded-lg border border-border-subtle bg-background px-3 py-2 text-[12px] text-text-secondary">{msg}</div>}
      </div>
    </div>
  );
}

// The 3-step setup progress rail: Install -> Connect -> Ready, with the line
// between nodes filling green as each step completes. The FINAL node (Ready)
// renders FILLED green with a check once we have reached it (connected), rather
// than the hollow "active" ring used for in-progress steps (#42a).
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
        const isLast = n === steps.length;
        // A node is "done" (filled green) when a later step is reached, OR when
        // it is the final step and we have arrived at it - so Ready is never left
        // as a hollow ring once the flow is complete.
        const done = step > n || (isLast && step >= n);
        const active = step === n && !done;
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

// Inline runner for a Google skill (app id "google"), streaming the engine's
// NDJSON ChatEvents (engine-skill:line / engine-skill:done) so a run is never a
// silent spinner. Mirrors the generic AppDetail skill runner.
function GoogleSkillRun({ skill, label, vaultPath, onClose, onDone }: {
  skill: string; label: string; vaultPath: string; onClose: () => void; onDone?: (ok: boolean) => void;
}) {
  const [out, setOut] = useState("");
  const [stderr, setStderr] = useState("");
  const [running, setRunning] = useState(true);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const sessionRef = useRef<string>("");
  const okRef = useRef<boolean | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = `gskillrun-${crypto.randomUUID()}`;
      sessionRef.current = session;
      const unLine = await listen<{ session: string; stream?: string; data: ChatEvent | string }>("engine-skill:line", (e) => {
        const p = e.payload;
        if (p.session !== session) return;
        if (p.stream === "stderr" || typeof p.data === "string") {
          const s = String(p.data);
          if (s.trim()) setStderr((cur) => (cur + s + "\n").slice(-4000));
          return;
        }
        const ev = p.data as ChatEvent;
        switch (ev.type) {
          case "delta": { const t = ev.text; if (t) setOut((cur) => (cur + t).slice(-8000)); break; }
          case "assistant": { const t = ev.text; if (t) setOut((cur) => (cur.length >= t.length ? cur : t)); break; }
          case "error": okRef.current = false; setResult({ ok: false, message: ev.error }); break;
          case "done": if (ev.error) { okRef.current = false; setResult({ ok: false, message: ev.error }); } break;
          default: break;
        }
      });
      const unDone = await listen<{ session: string; code: number | null }>("engine-skill:done", (e) => {
        if (e.payload.session !== session) return;
        setRunning(false);
        const ok = okRef.current ?? e.payload.code === 0;
        setResult((r) => r ?? { ok });
        onDone?.(ok);
      });
      unsubsRef.current = [unLine, unDone];
      if (cancelled) { unLine(); unDone(); return; }
      invoke("engine_app_run_skill", { session, vault: vaultPath, app: GOOGLE_APP_ID, skill }).catch((err) => {
        okRef.current = false;
        setResult({ ok: false, message: String(err).slice(0, 200) });
        setRunning(false);
      });
    })();
    return () => {
      cancelled = true;
      for (const u of unsubsRef.current) u();
      if (sessionRef.current) void invoke("abort_sessions", { prefix: sessionRef.current }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [out, stderr]);
  const stop = async () => {
    if (sessionRef.current) await invoke("abort_sessions", { prefix: sessionRef.current }).catch(() => {});
    setRunning(false);
  };
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          {running ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : result?.ok ? <Check className="h-4 w-4 text-ok" /> : <X className="h-4 w-4 text-err" />}
          Running {label}
        </div>
        <button onClick={running ? () => void stop() : onClose} className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-warm">{running ? "Stop" : "Close"}</button>
      </div>
      <div ref={logRef} className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-warm/40 p-2 font-mono text-[11px] leading-relaxed text-text-secondary">
        {out
          ? out
          : running
            ? <span className="inline-flex items-center gap-1.5 text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> starting the skill…</span>
            : ""}
        {stderr && <div className="mt-1 text-text-muted">{stderr}</div>}
      </div>
      {result && !running && (
        <div className={`rounded-md px-3 py-2 text-sm ${result.ok ? "border border-ok/40 bg-ok/10 text-ok" : "border border-err/40 bg-err/10 text-err"}`}>
          {result.ok ? "Done." : `Failed: ${result.message || "see the log above."}`}
        </div>
      )}
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
