// Apps - the data-inflow surface. An app is "working" only if it's reliably
// refreshing the vault on a schedule, so this page's whole job is to make that
// UNMISTAKABLE: every app shows one color-coded status, the method it connects
// by, when it last synced and when it syncs next, and which domains it feeds.
// Connecting a new app is a single goal sentence (the Connection Agent figures
// out the method) - not a wall of forms. See docs/APPS-REDESIGN.md.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, FolderOpen, Loader2, Pencil, Plug, Plus, RefreshCw, X } from "lucide-react";
import { invoke } from "./bridge";
import { appName, relTime, titleCase } from "./format";
import { PREF, getPref, lsGet, lsSet } from "./storage";
import { Toggle } from "./ui";
import { SettingsHeader } from "./sectionutil";
import { ConnectAppFlow } from "./appconnect";
import type { EngineApp } from "./types";

type AppStatus = "connected" | "authorized" | "attention" | "connecting" | "disconnected";

// Fold the engine's many status strings + flags into the states the user actually
// needs to tell apart. CRITICAL (apps redesign): "connected" is NOT the optimistic
// default — it requires a REAL successful sync (lastSuccessTs set). Credentials
// present but no successful fetch yet = "authorized" (verifying), shown amber, not
// green. This kills the old "configured ⇒ green" lie.
export function appStatus(a: EngineApp): AppStatus {
  const s = (a.status || "").toLowerCase();
  if (s.includes("sync") || s.includes("connecting") || s.includes("probing")) return "connecting";
  if (!a.configured) return "disconnected";
  if (a.lastError || s.includes("error") || s.includes("expired") || s.includes("fail") || s.includes("auth")) return "attention";
  if (!a.lastSuccessTs) return "authorized"; // creds present, but we haven't pulled real data yet
  return "connected";
}

const STATUS_META: Record<AppStatus, { glyph: string; label: string; tint: string; ring: string; dot: string }> = {
  connected:    { glyph: "●", label: "Connected",       tint: "text-ok",         ring: "border-ok/40",     dot: "bg-ok" },
  authorized:   { glyph: "◌", label: "Authorized · verifying", tint: "text-warn", ring: "border-warn/40",  dot: "bg-warn/70" },
  connecting:   { glyph: "◐", label: "Connecting",      tint: "text-warn",       ring: "border-warn/40",   dot: "bg-warn" },
  attention:    { glyph: "▲", label: "Needs attention", tint: "text-danger",     ring: "border-danger/40", dot: "bg-danger" },
  disconnected: { glyph: "○", label: "Not connected",   tint: "text-text-muted", ring: "border-border",    dot: "bg-text-muted/40" },
};

// Per-app credential fields for key-based connectors (apps redesign P1). Each
// app's auth_env_vars are rendered as inline fields and stored in the Keychain
// via app_secret_set. OAuth apps are NOT listed here — they use the "Sign in"
// button. Grow this as connectors are brought to the fetch-gated model (P2 reads
// it from each manifest's auth_env_vars instead of this static map).
const CREDS_FIELDS: Record<string, { env: string; label: string; kind: "secret" | "toggle"; on?: string; off?: string }[]> = {
  paypal: [
    { env: "PAYPAL_CLIENT_ID", label: "Client ID", kind: "secret" },
    { env: "PAYPAL_CLIENT_SECRET", label: "Secret", kind: "secret" },
    { env: "PAYPAL_ENV", label: "Sandbox (test credentials)", kind: "toggle", on: "sandbox", off: "live" },
  ],
};

// "MCP" / "API" / "Browser" / "CLI" / "Composio" from the engine's integration id.
function methodLabel(integration: string): string {
  const m = (integration || "").toLowerCase();
  if (m.includes("mcp")) return "MCP";
  if (m.includes("composio")) return "Composio";
  if (m.includes("browser") || m.includes("playwright")) return "Browser";
  if (m.includes("cli")) return "CLI";
  if (m.includes("api") || m.includes("http") || m.includes("oauth")) return "API";
  return integration || "-";
}

