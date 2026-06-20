// Apps - the data-inflow surface. An app is "working" only if it's reliably
// refreshing the vault on a schedule, so this page's whole job is to make that
// UNMISTAKABLE: every app shows one color-coded status, the method it connects
// by, when it last synced and when it syncs next, and which domains it feeds.
// Connecting a new app is a single goal sentence (the Connection Agent figures
// out the method) - not a wall of forms. See docs/APPS-REDESIGN.md.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Boxes, Check, ExternalLink, FolderOpen, Globe, Link2, Loader2, Pencil, Plug, Plus, RefreshCw, Search, ShieldCheck, Star, Trash2, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "./bridge";
import { appName, relTime, titleCase } from "./format";
import { PREF, getPref, lsGet, lsSet } from "./storage";
import { Toggle } from "./ui";
import { SettingsHeader } from "./sectionutil";
import { ConnectAppFlow } from "./appconnect";
import { AppRowLogo } from "./panels3";
import type { BrandLogo, CatalogApp, ConnectorCatalog, EngineApp } from "./types";

type AppStatus = "connected" | "authorized" | "attention" | "connecting" | "disconnected";

// Fold the engine's many status strings + flags into the states the user actually
// needs to tell apart. CRITICAL (apps redesign): "connected" is NOT the optimistic
// default - it requires a REAL successful sync (lastSuccessTs set). Credentials
// present but no successful fetch yet = "authorized" (verifying), shown amber, not
// green. This kills the old "configured ⇒ green" lie.
export function appStatus(a: EngineApp): AppStatus {
  const s = (a.status || "").toLowerCase();
  if (s.includes("sync") || s.includes("connecting") || s.includes("probing")) return "connecting";
  if (!a.configured) return "disconnected";
  if (a.lastError || s.includes("error") || s.includes("expired") || s.includes("fail") || s.includes("auth")) return "attention";
  // The fetch gate (engine: daemon-sync.ts). "connected" requires that the
  // connector has actually pulled real data at least once - firstFetchOk is the
  // authoritative signal; lastSuccessTs is the legacy fallback for apps last
  // synced before the gate existed. Creds present but no real fetch yet =
  // "authorized · verifying" (amber), never green.
  if (!a.firstFetchOk && !a.lastSuccessTs) return "authorized";
  return "connected";
}

const STATUS_META: Record<AppStatus, { glyph: string; label: string; tint: string; ring: string; dot: string }> = {
  connected:    { glyph: "●", label: "Connected",       tint: "text-ok",         ring: "border-ok/40",     dot: "bg-ok" },
  authorized:   { glyph: "◌", label: "Authorized · verifying", tint: "text-warn", ring: "border-warn/40",  dot: "bg-warn/70" },
  connecting:   { glyph: "◐", label: "Connecting",      tint: "text-warn",       ring: "border-warn/40",   dot: "bg-warn" },
  attention:    { glyph: "▲", label: "Needs attention", tint: "text-danger",     ring: "border-danger/40", dot: "bg-danger" },
  disconnected: { glyph: "○", label: "Not connected",   tint: "text-text-muted", ring: "border-border",    dot: "bg-text-muted/40" },
};

type CredField = { env: string; label: string; kind: "secret" | "toggle"; on?: string; off?: string };

// Hand-tuned credential layouts for connectors that benefit from extras a bare
// env-var list can't express (e.g. PayPal's Sandbox/Live toggle + nicer labels).
// Everything NOT listed here is now driven generically by the manifest's
// auth_env_vars (see genericCredFields) - no per-app code needed to add a
// key-based connector. OAuth apps use the "Sign in" button, not these fields.
const CREDS_FIELDS: Record<string, CredField[]> = {
  paypal: [
    { env: "PAYPAL_CLIENT_ID", label: "Client ID", kind: "secret" },
    { env: "PAYPAL_CLIENT_SECRET", label: "Secret", kind: "secret" },
    { env: "PAYPAL_ENV", label: "Sandbox (test credentials)", kind: "toggle", on: "sandbox", off: "live" },
  ],
};

// Turn an env-var name into a human label: drop the provider prefix and the
// trailing token kind, title-case the rest. PAYPAL_CLIENT_ID -> "Client ID",
// OURA_PERSONAL_ACCESS_TOKEN -> "Personal Access Token", GITHUB_TOKEN -> "Token".
function humanizeEnv(env: string): string {
  const noPrefix = env.replace(/^[A-Z0-9]+_/, "") || env;
  return noPrefix
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bId\b/g, "ID")
    .replace(/\bApi\b/g, "API")
    .replace(/\bUrl\b/g, "URL");
}

// Generic credential fields straight from the manifest's auth_env_vars - the
// fetch-gated replacement for the static map. Each var becomes a secret field;
// the entered value is stored in the OS keychain and injected as env.
function genericCredFields(app: EngineApp): CredField[] {
  return (app.authEnvVars ?? []).map((env) => ({ env, label: humanizeEnv(env), kind: "secret" as const }));
}

// The credential spec for an app: the hand-tuned layout if one exists, else the
// generic auth_env_vars-driven fields.
function credFieldsFor(app: EngineApp): CredField[] | undefined {
  if (CREDS_FIELDS[app.id]) return CREDS_FIELDS[app.id];
  const generic = genericCredFields(app);
  return generic.length ? generic : undefined;
}

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