function scheduleLabel(r: EngineApp["refresh"]): string {
  if (!r) return "no schedule";
  if (r.every) return `every ${r.every}`;
  if (r.on) return r.on;
  if (r.at) return `daily at ${r.at}`;
  return "scheduled";
}

// In-app autonomous sync: trigger a "due pass" on a cadence so connected apps
// refresh on their own schedule while the app is open (the headless
// `daemon --sync` does the same when the app is closed). The tick re-reads the
// enabled pref, and the engine respects each app's own schedule + the file lock.
let appsSyncTimer: number | null = null;
export function startAppsScheduler(vault: string) {
  if (appsSyncTimer !== null) window.clearInterval(appsSyncTimer);
  const tick = async () => {
    try {
      if (getPref(PREF.appsAutoSync, "1") !== "1") return;
      const intervalMs = (Number(getPref(PREF.appsSyncIntervalSec, "300")) || 300) * 1000;
      const last = Number(lsGet(PREF.appsSyncLastRun, "0")) || 0;
      if (Date.now() - last < intervalMs) return;
      lsSet(PREF.appsSyncLastRun, String(Date.now()));
      await invoke("engine_apps_sync_due", { vault });
      window.dispatchEvent(new Event("prevail:apps-synced"));
    } catch (e) { console.error("apps sync scheduler tick", e); }
  };
  appsSyncTimer = window.setInterval(tick, 60_000);
  window.setTimeout(tick, 12_000);
}