// Favorites ("my list"): a client-side set of pinned apps - connected OR catalog -
// keyed by normalized name so a pinned catalog app and its later-installed self
// are the same entry. Persisted in localStorage and shared across rows via a
// listener set, so toggling a star anywhere updates the pinned section live.
const FAV_KEY = "prevail.apps.favorites";
const favListeners = new Set<() => void>();
const favKeyOf = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function readFavorites(): Set<string> {
  try { const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
}
function toggleFavorite(key: string) {
  const s = readFavorites();
  if (s.has(key)) s.delete(key); else s.add(key);
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
  favListeners.forEach((l) => l());
}
function useFavorites(): Set<string> {
  const [favs, setFavs] = useState<Set<string>>(readFavorites);
  useEffect(() => {
    const l = () => setFavs(readFavorites());
    favListeners.add(l);
    return () => { favListeners.delete(l); };
  }, []);
  return favs;
}

export function AppsPanel({ vaultPath }: { vaultPath: string }) {
  const [apps, setApps] = useState<EngineApp[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Master-detail: which connector is open in the right pane. `null` while apps
  // are still loading or none exist; otherwise the selected app id.
  const [selected, setSelected] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Top-level track: "direct" (Prevail connects each app itself) vs "composio"
  // (one managed gateway). Two parallel, never-mixed tracks; persisted.
  const [appsMode, setAppsModeState] = useState<"direct" | "composio">(() => {
    try { return localStorage.getItem("prevail.apps.mode") === "composio" ? "composio" : "direct"; } catch { return "direct"; }
  });
  const setAppsMode = useCallback((m: "direct" | "composio") => {
    setAppsModeState(m);
    try { localStorage.setItem("prevail.apps.mode", m); } catch { /* ignore */ }
  }, []);
  // The Composio managed-gateway pane (one OAuth fronts 1000+ apps for the agent).
  const [query, setQuery] = useState("");
  // Real brand marks for every connector (AllTrails, Booking.com, Garmin, …),
  // loaded once and shared by the list rows + the detail header via AppRowLogo so
  // logos render identically here, in the per-domain list, and in the connect flow.
  const [logos, setLogos] = useState<Record<string, BrandLogo>>({});
  useEffect(() => { invoke<Record<string, BrandLogo>>("ingestion_connector_logos").then(setLogos).catch(() => {}); }, []);
  // The full 1000+ connector catalog, loaded once and folded INTO the left
  // sidebar (no separate "Browse the catalog" bar). Each catalog app becomes a
  // selectable row; picking one that isn't installed yet routes to the connect
  // flow. Optional - if the command is unavailable, the catalog section is just
  // empty and the installed-apps list still works.
  const [catalog, setCatalog] = useState<CatalogApp[]>([]);
  useEffect(() => {
    void invoke<ConnectorCatalog>("ingestion_connector_catalog")
      .then((c) => setCatalog(Array.isArray(c?.apps) ? c.apps : []))
      .catch(() => {});
  }, []);
  // When a CATALOG (not-yet-installed) app is selected, we open the connect flow
  // for it. ConnectAppFlow doesn't take a typed-name prop, so we surface the
  // chosen app in a small detail pane with a "Connect" CTA that opens the flow.
  const [catalogPick, setCatalogPick] = useState<CatalogApp | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await invoke<EngineApp[]>("engine_apps_list");
      const next = Array.isArray(list) ? list.map((x) => ({ ...x, title: appName(x.title) })) : [];
      setApps(next);
      // Default selection: keep the current one if it still exists, else first app.
      setSelected((cur) => (cur && next.some((a) => a.id === cur) ? cur : (next[0]?.id ?? null)));
    } catch { setApps([]); }
  }, []);
  useEffect(() => {
    void reload();
    const onSynced = () => { void reload(); };
    // APP-2: the connect flow's "open existing" match jumps here to select it.
    const onOpen = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id) setSelected(id); };
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

  // Connect a catalog app: scaffold it NOW with its known method, then open its
  // detail where the real per-method auth runs (browser sign-in, API key, MCP
  // setup, OAuth). No slow model-research for a known app - the method comes
  // straight from the catalog's connection_hint, so Connect is instant and the
  // very next thing the user sees is the actual auth step for that method.
  const [catalogConnecting, setCatalogConnecting] = useState(false);
  const [catalogConnectErr, setCatalogConnectErr] = useState<string | null>(null);
  const connectCatalogApp = useCallback(async (c: CatalogApp) => {
    setCatalogConnecting(true);
    setCatalogConnectErr(null);
    try {
      const id = (c.iconSlug || c.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
      const integration = hintToIntegration(c.connection_hint?.method || c.via);
      const domains = c.domain ? [c.domain] : [];
      try {
        await invoke("engine_app_add", { id, title: c.name, integration, domains });
      } catch (e) {
        // Already installed: just open it. Anything else is a real failure.
        if (!/already exists/i.test(String(e))) throw e;
      }
      await reload();
      setCatalogPick(null); setConnecting(false);
      setSelected(id);
    } catch (e) {
      setCatalogConnectErr(`Couldn't add ${c.name}: ${String(e).slice(0, 160)}`);
    } finally {
      setCatalogConnecting(false);
    }
  }, [reload]);

  // Filter by the search box (name or method), then group into Connected vs
  // Setup (authorizing / connecting / needs attention) vs Not connected so the
  // left list reads top-to-bottom like Claude Desktop / ChatGPT connectors.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (a: EngineApp) =>
      !q || (a.title || a.id).toLowerCase().includes(q) || methodLabel(a.integration).toLowerCase().includes(q);
    const filtered = (apps ?? []).filter(match);
    const bucketOf = (a: EngineApp): "connected" | "setup" | "off" => {
      const st = appStatus(a);
      if (st === "connected") return "connected";
      if (st === "disconnected") return "off";
      return "setup"; // authorized / connecting / attention
    };
    const order = [
      { key: "setup" as const, label: "Authorizing / setup", tint: "text-warn" },
      { key: "connected" as const, label: "Connected", tint: "text-ok" },
      { key: "off" as const, label: "Not connected", tint: "text-text-muted" },
    ];
    const by: Record<"connected" | "setup" | "off", EngineApp[]> = { connected: [], setup: [], off: [] };
    for (const a of filtered) by[bucketOf(a)].push(a);
    return order.map((g) => ({ ...g, apps: by[g.key] })).filter((g) => g.apps.length > 0);
  }, [apps, query]);

  // The catalog folded into the sidebar: every connector NOT already installed,
  // deduped against the installed apps (by normalized name / id / iconSlug) so a
  // catalog entry that matches an installed app shows only once - as the
  // installed one, above. Because the catalog is 1000+ entries we don't render
  // all of them: when searching we show every match; otherwise we cap to a
  // curated/tier-1 first slice (CATALOG_CAP) with a "search to find more" note.
  const CATALOG_CAP = 40;
  const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const catalogView = useMemo(() => {
    const installedKeys = new Set<string>();
    for (const a of apps ?? []) { installedKeys.add(norm(a.id)); installedKeys.add(norm(a.title || "")); }
    const q = query.trim().toLowerCase();
    const available = catalog.filter((c) => {
      const keyName = norm(c.name);
      const keySlug = norm(c.iconSlug || "");
      if (!keyName) return false;
      if (installedKeys.has(keyName) || (keySlug && installedKeys.has(keySlug))) return false;
      return true;
    });
    // Dedupe duplicate catalog entries (the catalog can list the same app twice,
    // e.g. "Google Contacts") so the list and count don't double up.
    const seen = new Set<string>();
    const deduped = available.filter((c) => { const k = norm(c.name); if (seen.has(k)) return false; seen.add(k); return true; });
    // Match the name, category, OR tags so "linkedin", "calendar", "trail" all
    // hit. Both shown and total derive from this same filtered set so they agree.
    const matched = !q ? deduped : deduped.filter((c) => {
      const hay = `${c.name} ${c.domain} ${(c.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
    // Curated / tier-1 first so the un-searched cap shows the apps people want.
    const ranked = [...matched].sort((a, b) => {
      const score = (c: CatalogApp) => (c.curated ? 0 : 2) + (c.tier === 1 ? 0 : 1) - (c.verified ? 1 : 0);
      const d = score(a) - score(b);
      return d !== 0 ? d : (a.name || "").localeCompare(b.name || "");
    });
    const searching = q.length > 0;
    const shown = searching ? ranked : ranked.slice(0, CATALOG_CAP);
    return { shown, total: matched.length, searching };
  }, [apps, catalog, query]);

  const liveCount = (apps ?? []).filter((a) => appStatus(a) === "connected").length;

  // "My list" - the user's pinned apps, connected or catalog, surfaced at the top
  // of the sidebar for quick access. A pinned catalog app and its installed self
  // share a normalized key, so once connected it shows from the connected side.
  const favs = useFavorites();
  const pinned = useMemo(() => {
    const connected = (apps ?? []).filter((a) => favs.has(favKeyOf(a.title || a.id)) || favs.has(favKeyOf(a.id)));
    const connectedKeys = new Set(connected.map((a) => favKeyOf(a.title || a.id)));
    const seen = new Set<string>();
    const catalogPinned = catalog.filter((c) => {
      const k = favKeyOf(c.name);
      if (!favs.has(k) || connectedKeys.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { connected, catalog: catalogPinned, count: connected.length + catalogPinned.length };
  }, [apps, catalog, favs]);
  const selectedApp = (apps ?? []).find((a) => a.id === selected) ?? null;

  return (
    <>
      <SettingsHeader
        title="Apps"
        icon={Plug}
        subtitle="Services that feed your vault. Connect each one once, then it's available to any domain's context. No duplicates."
      />

      {/* Top-level split: Direct (Prevail connects each app itself) vs Composio
          (one managed gateway). Two parallel tracks, never mixed. */}
      <div className="mb-5 inline-flex rounded-lg border border-border bg-surface p-1">
        {(["direct", "composio"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setAppsMode(m)}
            className={`rounded-md px-5 py-1.5 text-sm font-semibold transition-colors ${appsMode === m ? "bg-accent text-background" : "text-text-secondary hover:text-text-primary"}`}
          >
            {m === "direct" ? "Direct" : "Composio"}
          </button>
        ))}
      </div>

      {/* Connect happens INSIDE the right detail pane (see below) so the app's
          context and the sidebar stay put - the connect flow never replaces the
          whole view. Only the rare zero-apps-and-zero-catalog case hosts it here. */}
      {appsMode === "composio" ? (
        <ComposioMode />
      ) : apps === null ? (
        <div className="text-sm text-text-muted">loading apps…</div>
      ) : apps.length === 0 && catalog.length === 0 ? (
        connecting ? (
          <ConnectAppFlow
            vaultPath={vaultPath}
            onDone={async () => { setConnecting(false); setCatalogPick(null); await reload(); }}
            onCancel={() => setConnecting(false)}
          />
        ) : (
        <div className="space-y-4">
          <button
            onClick={() => setConnecting(true)}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed border-accent-border bg-accent-soft/20 px-4 py-3 text-left transition-colors hover:bg-accent-soft/40"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-background"><Plus className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-text-primary">Connect an app</span>
              <span className="block text-xs text-text-muted">Name it and say what it should pull in. Prevail picks the best way to connect.</span>
            </span>
          </button>
          <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
            <Plug className="mx-auto h-7 w-7 text-text-muted opacity-50" />
            <p className="mt-3 text-sm text-text-secondary">No apps connected yet.</p>
            <p className="mt-1 text-xs text-text-muted">Connect one above to start feeding your domains real data.</p>
          </div>
        </div>
        )
      ) : (
        // Master-detail. Stacks vertically on narrow widths, side-by-side on lg+.
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* LEFT - the connectors list: search, "+ connect", grouped rows. */}
          <aside className="w-full shrink-0 lg:w-72 lg:max-w-xs">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search apps"
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
              />
            </div>
            <button
              onClick={() => { setConnecting(true); setCatalogPick(null); }}
              className="mb-3 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-accent-border bg-accent-soft/20 px-3 py-2 text-left transition-colors hover:bg-accent-soft/40"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-background"><Plus className="h-3.5 w-3.5" /></span>
              <span className="text-xs font-semibold text-text-primary">Connect an app</span>
            </button>
            {liveCount > 0 && (
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">{liveCount} of {apps.length} live</div>
            )}
            <div className="space-y-4 lg:max-h-[60vh] lg:overflow-y-auto lg:pr-1">
              {groups.length === 0 && catalogView.shown.length === 0 ? (
                <div className="px-1 text-xs text-text-muted">No apps match "{query}".</div>
              ) : (
                <>
                  {/* My list - the user's pinned apps, connected or catalog, up top. */}
                  {pinned.count > 0 && (
                    <section className="space-y-1">
                      <div className="flex items-center gap-1 px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-accent"><Star className="h-2.5 w-2.5 fill-accent" /> My list · {pinned.count}</div>
                      {pinned.connected.map((a) => (
                        <ConnectorRow
                          key={`pin-${a.id}`}
                          app={a}
                          logos={logos}
                          status={appStatus(a)}
                          active={selected === a.id && !catalogPick}
                          onSelect={() => { setSelected(a.id); setCatalogPick(null); }}
                          isFav
                          onToggleFav={() => toggleFavorite(favKeyOf(a.title || a.id))}
                        />
                      ))}
                      {pinned.catalog.map((c) => (
                        <CatalogRow
                          key={`pin-${c.iconSlug || c.name}`}
                          app={c}
                          logos={logos}
                          active={catalogPick?.name === c.name}
                          onSelect={() => { setCatalogPick(c); setConnecting(false); }}
                          isFav
                          onToggleFav={() => toggleFavorite(favKeyOf(c.name))}
                        />
                      ))}
                    </section>
                  )}
                  {groups.map((g) => (
                    <section key={g.key} className="space-y-1">
                      <div className={`px-1 font-mono text-[10px] uppercase tracking-[0.2em] ${g.tint}`}>{g.label} · {g.apps.length}</div>
                      {g.apps.map((a) => (
                        <ConnectorRow
                          key={a.id}
                          app={a}
                          logos={logos}
                          status={appStatus(a)}
                          active={selected === a.id && !catalogPick}
                          onSelect={() => { setSelected(a.id); setCatalogPick(null); }}
                          isFav={favs.has(favKeyOf(a.title || a.id)) || favs.has(favKeyOf(a.id))}
                          onToggleFav={() => toggleFavorite(favKeyOf(a.title || a.id))}
                        />
                      ))}
                    </section>
                  ))}
                  {/* The catalog, folded in: every connector not yet installed,
                      below the user's own apps so installed-and-working stays
                      visually distinct from catalog-available. */}
                  {catalogView.shown.length > 0 && (
                    <section className="space-y-1">
                      <div className="px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Available to add · {catalogView.total}</div>
                      {catalogView.shown.map((c) => (
                        <CatalogRow
                          key={c.iconSlug || c.name}
                          app={c}
                          logos={logos}
                          active={catalogPick?.name === c.name}
                          onSelect={() => { setCatalogPick(c); setConnecting(false); }}
                          isFav={favs.has(favKeyOf(c.name))}
                          onToggleFav={() => toggleFavorite(favKeyOf(c.name))}
                        />
                      ))}
                      {!catalogView.searching && catalogView.total > catalogView.shown.length && (
                        <div className="px-1 pt-0.5 text-[10px] text-text-muted/70">
                          showing {catalogView.shown.length} of {catalogView.total} - search to find more
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}
            </div>
          </aside>

          {/* RIGHT - the connect flow (in place, keeping the app's context), OR
              the selected connector's full config, OR a catalog app's detail +
              "Connect" pane when a not-yet-installed app is picked. */}
          <div className="min-w-0 flex-1">
            {connecting ? (
              <ConnectAppFlow
                vaultPath={vaultPath}
                presetName={catalogPick?.name}
                onDone={async () => { setConnecting(false); setCatalogPick(null); await reload(); }}
                onCancel={() => setConnecting(false)}
              />
            ) : catalogPick ? (
              <>
                {catalogConnectErr && (
                  <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{catalogConnectErr}</div>
                )}
                <CatalogDetail
                  key={catalogPick.iconSlug || catalogPick.name}
                  app={catalogPick}
                  logos={logos}
                  onConnect={() => connectCatalogApp(catalogPick)}
                  connecting={catalogConnecting}
                />
              </>
            ) : selectedApp ? (
              <AppDetail
                key={selectedApp.id}
                app={selectedApp}
                vaultPath={vaultPath}
                logos={logos}
                status={appStatus(selectedApp)}
                busy={busy === selectedApp.id}
                onSync={() => syncNow(selectedApp.id)}
                onSetEnabled={(v) => setEnabled(selectedApp.id, v)}
                onReload={reload}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
                <Plug className="mx-auto h-7 w-7 text-text-muted opacity-50" />
                <p className="mt-3 text-sm text-text-secondary">Select an app to view its connection.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// The Composio track: a managed gateway, completely separate from Direct. First a
// config step (paste + verify the Composio consumer key), then connect any of
// Composio's apps - which opens a Composio auth link in the browser. Connections
// live in Composio; Prevail's agent uses them through the Composio MCP endpoint.
function ComposioMode() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "verify" | "connect">(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [appName, setAppName] = useState("");
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { const s = await invoke<{ configured: boolean }>("composio_status"); setConfigured(!!s.configured); }
    catch { setConfigured(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const save = async () => {
    setBusy("save"); setVerifyMsg(null);
    try { await invoke("composio_set_key", { key: keyInput.trim() }); setKeyInput(""); setEditingKey(false); await refresh(); void verify(); }
    catch (e) { setVerifyMsg(String(e)); }
    finally { setBusy(null); }
  };
  const verify = async () => {
    setBusy("verify"); setVerified(null); setVerifyMsg("Checking the connection to Composio…");
    try { const r = await invoke<{ ok: boolean; error?: string }>("composio_verify"); setVerified(!!r.ok); setVerifyMsg(r.ok ? "Connected to Composio." : `Not connected: ${r.error ?? "unknown"}`); }
    catch (e) { setVerified(false); setVerifyMsg(String(e)); }
    finally { setBusy(null); }
  };
  const connectApp = async (slug: string) => {
    const name = slug.trim();
    if (!name) return;
    setBusy("connect"); setConnectMsg(`Starting ${name}…`);
    try {
      const r = await invoke<{ ok: boolean; authUrl?: string }>("composio_connect_app", { toolkit: name });
      if (r.authUrl) { await openUrl(r.authUrl); setConnectMsg(`Opening ${name} sign-in in your browser. Authorize it there - then it is connected in Composio.`); }
      else setConnectMsg(r.ok ? `Requested ${name}. Open the Composio dashboard to finish.` : `Couldn't start ${name}.`);
    } catch (e) { setConnectMsg(String(e)); }
    finally { setBusy(null); }
  };
  const POPULAR = ["gmail", "googlecalendar", "googledrive", "notion", "slack", "github", "linear", "hubspot", "airtable", "calendly"];
  const showForm = configured === false || editingKey;
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-start gap-4 border-b border-border-subtle px-5 py-5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#6d5efc] to-[#3b2fb8] text-white"><Boxes className="h-7 w-7" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-lg font-semibold text-text-primary">Composio</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted"><Globe className="h-2.5 w-2.5" /> Managed gateway</span>
              {configured && verified === true && <span className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent"><Check className="h-2.5 w-2.5" /> Connected</span>}
            </div>
            <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-text-secondary">
              One connection fronts 1000+ apps (Gmail, Notion, Slack, GitHub and more). Set up your Composio key once, then connect any app through Composio. Best for mainstream SaaS; keep sensitive or financial accounts on a per-app Direct sign-in.
            </p>
          </div>
        </div>

        {configured === null ? (
          <div className="px-5 py-5 text-sm text-text-muted">loading…</div>
        ) : showForm ? (
          <div className="space-y-3 px-5 py-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Set up Composio</div>
            <p className="text-[12px] text-text-secondary">Paste your Composio consumer key (the X-CONSUMER-API-KEY from <button onClick={() => void openUrl("https://connect.composio.dev")} className="text-accent hover:underline">connect.composio.dev</button>). It is stored in your Mac's Keychain, never in the vault.</p>
            <div className="flex items-center gap-2">
              <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} type="password" placeholder="ck_…"
                className="w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-border" />
              <button onClick={save} disabled={busy !== null || !keyInput.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
              </button>
              {editingKey && <button onClick={() => { setEditingKey(false); setKeyInput(""); }} className="rounded-md border border-border px-3 py-2 text-sm text-text-secondary hover:border-accent-border">Cancel</button>}
            </div>
            {verifyMsg && <p className="text-[12px] text-text-secondary">{verifyMsg}</p>}
          </div>
        ) : (
          <div className="space-y-4 px-5 py-5">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
              <span className="font-semibold text-text-primary">Key saved.</span>
              <button onClick={verify} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">{busy === "verify" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Verify</button>
              <button onClick={() => { setEditingKey(true); }} className="text-xs text-text-muted hover:text-accent hover:underline">Change key</button>
              {verifyMsg && <span className={verified === false ? "text-danger" : "text-text-muted"}>{verifyMsg}</span>}
            </div>

            <div>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Connect an app through Composio</div>
              <div className="flex items-center gap-2">
                <input value={appName} onChange={(e) => setAppName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void connectApp(appName); }} placeholder="App name (e.g. gmail, notion, slack)"
                  className="w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-border" />
                <button onClick={() => void connectApp(appName)} disabled={busy !== null || !appName.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                  {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Connect
                </button>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {POPULAR.map((p) => (
                  <button key={p} onClick={() => { setAppName(p); void connectApp(p); }} disabled={busy !== null}
                    className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">{p}</button>
                ))}
              </div>
              {connectMsg && <p className="mt-2 text-[12px] text-text-secondary">{connectMsg}</p>}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border-subtle pt-3">
              <button onClick={() => void openUrl("https://dashboard.composio.dev")} className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">Manage in Composio dashboard <ExternalLink className="h-3 w-3" /></button>
              <button onClick={() => void openUrl("https://docs.composio.dev")} className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">docs.composio.dev <ExternalLink className="h-3 w-3" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// One row in the left connectors list: brand logo, name, method, and a small
// status dot. Selecting it opens the detail pane on the right.
function PinButton({ isFav, onToggle }: { isFav: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={isFav ? "Unpin from your list" : "Pin to your list"}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:text-accent ${isFav ? "text-accent" : "text-text-muted opacity-0 group-hover:opacity-100"}`}
    >
      <Star className={`h-3.5 w-3.5 ${isFav ? "fill-accent" : ""}`} />
    </button>
  );
}

function ConnectorRow({ app, logos, status, active, onSelect, isFav, onToggleFav }: {
  app: EngineApp;
  logos: Record<string, BrandLogo>;
  status: AppStatus;
  active: boolean;
  onSelect: () => void;
  isFav: boolean;
  onToggleFav: () => void;
}) {
  const meta = STATUS_META[status];
  return (
    <div className={`group flex items-center gap-1 rounded-lg border pr-1 transition-colors ${active ? "border-accent-border bg-accent-soft/30" : "border-transparent hover:bg-surface-warm"}`}>
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left">
        <AppRowLogo app={app} logos={logos} size={28} fallback="letter" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text-primary">{app.title || app.id}</span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">{methodLabel(app.integration)}</span>
        </span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot} ${status === "connecting" ? "animate-pulse" : ""}`} title={meta.label} />
      </button>
      <PinButton isFav={isFav} onToggle={onToggleFav} />
    </div>
  );
}

// Map a catalog app to the minimal shape AppRowLogo needs (it keys off title/id
// against the logos map). Catalog apps may not be in the logos map - then it
// falls back to a letter mark, which is the requested behavior.
function catalogLogoApp(c: CatalogApp): { title?: string; id?: string } {
  return { title: c.name, id: c.iconSlug || c.name };
}

// One row in the "Available to add" catalog section: brand logo (or letter
// fallback), name, and the connector's domain/note as a subtitle. Selecting it
// opens the catalog detail pane on the right with a Connect CTA.
function CatalogRow({ app, logos, active, onSelect, isFav, onToggleFav }: {
  app: CatalogApp;
  logos: Record<string, BrandLogo>;
  active: boolean;
  onSelect: () => void;
  isFav: boolean;
  onToggleFav: () => void;
}) {
  const sub = app.domain || (app.tags && app.tags[0]) || "catalog";
  return (
    <div className={`group flex items-center gap-1 rounded-lg border pr-1 transition-colors ${active ? "border-accent-border bg-accent-soft/30" : "border-transparent hover:bg-surface-warm"}`}>
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left">
        <AppRowLogo app={catalogLogoApp(app)} logos={logos} size={28} fallback="letter" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text-primary">{app.name}</span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">{titleCase(sub)}</span>
        </span>
      </button>
      <PinButton isFav={isFav} onToggle={onToggleFav} />
    </div>
  );
}

// The right pane for a CATALOG (not-yet-installed) app: logo, name, any note the
// catalog exposes, and a clear "Connect" CTA that opens the existing connect
// flow. ConnectAppFlow doesn't accept a typed-name prop, so we name the app here
// and the user confirms it in the flow's first field.
// Map a catalog connection hint to the manifest integration vocabulary so a new
// app is scaffolded with the right method straight away (its AppDetail then drives
// the real per-method auth). Unknown -> manual, which AppDetail can re-evaluate.
function hintToIntegration(method?: string): string {
  switch ((method || "").toLowerCase()) {
    case "mcp": return "mcp";
    case "api": return "api";
    case "oauth": return "oauth";
    case "browser": return "browser";
    case "composio": return "mcp";
    case "cli": return "manual";
    default: return "manual";
  }
}

function catalogMethodLabel(m?: string): string {
  switch ((m || "").toLowerCase()) {
    case "mcp": return "MCP server";
    case "api": return "Official API";
    case "oauth": return "Sign-in (OAuth)";
    case "browser": return "Browser sign-in";
    case "composio": return "Composio (managed)";
    case "cli": return "Local CLI";
    default: return "Auto (best available)";
  }
}

function CatalogDetail({ app, logos, onConnect, connecting }: {
  app: CatalogApp;
  logos: Record<string, BrandLogo>;
  onConnect: () => void;
  connecting: boolean;
}) {
  const note = (app.note || "").trim();
  const hint = app.connection_hint;
  const method = hint?.method || app.via || "";
  const sources = (app.sources ?? []).filter((s) => /^https?:\/\//.test(s));
  const desc = note || `Connect ${app.name} to start feeding your domains real data. Prevail picks the best way to connect (MCP, an official API, a one-time sign-in, or a guided browser login), saves the connection, then keeps it in sync.`;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {/* Rich header: brand mark, name + trust + method, and the primary actions
          (Connect) alongside Try in chat and a share link - matching the depth of
          a first-class connector page. */}
      <div className="flex flex-wrap items-start gap-4 border-b border-border-subtle px-5 py-5">
        <AppRowLogo app={catalogLogoApp(app)} logos={logos} size={56} fallback="letter" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-lg font-semibold text-text-primary">{app.name}</span>
            {app.verified && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent" title="Verified connector">
                <ShieldCheck className="h-2.5 w-2.5" /> Verified
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
              <Globe className="h-2.5 w-2.5" /> Available to add
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-muted">
            {app.domain && <span>{titleCase(app.domain)}</span>}
            {app.tags?.length ? <span>· {app.tags.slice(0, 4).map(titleCase).join(", ")}</span> : null}
            <span>· connects via {catalogMethodLabel(method)}</span>
          </div>
          <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-text-secondary">{desc}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sources[0] && (
            <button
              onClick={() => void openUrl(sources[0])}
              title="Open the connector's website"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:border-accent-border hover:text-accent"
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onConnect}
            disabled={connecting}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-60"
          >
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {connecting ? "Adding…" : "Connect"}
          </button>
        </div>
      </div>

      {/* How Prevail connects - sets expectations before the click, and shows the
          privacy posture (local vs vendor cloud) so the choice is informed. */}
      <div className="border-b border-border-subtle px-5 py-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">How Prevail connects</div>
        <div className="flex items-start gap-2 rounded-lg border border-accent-border/40 bg-accent-soft/20 px-3 py-2.5 text-[12px] leading-relaxed text-text-secondary">
          <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span>
            When you Connect, Prevail confirms the best method ({catalogMethodLabel(method)}), drives the
            sign-in for you if one is needed, verifies it pulled real data, then keeps it in sync.
            {hint?.privacy === "local" && " Your data stays local to this Mac."}
            {hint?.privacy === "vendor-cloud" && " This connects through the vendor's cloud."}
            {hint?.readOnly && " Read-only access."}
          </span>
        </div>
      </div>

      {/* Details - label/value pairs like a connector spec sheet. */}
      <div className="px-5 py-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Details</div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          <CatalogField label="Category">{app.domain ? titleCase(app.domain) : "-"}</CatalogField>
          <CatalogField label="Connection">{catalogMethodLabel(method)}</CatalogField>
          {app.tags?.length ? <CatalogField label="Tags">{app.tags.map(titleCase).join(", ")}</CatalogField> : null}
          {hint?.server && <CatalogField label="Server">{hint.server}</CatalogField>}
          {hint?.privacy && <CatalogField label="Privacy">{hint.privacy === "local" ? "Local to this Mac" : "Vendor cloud"}</CatalogField>}
          {typeof app.tier === "number" && <CatalogField label="Tier">{`Tier ${app.tier}`}</CatalogField>}
        </dl>
        {sources.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">More info</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {sources.slice(0, 4).map((s, i) => (
                <button key={i} onClick={() => void openUrl(s)} className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
                  {prettyHost(s)} <ExternalLink className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CatalogField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-text-secondary">{children}</dd>
    </div>
  );
}

function prettyHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}


// The selected connector's full configuration, shown in the right pane of the
// master-detail layout. This is the EXACT body that used to live inside the
// collapsible AppCard - every flow (creds, MCP setup, OAuth/browser sign-in,
// schedule, domains, config path, runs, enabled toggle, delete) is preserved,
// just always-shown for the selected app instead of behind a chevron.
function AppDetail({ app, vaultPath, logos, status, busy, onSync, onSetEnabled, onReload }: {
  app: EngineApp;
  vaultPath: string;
  logos: Record<string, BrandLogo>;
  status: AppStatus;
  busy: boolean;
  onSync: () => void;
  onSetEnabled: (v: boolean) => void;
  onReload: () => Promise<void> | void;
}) {
  const meta = STATUS_META[status];
  const enabled = app.enabled !== false;
  const runs = app.runs ?? [];
  // Apps redesign: the actual data files this connector has loaded (so the user
  // can SEE what was pulled, and reveal it). Loaded for the selected app, and
  // reloaded after a successful sync (lastSuccessTs change).
  const [dataFiles, setDataFiles] = useState<{ path: string; name: string; bytes: number; mtime: number }[]>([]);
  useEffect(() => {
    let alive = true;
    invoke<{ path: string; name: string; bytes: number; mtime: number }[]>("app_data_files", { vault: vaultPath, appId: app.id })
      .then((f) => { if (alive) setDataFiles(Array.isArray(f) ? f : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [app.id, vaultPath, app.lastSuccessTs]);
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
  // Apps redesign P1: generic credential entry, driven by the manifest's
  // auth_env_vars (credFieldsFor) instead of a PayPal hardcode. The user's only
  // step is pasting what a key-based connector needs; on save we store each value
  // in the Keychain (app_secret_set) and immediately run a real sync - the card
  // only turns green if that fetch actually succeeds. OAuth apps use the "Sign in"
  // button; MCP apps use the guided-setup card (which renders these same fields).
  // The OAuth sign-in path is only valid when the app's connection method is
  // EXACTLY "oauth". A looser .includes() check wrongly lit the Sign-in button
  // for apps that merely mention oauth (the Airbnb bug) but have no oauth block
  // in their manifest, so clicking failed with "connector has no oauth block".
  // "api"/"browser"/"manual"/"mcp" apps must never see this button.
  const integ = (app.integration || "").toLowerCase();
  const isOAuth = integ === "oauth";
  const isMcp = integ === "mcp";
  // Browser-method connectors authorize by opening a REAL browser the user logs
  // into (the browser equivalent of OAuth's "Sign in"). engine_app_browser_login
  // is a long-running Tauri command that opens the browser; when it returns we run
  // the same verify sync the other auth flows do.
  const isBrowser = integ === "browser" || integ === "playwright";
  const credSpec = credFieldsFor(app);
  // Fully delete a connector (mirror of "Connect") so the user can remove a
  // duplicate / mistaken app and recreate it. Two-step confirm; the engine
  // refuses to delete bundled connectors.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const removeApp = async () => {
    setDeleting(true); setDeleteErr(null);
    try {
      const r = await invoke<{ ok: boolean; error?: string }>("engine_app_remove", { id: app.id });
      if (r.ok) { window.dispatchEvent(new CustomEvent("prevail:apps-changed")); await onReload(); }
      else setDeleteErr(r.error || "could not delete this app");
    } catch (e) { setDeleteErr(String(e).slice(0, 200)); }
    finally { setDeleting(false); }
  };
  const needsCreds = (!!credSpec || isOAuth || isBrowser) && !isMcp;
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
      setCredMsg("Verified - pulled real data. (The card turns green once a sync succeeds.)");
    } catch (e) { setCredMsg(`Failed: ${String(e).slice(0, 200)}`); }
    finally { setCredBusy(false); }
  };
  const signIn = async () => {
    setCredBusy(true); setCredMsg("Opening sign-in… complete it in your browser.");
    try {
      await invoke("engine_app_oauth", { id: app.id, vault: vaultPath });
      await verifySync();
      setCredMsg("Signed in - verified by a real fetch.");
    } catch (e) {
      const msg = String(e);
      // Some apps are tagged "oauth" but ship no oauth block in their manifest,
      // so the sign-in invoke fails. Don't leave a dead button: tell the user
      // this app doesn't actually do OAuth and point them at changing the
      // method (the Method picker above) to one it supports.
      if (/no oauth block/i.test(msg)) {
        setCredMsg("This app isn't set up for OAuth sign-in (no OAuth configured). Use the Method picker above to switch it to API, Browser, or another method it supports.");
      } else {
        setCredMsg(`Sign-in failed: ${msg.slice(0, 200)}`);
      }
    }
    finally { setCredBusy(false); }
  };
  // Browser-method log in: opens a real browser window the user signs into, then
  // closes. This is a long-running call - while it runs we show a clear "opening
  // browser, log in then close it" busy state. On return we verify by a real fetch
  // just like the OAuth and credential flows.
  const browserLogin = async () => {
    setCredBusy(true); setCredMsg("Opening a browser… log in there, then close the window. Prevail verifies by a real fetch.");
    try {
      await invoke("engine_app_browser_login", { id: app.id });
      await verifySync();
      setCredMsg("Logged in - verified by a real fetch.");
    } catch (e) { setCredMsg(`Browser login failed: ${String(e).slice(0, 200)}`); }
    finally { setCredBusy(false); }
  };
  // MCP guided setup (integration === "mcp"): show the server's install/run
  // command, collect whatever env the server needs into the Keychain, then
  // verify by a REAL tool call - engine_app_sync spawns the local MCP server and
  // calls one tool; the fetch gate only turns the card green if it returns data.
  const [mcpCopied, setMcpCopied] = useState(false);
  const mcpCmd = (app.mcpSetup?.install || app.mcpSetup?.command || "").trim();
  const copyMcp = async () => {
    if (!mcpCmd) return;
    try { await navigator.clipboard.writeText(mcpCmd); setMcpCopied(true); window.setTimeout(() => setMcpCopied(false), 1500); }
    catch { /* clipboard blocked - the command is still visible to copy by hand */ }
  };
  const setupMcp = async () => {
    setCredBusy(true); setCredMsg("Saving keys + verifying the MCP server by a real tool call…");
    try {
      for (const f of credSpec ?? []) {
        if (f.kind === "toggle") {
          await invoke("app_secret_set", { name: f.env, value: credVals[f.env] === "on" ? (f.on ?? "on") : (f.off ?? "off") });
        } else if ((credVals[f.env] ?? "").trim()) {
          await invoke("app_secret_set", { name: f.env, value: credVals[f.env].trim() });
        }
      }
      await verifySync();
      setCredVals((v) => { const n = { ...v }; for (const f of credSpec ?? []) if (f.kind === "secret") delete n[f.env]; return n; });
      setCredMsg("Verified. The MCP server returned data. (Green once the sync succeeds.)");
    } catch (e) { setCredMsg(`Couldn't verify: ${String(e).slice(0, 200)}`); }
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
  // A short description if the manifest exposes one (the first connection's
  // description). We never invent copy - if there's nothing, the line is omitted.
  const description = (app.connections ?? []).map((c) => c.description).find((d) => !!d && d.trim()) ?? null;
  return (
    <div className={`overflow-hidden rounded-xl border bg-surface ${meta.ring}`}>
      {/* Enriched detail header: big brand mark, name, status pill, method,
          optional description, and the "Open in chat" + Sync CTAs. */}
      <div className="flex flex-wrap items-start gap-4 border-b border-border-subtle px-5 py-4">
        <AppRowLogo app={app} logos={logos} size={52} fallback="letter" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-semibold text-text-primary">{app.title || app.id}</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${meta.ring} ${meta.tint}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${status === "connecting" ? "animate-pulse" : ""}`} />
              {meta.label}
            </span>
            <span className="rounded border border-border-subtle px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted">{methodLabel(app.integration)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-muted">
            {status === "connected" && <span>synced {app.lastSuccessTs ? relTime(app.lastSuccessTs) : "-"}</span>}
            {status === "attention" && <span className="text-danger">{app.lastError ? app.lastError.slice(0, 60) : "needs re-auth"}</span>}
            {status === "disconnected" && <span>not set up</span>}
            {status === "connected" && <span>· {scheduleLabel(app.refresh)}</span>}
            {status === "connected" && app.nextDueTs ? <span>· next {relTime(app.nextDueTs)}</span> : null}
            {(app.domains ?? []).length > 0 && <span>· feeds {app.domains.map(titleCase).join(", ")}</span>}
          </div>
          {description && <p className="mt-1.5 max-w-prose text-[12px] text-text-secondary">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status !== "disconnected" && (
            <button
              onClick={onSync}
              disabled={busy}
              title="Sync this app now"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} {busy ? "syncing" : "sync"}
            </button>
          )}
          {/* Open the app's own workspace (chat with its data) - the same view the
              sidebar + per-domain facet open (prevail:open-app dispatch). */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-app", { detail: app }))}
            title={`Open ${app.title || app.id} in chat`}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover"
          >
            <ArrowUpRight className="h-3.5 w-3.5" /> Open in chat
          </button>
        </div>
      </div>
      <div className="space-y-3 px-5 py-4 text-[13px]">
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
            <Detail label={isOAuth ? "Sign in" : isBrowser ? "Log in" : "Credentials"}>
              <div className="flex flex-col gap-1.5">
                {isOAuth ? (
                  <>
                    <button onClick={signIn} disabled={credBusy}
                      className="inline-flex w-fit items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                      {credBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{credBusy ? "Signing in…" : `Sign in to ${app.title || app.id}`}
                    </button>
                    <span className="text-[10px] text-text-muted/70">Opens your browser to authorize, then verifies by a real fetch. Token stored locally; used read-only.</span>
                  </>
                ) : isBrowser ? (
                  <>
                    {/* Browser-method equivalent of OAuth sign-in: open a real
                        browser, log in, close it, then verify by a real fetch. */}
                    <button onClick={browserLogin} disabled={credBusy}
                      className="inline-flex w-fit items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                      {credBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{credBusy ? "Opening browser…" : `Log in to ${app.title || app.id}`}
                    </button>
                    <span className="text-[10px] text-text-muted/70">{credBusy ? "Opening a browser - log in there, then close the window." : "Opens a real browser. Log in, then close it; Prevail verifies by a real fetch. Session stored locally; used read-only."}</span>
                    {/* Some browser apps ALSO take saved credentials (cookies/keys). */}
                    {credSpec?.map((f) => f.kind === "toggle" ? (
                      <label key={f.env} className="flex items-center gap-2 text-[11px] text-text-secondary">
                        <input type="checkbox" checked={credVals[f.env] === "on"} onChange={(e) => setCredVals((v) => ({ ...v, [f.env]: e.target.checked ? "on" : "off" }))} className="h-3 w-3 accent-[var(--color-accent)]" />
                        {f.label}
                      </label>
                    ) : (
                      <input key={f.env} type="password" value={credVals[f.env] ?? ""} onChange={(e) => setCredVals((v) => ({ ...v, [f.env]: e.target.value }))} placeholder={f.label} autoComplete="off"
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none" />
                    ))}
                    {credSpec && credSpec.length > 0 && (
                      <button onClick={saveCreds} disabled={credBusy || !credSpec.some((f) => f.kind === "secret" && (credVals[f.env] ?? "").trim())}
                        className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs font-semibold text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
                        {credBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{credBusy ? "Verifying…" : "Save & verify"}
                      </button>
                    )}
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
          {/* MCP guided setup: 1) stand up the local server, 2) paste any keys it
              needs (Keychain), 3) verify by a real tool call. The card only goes
              green when the server returns data (the engine's fetch gate). */}
          {isMcp && (
            <Detail label="MCP setup">
              <div className="flex flex-col gap-2.5">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-accent">1 · Run the MCP server</div>
                  {mcpCmd ? (
                    <div className="mt-1 flex items-stretch gap-1.5">
                      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary">{mcpCmd}</code>
                      <button onClick={copyMcp} title="Copy command"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
                        {mcpCopied ? <Check className="h-3 w-3 text-ok" /> : <Plug className="h-3 w-3" />} {mcpCopied ? "copied" : "copy"}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-text-muted">Prevail spawns this connector's MCP server locally on demand. No install command needed.</p>
                  )}
                  <p className="mt-1 text-[10px] text-text-muted/70">Runs locally over stdio. Many servers (npx-based) install themselves on first run.</p>
                </div>
                {credSpec && credSpec.length > 0 && (
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-accent">2 · Keys the server needs</div>
                    <div className="mt-1 flex flex-col gap-1.5">
                      {credSpec.map((f) => f.kind === "toggle" ? (
                        <label key={f.env} className="flex items-center gap-2 text-[11px] text-text-secondary">
                          <input type="checkbox" checked={credVals[f.env] === "on"} onChange={(e) => setCredVals((v) => ({ ...v, [f.env]: e.target.checked ? "on" : "off" }))} className="h-3 w-3 accent-[var(--color-accent)]" />
                          {f.label}
                        </label>
                      ) : (
                        <input key={f.env} type="password" value={credVals[f.env] ?? ""} onChange={(e) => setCredVals((v) => ({ ...v, [f.env]: e.target.value }))} placeholder={f.label} autoComplete="off"
                          className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none" />
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-accent">{credSpec && credSpec.length > 0 ? "3" : "2"} · Verify</div>
                  <button onClick={setupMcp} disabled={credBusy}
                    className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                    {credBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}{credBusy ? "Verifying…" : "Verify connection"}
                  </button>
                  <p className="mt-1 text-[10px] text-text-muted/70">Spawns the server and calls one tool. The card turns green only if it returns real data.</p>
                </div>
                {credMsg && <span className="text-[11px] text-text-muted">{credMsg}</span>}
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
          {/* Information - at-a-glance facts the app exposes: config folder (with
              reveal), domains fed, and the schedule summary. We only show fields
              the app actually has (no invented homepage/website data). */}
          <div className="rounded-lg border border-border-subtle bg-surface-warm/40 px-3 py-2.5">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Information</div>
            <div className="space-y-1.5 text-[12px] text-text-secondary">
              {app.path && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Config</span>
                  <code className="break-all font-mono text-[11px] text-text-secondary">{app.path}</code>
                  <button onClick={() => void invoke("open_in_finder", { path: app.path! }).catch(() => {})}
                    title="Open this app's config folder (manifest + MCP/connector config)"
                    className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
                    <FolderOpen className="h-2.5 w-2.5" /> reveal
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Domains</span>
                <span>{(app.domains ?? []).length ? app.domains.map(titleCase).join(", ") : "none yet"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Schedule</span>
                <span>{scheduleLabel(app.refresh)}{app.nextDueTs ? ` · next ${relTime(app.nextDueTs)}` : ""}</span>
              </div>
              {app.community && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Source</span>
                  <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> Community connector</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-border-subtle pt-2.5">
            <span className="flex items-center gap-2 text-xs text-text-secondary">
              <Toggle on={enabled} onChange={onSetEnabled} label={`${app.title} scheduled sync`} />
              {enabled ? "Scheduled sync on" : "Scheduled sync off"}
            </span>
            {status === "connected" && <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ok"><Check className="h-3 w-3" /> working</span>}
          </div>
          {/* Delete - remove this connector entirely (so a duplicate can be
              recreated). Confirm inline; the engine refuses bundled connectors. */}
          <div className="flex items-center gap-2 pt-1">
            {confirmDelete ? (
              <>
                <button onClick={removeApp} disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded-md border border-danger/50 bg-danger/10 px-2.5 py-1 text-[11px] text-danger hover:bg-danger/20 disabled:opacity-50">
                  {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete {app.title} for good
                </button>
                <button onClick={() => { setConfirmDelete(false); setDeleteErr(null); }} className="text-[11px] text-text-muted hover:text-text-secondary">cancel</button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-danger hover:text-danger">
                <Trash2 className="h-3 w-3" /> Delete app
              </button>
            )}
            {deleteErr && <span className="text-[11px] text-danger">{deleteErr}</span>}
          </div>
      </div>
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