export function AppsPanel({ vaultPath }: { vaultPath: string }) {
  const [apps, setApps] = useState<EngineApp[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await invoke<EngineApp[]>("engine_apps_list");
      setApps(Array.isArray(list) ? list.map((x) => ({ ...x, title: appName(x.title) })) : []);
    } catch { setApps([]); }
  }, []);
  useEffect(() => {
    void reload();
    const onSynced = () => { void reload(); };
    // APP-2: the connect flow's "open existing" match jumps here to expand it.
    const onOpen = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id) setExpanded(id); };
    window.addEventListener("prevail:apps-synced", onSynced);
    window.addEventListener("prevail:apps-changed", onSynced);
    window.addEventListener("prevail:app-open", onOpen as EventListener);
    return () => {
      window.removeEventListener("prevail:apps-synced", onSynced);
      window.removeEventListener("prevail:apps-changed", onSynced);
      window.removeEventListener("prevail:app-open", onOpen as EventListener);
    };
  }, [reload]);

  const syncNow = useCallback(async (id: string) => {
    setBusy(id);
    try { await invoke("engine_app_sync", { id, vault: vaultPath }); await reload(); }
    catch (e) { console.error("sync app", e); }
    finally { setBusy(null); }
  }, [vaultPath, reload]);

  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    try { await invoke("engine_app_set_enabled", { id, enabled }); await reload(); }
    catch (e) { console.error("set enabled", e); }
  }, [reload]);

  // Group by status so the eye lands on what needs attention first, then live,
  // then unconnected.
  const groups = useMemo(() => {
    const order: AppStatus[] = ["attention", "connecting", "authorized", "connected", "disconnected"];
    const by: Record<AppStatus, EngineApp[]> = { attention: [], connecting: [], authorized: [], connected: [], disconnected: [] };
    for (const a of apps ?? []) by[appStatus(a)].push(a);
    return order.map((k) => ({ key: k, apps: by[k] })).filter((g) => g.apps.length > 0);
  }, [apps]);

  const liveCount = (apps ?? []).filter((a) => appStatus(a) === "connected").length;

  return (
    <>
      <SettingsHeader
        title="Apps"
        icon={Plug}
        subtitle="Services that feed your vault. Connect each one once, then it's available to any domain's context. No duplicates."
      />

      {/* Connect - one goal sentence, not forms. */}
      {connecting ? (
        <ConnectAppFlow
          vaultPath={vaultPath}
          onDone={async () => { setConnecting(false); await reload(); }}
          onCancel={() => setConnecting(false)}
        />
      ) : (
        <button
          onClick={() => setConnecting(true)}
          className="mb-5 flex w-full items-center gap-3 rounded-xl border border-dashed border-accent-border bg-accent-soft/20 px-4 py-3 text-left transition-colors hover:bg-accent-soft/40"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-background"><Plus className="h-4 w-4" /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-text-primary">Connect an app</span>
            <span className="block text-xs text-text-muted">Name it and say what it should pull in. Prevail picks the best way to connect.</span>
          </span>
        </button>
      )}

      {apps === null ? (
        <div className="text-sm text-text-muted">loading apps…</div>
      ) : apps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
          <Plug className="mx-auto h-7 w-7 text-text-muted opacity-50" />
          <p className="mt-3 text-sm text-text-secondary">No apps connected yet.</p>
          <p className="mt-1 text-xs text-text-muted">Connect one above to start feeding your domains real data.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {liveCount > 0 && (
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">{liveCount} of {apps.length} apps live</div>
          )}
          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <div className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] ${STATUS_META[g.key].tint}`}>
                <span>{STATUS_META[g.key].glyph}</span> {STATUS_META[g.key].label} · {g.apps.length}
              </div>
              {g.apps.map((a) => (
                <AppCard
                  key={a.id}
                  app={a}
                  vaultPath={vaultPath}
                  status={appStatus(a)}
                  open={expanded === a.id}
                  busy={busy === a.id}
                  onToggle={() => setExpanded((e) => (e === a.id ? null : a.id))}
                  onSync={() => syncNow(a.id)}
                  onSetEnabled={(v) => setEnabled(a.id, v)}
                  onReload={reload}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function AppCard({ app, vaultPath, status, open, busy, onToggle, onSync, onSetEnabled, onReload }: {
  app: EngineApp;
  vaultPath: string;
  status: AppStatus;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onSync: () => void;
  onSetEnabled: (v: boolean) => void;
  onReload: () => Promise<void> | void;
}) {
  const meta = STATUS_META[status];
  const enabled = app.enabled !== false;
  const initial = (app.title || app.id || "·").charAt(0).toUpperCase();
  const runs = app.runs ?? [];
  // Apps redesign: the actual data files this connector has loaded (so the user
  // can SEE what was pulled, and reveal it). Lazy-loaded when the card opens, and
  // reloaded after a successful sync (lastSuccessTs change).
  const [dataFiles, setDataFiles] = useState<{ path: string; name: string; bytes: number; mtime: number }[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    invoke<{ path: string; name: string; bytes: number; mtime: number }[]>("app_data_files", { vault: vaultPath, appId: app.id })
      .then((f) => { if (alive) setDataFiles(Array.isArray(f) ? f : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, app.id, vaultPath, app.lastSuccessTs]);
  // APP-5 - edit which domains this app feeds (engine_app_set_domains). The
  // vault's domain list is fetched lazily when the editor opens.
  const [editDomains, setEditDomains] = useState(false);
  const [allDomains, setAllDomains] = useState<string[]>([]);
  const [domSel, setDomSel] = useState<Set<string>>(new Set((app.domains ?? []).map((d) => d.toLowerCase())));
  const [domBusy, setDomBusy] = useState(false);
  const openDomainEditor = async () => {
    setDomSel(new Set((app.domains ?? []).map((d) => d.toLowerCase())));
    setEditDomains(true);
    if (allDomains.length === 0) {
      try {
        const ds = await invoke<{ name: string }[]>("scan_vault", { path: vaultPath });
        setAllDomains((ds ?? []).map((d) => d.name.toLowerCase()).sort());
      } catch { /* domains optional */ }
    }
  };
  const saveDomains = async () => {
    setDomBusy(true);
    try {
      await invoke("engine_app_set_domains", { id: app.id, domains: [...domSel] });
      setEditDomains(false);
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
      await onReload();
    } catch (e) { console.error("set domains", e); }
    finally { setDomBusy(false); }
  };
  // APP-4 - edit this app's autonomous-sync schedule (engine_app_set_schedule).
  // Cadences are the ones the engine validates: hourly, every Nh, daily, weekly.
  const [editSched, setEditSched] = useState(false);
  const [schedEvery, setSchedEvery] = useState(app.refresh?.every ?? "daily");
  const [schedAt, setSchedAt] = useState(app.refresh?.at ?? "");
  const [schedOn, setSchedOn] = useState(app.refresh?.on ?? "");
  const [schedBusy, setSchedBusy] = useState(false);
  const openSchedEditor = () => {
    setSchedEvery(app.refresh?.every ?? "daily");
    setSchedAt(app.refresh?.at ?? "");
    setSchedOn(app.refresh?.on ?? "");
    setEditSched(true);
  };
  const saveSchedule = async (clear?: boolean) => {
    setSchedBusy(true);
    try {
      await invoke("engine_app_set_schedule", {
        id: app.id,
        every: clear ? "off" : schedEvery,
        at: clear ? null : ((schedEvery === "daily" || schedEvery === "weekly") && schedAt ? schedAt : null),
        on: clear ? null : (schedEvery === "weekly" && schedOn ? schedOn : null),
      });
      setEditSched(false);
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
      await onReload();
    } catch (e) { console.error("set schedule", e); }
    finally { setSchedBusy(false); }
  };
  // Apps redesign P1: generic credential entry, driven by a per-app field spec
  // (CREDS_FIELDS) instead of a PayPal hardcode. The user's only step is pasting
  // what a key-based connector needs; on save we store each value in the Keychain
  // (app_secret_set) and immediately run a real sync — the card only turns green
  // if that fetch actually succeeds. OAuth apps use the "Sign in" button instead.
  const credSpec = CREDS_FIELDS[app.id];
  const isOAuth = (app.integration || "").toLowerCase().includes("oauth");
  const needsCreds = !!credSpec || isOAuth;
  const [credVals, setCredVals] = useState<Record<string, string>>({});
  const [credBusy, setCredBusy] = useState(false);
  const [credMsg, setCredMsg] = useState<string | null>(null);
  const verifySync = async () => {
    await invoke("engine_app_sync", { id: app.id, vault: vaultPath });
    window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
    await onReload();
  };
  const saveCreds = async () => {
    if (!credSpec) return;
    setCredBusy(true); setCredMsg("Saving + verifying by a real fetch…");
    try {
      for (const f of credSpec) {
        if (f.kind === "toggle") {
          await invoke("app_secret_set", { name: f.env, value: credVals[f.env] === "on" ? (f.on ?? "on") : (f.off ?? "off") });
        } else if ((credVals[f.env] ?? "").trim()) {
          await invoke("app_secret_set", { name: f.env, value: credVals[f.env].trim() });
        }
      }
      await verifySync();
      setCredVals((v) => { const n = { ...v }; for (const f of credSpec) if (f.kind === "secret") delete n[f.env]; return n; });
      setCredMsg("Verified — pulled real data. (The card turns green once a sync succeeds.)");
    } catch (e) { setCredMsg(`Failed: ${String(e).slice(0, 200)}`); }
    finally { setCredBusy(false); }
  };
  const signIn = async () => {
    setCredBusy(true); setCredMsg("Opening sign-in… complete it in your browser.");
    try {
      await invoke("engine_app_oauth", { id: app.id, vault: vaultPath });
      await verifySync();
      setCredMsg("Signed in — verified by a real fetch.");
    } catch (e) { setCredMsg(`Sign-in failed: ${String(e).slice(0, 200)}`); }
    finally { setCredBusy(false); }
  };
  // P4 - re-evaluate the connection method: maybe a better one exists now.
  const [reEval, setReEval] = useState<string | null>(null);
  const [reEvalBusy, setReEvalBusy] = useState(false);
  // A2 - change the connection method by hand (MCP / API / OAuth / browser / manual).
  const [methodBusy, setMethodBusy] = useState(false);
  const changeMethod = async (integration: string) => {
    if (!integration || integration === app.integration) return;
    setMethodBusy(true);
    try {
      await invoke("engine_app_set_integration", { id: app.id, integration });
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
      await onReload();
    } catch (e) { console.error("set integration", e); }
    finally { setMethodBusy(false); }
  };
  const reevaluate = async () => {
    setReEvalBusy(true);
    setReEval(null);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = getPref(PREF.distillModel, "claude-haiku-4-5");
      const r = await invoke<{ ok: boolean; plan?: { integration?: string; why?: string }; error?: string }>(
        "engine_app_connect", { name: app.title || app.id, goal: "", vault: vaultPath, provider, model, reevaluate: true, current: app.integration },
      );
      if (r.ok && r.plan) {
        const m = methodLabel(r.plan.integration ?? "");
        const same = (r.plan.integration ?? "").toLowerCase() === (app.integration ?? "").toLowerCase();
        setReEval(same ? `Still best via ${m}.` : `Better now: ${m}${r.plan.why ? ` - ${r.plan.why}` : ""}`);
      } else setReEval(r.error ?? "Could not re-evaluate.");
    } catch (e) { setReEval(`Re-evaluate failed: ${e}`); }
    finally { setReEvalBusy(false); }
  };
  return (
    <div className={`overflow-hidden rounded-xl border bg-surface ${meta.ring}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-warm font-display text-base font-bold text-text-secondary">{initial}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-text-primary">{app.title || app.id}</span>
              <span className={`inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider ${meta.tint}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${status === "connecting" ? "animate-pulse" : ""}`} />
                {meta.label}
              </span>
              <span className="rounded border border-border-subtle px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted">{methodLabel(app.integration)}</span>
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted">
              {status === "connected" && <span>synced {app.lastSuccessTs ? relTime(app.lastSuccessTs) : "-"}</span>}
              {status === "attention" && <span className="text-danger">{app.lastError ? app.lastError.slice(0, 60) : "needs re-auth"}</span>}
              {status === "disconnected" && <span>not set up</span>}
              {status === "connected" && <span>· {scheduleLabel(app.refresh)}</span>}
              {status === "connected" && app.nextDueTs ? <span>· next {relTime(app.nextDueTs)}</span> : null}
              {(app.domains ?? []).length > 0 && <span>· feeds {app.domains.map(titleCase).join(", ")}</span>}
            </span>
          </span>
        </button>
        {status !== "disconnected" && (
          <button
            onClick={onSync}
            disabled={busy}
            title="Sync this app now"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} {busy ? "syncing" : "sync"}
          </button>
        )}
      </div>
      {open && (
        <div className="relative space-y-3 border-t border-border-subtle px-4 py-4 pl-[60px] text-[13px]">
          {/* P3 (Monday feedback): clicking the card header collapses this, but a
              tiny explicit close affordance is clearer. */}
          <button
            onClick={onToggle}
            title="Close details"
            className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {app.account?.label && <Detail label="Account">{app.account.label}{app.account.address ? ` · ${app.account.address}` : ""}</Detail>}
          <Detail label="Method">
            <span className="inline-flex flex-wrap items-center gap-2">
              {/* A2 (Monday feedback): change the method by hand. */}
              <select value={(app.integration || "manual").toLowerCase()} onChange={(e) => void changeMethod(e.target.value)} disabled={methodBusy}
                title="Change how this app connects"
                className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none disabled:opacity-50">
                {["mcp", "api", "oauth", "browser", "manual"].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
              </select>
              {app.connections?.length ? <span className="text-text-muted">· {app.connections.map((c) => c.kind).join(", ")}</span> : null}
              {methodBusy && <Loader2 className="h-3 w-3 animate-spin text-text-muted" />}
              <button onClick={reevaluate} disabled={reEvalBusy}
                title="Check whether a better way to connect this app exists now"
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50">
                {reEvalBusy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />} re-evaluate
              </button>
            </span>
          </Detail>
          {reEval && <div className="rounded-md border border-border-subtle bg-background px-3 py-1.5 text-xs text-text-secondary">{reEval}</div>}
          {needsCreds && (
            <Detail label={isOAuth ? "Sign in" : "Credentials"}>
              <div className="flex flex-col gap-1.5">
                {isOAuth ? (
                  <>
                    <button onClick={signIn} disabled={credBusy}
                      className="inline-flex w-fit items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                      {credBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{credBusy ? "Signing in…" : `Sign in to ${app.title || app.id}`}
                    </button>
                    <span className="text-[10px] text-text-muted/70">Opens your browser to authorize, then verifies by a real fetch. Token stored locally; used read-only.</span>
                  </>
                ) : (
                  <>
                    {credSpec!.map((f) => f.kind === "toggle" ? (
                      <label key={f.env} className="flex items-center gap-2 text-[11px] text-text-secondary">
                        <input type="checkbox" checked={credVals[f.env] === "on"} onChange={(e) => setCredVals((v) => ({ ...v, [f.env]: e.target.checked ? "on" : "off" }))} className="h-3 w-3 accent-[var(--color-accent)]" />
                        {f.label}
                      </label>
                    ) : (
                      <input key={f.env} type="password" value={credVals[f.env] ?? ""} onChange={(e) => setCredVals((v) => ({ ...v, [f.env]: e.target.value }))} placeholder={f.label} autoComplete="off"
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none" />
                    ))}
                    <button onClick={saveCreds} disabled={credBusy || !credSpec!.some((f) => f.kind === "secret" && (credVals[f.env] ?? "").trim())}
                      className="inline-flex w-fit items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                      {credBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{credBusy ? "Verifying…" : "Save & verify"}
                    </button>
                  </>
                )}
                {credMsg && <span className="text-[11px] text-text-muted">{credMsg}</span>}
                {app.id === "paypal" && !isOAuth && <span className="text-[10px] text-text-muted/70">Create a REST app at developer.paypal.com with Transaction Search enabled. Stored in your Keychain; used read-only.</span>}
              </div>
            </Detail>
          )}
          {/* APP-4 - schedule, now editable with engine-honored cadences. */}
          <Detail label="Schedule">
            {!editSched ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span>{scheduleLabel(app.refresh)}</span>
                <button onClick={openSchedEditor}
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
                  <Pencil className="h-2.5 w-2.5" /> edit
                </button>
              </span>
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <select value={schedEvery} onChange={(e) => setSchedEvery(e.target.value)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none">
                    <option value="hourly">hourly</option>
                    <option value="6h">every 6 hours</option>
                    <option value="12h">every 12 hours</option>
                    <option value="daily">daily</option>
                    <option value="weekly">weekly</option>
                  </select>
                  {(schedEvery === "daily" || schedEvery === "weekly") && (
                    <input type="time" value={schedAt} onChange={(e) => setSchedAt(e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none" />
                  )}
                  {schedEvery === "weekly" && (
                    <select value={schedOn} onChange={(e) => setSchedOn(e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none">
                      <option value="">any day</option>
                      {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
                    </select>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => saveSchedule(false)} disabled={schedBusy}
                    className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                    {schedBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
                  </button>
                  <button onClick={() => setEditSched(false)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary">
                    <X className="h-3 w-3" /> Cancel
                  </button>
                  {app.refresh && (
                    <button onClick={() => saveSchedule(true)} disabled={schedBusy}
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:border-danger hover:text-danger disabled:opacity-50">
                      Clear schedule
                    </button>
                  )}
                </div>
              </div>
            )}
          </Detail>
          {app.nextDueTs ? <Detail label="Next sync">{relTime(app.nextDueTs)}</Detail> : null}
          {/* APP-5 - domains fed, now editable. */}
          <Detail label="Domains fed">
            {!editDomains ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {(app.domains ?? []).length ? (app.domains).map((d) => (
                  <button key={d} onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: d }))}
                    title={`Open the ${titleCase(d)} domain`}
                    className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent-border hover:text-accent">
                    {titleCase(d)}
                  </button>
                )) : <span>none yet</span>}
                <button onClick={openDomainEditor}
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
                  <Pencil className="h-2.5 w-2.5" /> edit
                </button>
              </span>
            ) : (
              <div>
                <div className="flex flex-wrap gap-1.5">
                  {(allDomains.length ? allDomains : [...domSel]).map((d) => {
                    const on = domSel.has(d);
                    return (
                      <button key={d} onClick={() => setDomSel((cur) => { const n = new Set(cur); n.has(d) ? n.delete(d) : n.add(d); return n; })}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-muted hover:border-accent-border"}`}>
                        {on && <Check className="mr-1 inline h-2.5 w-2.5" />}{titleCase(d)}
                      </button>
                    );
                  })}
                  {allDomains.length === 0 && domSel.size === 0 && <span className="text-[11px] text-text-muted">loading domains…</span>}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={saveDomains} disabled={domBusy}
                    className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                    {domBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
                  </button>
                  <button onClick={() => setEditDomains(false)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary">
                    <X className="h-3 w-3" /> Cancel
                  </button>
                </div>
              </div>
            )}
          </Detail>
          {/* APP-6 - surface where the per-app (MCP/connector) config lives + reveal it. */}
          {app.path && (
            <Detail label="Config">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <code className="break-all font-mono text-[11px] text-text-secondary">{app.path}</code>
                <button onClick={() => void invoke("open_in_finder", { path: app.path! }).catch(() => {})}
                  title="Open this app's config folder (manifest + MCP/connector config)"
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
                  <FolderOpen className="h-2.5 w-2.5" /> reveal
                </button>
              </span>
            </Detail>
          )}
          {dataFiles.length > 0 && (
            <Detail label="Data loaded">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-text-muted">
                  {dataFiles.length} file{dataFiles.length === 1 ? "" : "s"}
                  {(app.domains ?? []).length ? ` → feeding ${app.domains.map(titleCase).join(", ")}` : ""}
                </span>
                {dataFiles.slice(0, 5).map((f) => (
                  <button key={f.path} onClick={() => void invoke("open_in_finder", { path: f.path }).catch(() => {})}
                    title="Reveal in Finder"
                    className="inline-flex w-fit items-center gap-1.5 font-mono text-[11px] text-text-secondary hover:text-accent">
                    <FolderOpen className="h-3 w-3 shrink-0" /> {f.name}
                  </button>
                ))}
                {dataFiles.length > 5 && <span className="text-[10px] text-text-muted/70">+{dataFiles.length - 5} more</span>}
              </div>
            </Detail>
          )}
          {app.lastError && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {app.lastError}
            </div>
          )}
          {runs.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">Recent activity</div>
              <ul className="space-y-0.5">
                {[...runs].reverse().map((r, i) => (
                  <li key={i} className="flex items-center gap-2 font-mono text-[11px]">
                    <span className={r.ok ? "text-ok" : "text-danger"}>{r.ok ? "✓" : "✗"}</span>
                    <span className="text-text-muted">{relTime(r.ts)}</span>
                    <span className="min-w-0 flex-1 truncate text-text-secondary">{r.ok ? (r.summary || `${r.artifacts ?? 0} item(s)`) : (r.error || "failed")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border-subtle pt-2.5">
            <span className="flex items-center gap-2 text-xs text-text-secondary">
              <Toggle on={enabled} onChange={onSetEnabled} label={`${app.title} scheduled sync`} />
              {enabled ? "Scheduled sync on" : "Scheduled sync off"}
            </span>
            {status === "connected" && <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ok"><Check className="h-3 w-3" /> working</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className="min-w-0 flex-1 text-text-secondary">{children}</span>
    </div>
  );
}
