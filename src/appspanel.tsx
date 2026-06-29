// Apps - the data-inflow surface. An app is "working" only if it's reliably
// refreshing the vault on a schedule, so this page's whole job is to make that
// UNMISTAKABLE: every app shows one color-coded status, the method it connects
// by, when it last synced and when it syncs next, and which domains it feeds.
// Connecting a new app is a single goal sentence (the Connection Agent figures
// out the method) - not a wall of forms. See docs/APPS-REDESIGN.md.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Boxes, Check, ChevronLeft, ChevronRight, Clock, Download, ExternalLink, FolderOpen, Globe, HelpCircle, Link2, Loader2, MessageSquare, Pencil, Play, Plug, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Star, Tag, Terminal, Trash2, X } from "lucide-react";
import { MasterDetail } from "./masterdetail";
import { ConnectorRunPanel, type ConnectorRunMode } from "./connectorrun";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "./bridge";
import { appName, relTime, titleCase } from "./format";
import { PREF, getPref, lsGet, lsSet } from "./storage";
import { Toggle } from "./ui";
import { ConnectAppFlow } from "./appconnect";
import { AppRowLogo } from "./panels3";
import { GoogleWorkspacePanel } from "./googlepanel";
import { favKeyOf, toggleFavorite, useFavorites } from "./appfavorites";
import type { BrandLogo, CatalogApp, ConnectorCatalog, EngineApp } from "./types";

type AppStatus = "connected" | "authorized" | "attention" | "connecting" | "disconnected";

// The engine's sync verdict (connectors sync --json). ok=false carries the real
// reason so the UI can show an honest failure instead of a fake "Synced".
type SyncResult = { ok: boolean; error?: string; artifacts?: number };

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
// Kept (exported) for the upcoming non-browser "Connection" card; the inline
// credentials UI was removed in the AppDetail redesign.
export function credFieldsFor(app: EngineApp): CredField[] | undefined {
  if (CREDS_FIELDS[app.id]) return CREDS_FIELDS[app.id];
  const generic = genericCredFields(app);
  return generic.length ? generic : undefined;
}

// The three connection LANES the user thinks in: an official CLI, a data
// aggregator (Plaid), or a direct app connection (api / oauth / agentic browser).
// Works for both catalog entries (pattern/via) and installed apps (integration).
export type AppLane = "cli" | "aggregator" | "direct";
function laneOf(a: { pattern?: string; via?: string; integration?: string; gateway?: unknown | null }): AppLane {
  if ((a.via || "").toLowerCase() === "plaid" || (a as { gateway?: unknown }).gateway) return "aggregator";
  const p = (a.pattern || a.integration || "").toLowerCase();
  if (p.includes("cli")) return "cli";
  return "direct"; // api / oauth / browser
}
export const LANE_FILTERS: { key: "all" | AppLane; label: string }[] = [
  { key: "all", label: "All" },
  { key: "cli", label: "CLI" },
  { key: "aggregator", label: "Aggregators" },
  { key: "direct", label: "Direct" },
];

// Google's many surfaces (Gmail, Calendar, Drive, YouTube, …) are all covered by
// the single `gws`/`gam` CLI, so the catalog collapses them into one "Google"
// entry. This is true for any Google-owned sub-service EXCEPT the unified entry.
function isGoogleSubservice(a: { name?: string | null; iconSlug?: string | null; id?: string }): boolean {
  const name = (a.name || a.id || "").trim();
  if (!name || name.toLowerCase() === "google") return false; // keep the unified entry
  const slug = (a.iconSlug || a.id || "").toLowerCase();
  if (/^google/.test(slug) || /^youtube/.test(slug)) return true;
  if (/^google[\s-]/i.test(name)) return true;
  if (/^(gmail|youtube)\b/i.test(name)) return true;
  return false;
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

// Known real homepages for common connectors, keyed by a normalized name/id/
// connection-kind. Used by the "Visit <App>" link so it opens the actual product
// site instead of a guessed-and-often-wrong domain. Anything not listed falls
// back to https://www.<alnum of title or id>.com.
const APP_DOMAINS: Record<string, string> = {
  notion: "notion.so",
  slack: "slack.com",
  github: "github.com",
  gmail: "mail.google.com",
  googlecalendar: "calendar.google.com",
  googledrive: "drive.google.com",
  linear: "linear.app",
  hubspot: "hubspot.com",
  airtable: "airtable.com",
  stripe: "stripe.com",
  clickup: "clickup.com",
  paypal: "paypal.com",
  airbnb: "airbnb.com",
  dropbox: "dropbox.com",
  figma: "figma.com",
  asana: "asana.com",
  trello: "trello.com",
  calendly: "calendly.com",
};

// The app's real website URL. Tries the known-domains map keyed by a normalized
// name/id/connection-kind; otherwise builds a best-effort www.<name>.com.
function appWebsite(app: EngineApp): string {
  const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const keys = [app.id, app.title, ...((app.connections ?? []).map((c) => c.kind))].map(norm).filter(Boolean);
  for (const k of keys) {
    if (APP_DOMAINS[k]) return `https://${APP_DOMAINS[k]}`;
  }
  const slug = norm(app.title) || norm(app.id) || "app";
  return `https://www.${slug}.com`;
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

// Favorites ("my list") are shared with the home sidebar via ./appfavorites -
// starring an app (Direct, Composio, or Nango) is what pins it to the home
// screen. The store + hooks live in that module so both surfaces read one set.


export function AppsPanel({ vaultPath }: { vaultPath: string }) {
  const [apps, setApps] = useState<EngineApp[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Master-detail: which connector is open in the right pane. `null` while apps
  // are still loading or none exist; otherwise the selected app id.
  const [selected, setSelected] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Connection track. Prevail connects each app ITSELF (direct: CLI / API /
  // agentic browser) — the local, no-SaaS-lock-in path. The managed-gateway
  // tracks (Composio / Nango) are retired from the UI; we always run direct.
  // appsMode is kept (the gateway render branches reference it) but is constant.
  const [appsMode] = useState<"direct" | "composio" | "nango">("direct");
  const [gatewayOpen] = useState(false);
  // The app list attaches to the detail as one panel and collapses to a thin
  // rail (expand chevron) so the detail can take the full width, like the home
  // sidebar / thread list. Persisted.
  const [listCollapsed, setListCollapsed] = useState(() => { try { return localStorage.getItem("prevail.apps.listCollapsed") === "1"; } catch { return false; } });
  const toggleList = useCallback(() => setListCollapsed((v) => { const n = !v; try { localStorage.setItem("prevail.apps.listCollapsed", n ? "1" : "0"); } catch { /* ignore */ } return n; }), []);
  // The Composio managed-gateway pane (one OAuth fronts 1000+ apps for the agent).
  const [query, setQuery] = useState("");
  // Lane filter: All / CLI / Aggregators (Plaid) / Direct.
  const [lane, setLane] = useState<"all" | AppLane>("all");
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
      // Default selection: keep the current one if it still exists, else the
      // first DIRECT app (the shared `selected` drives the Direct pane; gateway
      // apps have their own mode + selection, so they must not become the default).
      setSelected((cur) => (cur && next.some((a) => a.id === cur) ? cur : (next.find((a) => !a.gateway)?.id ?? next[0]?.id ?? null)));
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

  const syncNow = useCallback(async (id: string): Promise<SyncResult> => {
    setBusy(id);
    try {
      const r = await invoke<SyncResult>("engine_app_sync", { id, vault: vaultPath });
      await reload();
      return r ?? { ok: true };
    } catch (e) { console.error("sync app", e); return { ok: false, error: String(e).slice(0, 200) }; }
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
        await invoke("engine_app_add", { vault: vaultPath, id, title: c.name, integration, domains });
      } catch (e) {
        // Already installed: just open it. Anything else is a real failure.
        if (!/already exists/i.test(String(e))) throw e;
      }
      // Wire the catalog-shipped soul into the new app's soul.md at add-time.
      if (c.soul) { try { await invoke("engine_app_set_soul", { id, soul: c.soul }); } catch { /* soul is best-effort */ } }
      await reload();
      setCatalogPick(null); setConnecting(false);
      setSelected(id);
    } catch (e) {
      setCatalogConnectErr(`Couldn't add ${c.name}: ${String(e).slice(0, 160)}`);
    } finally {
      setCatalogConnecting(false);
    }
  }, [reload, vaultPath]);

  // Direct mode shows ONLY directly-connected apps. Gateway apps (Composio /
  // Nango) live in their own modes and must never leak into the Direct list -
  // so everything the Direct branch renders (list, "my list", counts, detail)
  // is derived from this gateway-free slice, not the raw `apps`.
  // Google is NOT special here: until it's scaffolded to disk it lives in the
  // catalog ("Available to add") like every other connector - it's the single
  // unified `gws` entry (see catalog.json). Selecting it opens the multi-profile
  // panel, and scaffolding (on favorite or "Connect for the agent") turns it
  // into a real vault app that then shows in this list like any installed app.
  const directApps = useMemo(() => (apps ?? []).filter((a) => !a.gateway), [apps]);
  // Filter by the search box (name or method), then group into Connected vs
  // Setup (authorizing / connecting / needs attention) vs Not connected so the
  // left list reads top-to-bottom like Claude Desktop / ChatGPT connectors.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (a: EngineApp) =>
      !q || (a.title || a.id).toLowerCase().includes(q) || methodLabel(a.integration).toLowerCase().includes(q);
    const filtered = directApps.filter((a) => {
      if (!match(a)) return false;
      if (lane !== "all" && laneOf(a) !== lane) return false;
      // Collapse Google sub-services into the unified Google — but never hide one
      // the user has actually connected.
      if (appStatus(a) !== "connected" && isGoogleSubservice({ name: a.title, id: a.id })) return false;
      return true;
    });
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
  }, [directApps, query, lane]);

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
      if (lane !== "all" && laneOf(c) !== lane) return false;
      if (isGoogleSubservice(c)) return false; // collapsed into the unified "Google"
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
  }, [apps, catalog, query, lane]);

  const liveCount = directApps.filter((a) => appStatus(a) === "connected").length;

  // "My list" - the user's pinned apps, connected or catalog, surfaced at the top
  // of the sidebar for quick access. A pinned catalog app and its installed self
  // share a normalized key, so once connected it shows from the connected side.
  const favs = useFavorites();
  // Favorite an app; for Google, scaffold it to disk first so pinning it puts a
  // real app on the home screen (the sidebar lists vault apps).
  const favApp = useCallback(async (a: { id: string; title?: string | null }) => {
    const key = favKeyOf(a.title || a.id);
    if (a.id === "google" && !favs.has(key) && !favs.has(favKeyOf("google"))) {
      await invoke("google_scaffold", { vault: vaultPath }).catch(() => {});
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
    }
    toggleFavorite(key);
  }, [favs, vaultPath]);
  // Favorite a CATALOG app (one not yet installed). Pinning means "put it on the
  // home screen", and the home sidebar lists VAULT apps - so scaffold it to disk
  // first (same as Google / gateway apps), then favorite it. Without this, the
  // star only writes a localStorage key the home widget can never resolve to an
  // app, so pinned catalog apps silently never appear there.
  const favCatalogApp = useCallback(async (c: CatalogApp) => {
    const key = favKeyOf(c.name);
    if (!favs.has(key)) {
      const id = (c.iconSlug || c.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
      const integration = hintToIntegration(c.connection_hint?.method || c.via);
      const domains = c.domain ? [c.domain] : [];
      try { await invoke("engine_app_add", { vault: vaultPath, id, title: c.name, integration, domains }); }
      catch (e) { if (!/already exists/i.test(String(e))) console.error("scaffold on pin", e); }
      if (c.soul) { try { await invoke("engine_app_set_soul", { id, soul: c.soul }); } catch { /* best-effort */ } }
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
    }
    toggleFavorite(key);
  }, [favs, vaultPath]);
  const pinned = useMemo(() => {
    const connected = directApps.filter((a) => favs.has(favKeyOf(a.title || a.id)) || favs.has(favKeyOf(a.id)));
    const connectedKeys = new Set(connected.map((a) => favKeyOf(a.title || a.id)));
    const seen = new Set<string>();
    const catalogPinned = catalog.filter((c) => {
      const k = favKeyOf(c.name);
      if (!favs.has(k) || connectedKeys.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { connected, catalog: catalogPinned, count: connected.length + catalogPinned.length };
  }, [directApps, catalog, favs]);
  const selectedApp = (apps ?? []).find((a) => a.id === selected) ?? null;
  // The Direct detail pane only ever shows a Direct app. A gateway app that
  // happens to be the shared `selected` (e.g. just-scaffolded) must not render
  // here without its gateway chrome - it belongs to its own mode.
  const directSelectedApp = selectedApp && !selectedApp.gateway ? selectedApp : null;

  return (
    <>
      {/* Full-width header band: title + description on the left, a dense brand
          field filling the right ~half (right-to-left under a fade) so the space
          reads as "lots of apps". */}
      <div className="relative mb-4 overflow-hidden rounded-xl border border-border-subtle bg-surface/40">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] select-none lg:block [mask-image:linear-gradient(to_right,transparent,black_62%)]"
        >
          <div className="flex h-full flex-wrap content-center justify-end gap-2 p-4">
            {APP_LOGO_FIELD.slice(0, 15).map((s, i) => (
              <span key={`${s.id}-${i}`} className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-warm/70 ring-1 ring-border-subtle">
                <AppRowLogo app={s} logos={logos} size={24} fallback="letter" />
              </span>
            ))}
          </div>
        </div>
        <div className="relative z-10 max-w-xl px-5 py-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Plug className="h-4 w-4" /></span>
            <h2 className="font-display text-2xl font-bold tracking-tight">Apps</h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            Services that feed your vault. Connect each one once - mail, calendar, repos, docs, payments, and more - and it's available to any domain's context, no duplicates.
          </p>
        </div>
      </div>

      {/* Connect happens INSIDE the right detail pane (see below) so the app's
          context and the sidebar stay put - the connect flow never replaces the
          whole view. Only the rare zero-apps-and-zero-catalog case hosts it here. */}
      {appsMode === "composio" ? (
        <ComposioMode vaultPath={vaultPath} expanded={gatewayOpen} />
      ) : appsMode === "nango" ? (
        <NangoMode vaultPath={vaultPath} expanded={gatewayOpen} />
      ) : (
        <>
        {apps === null ? (
        <div className="text-sm text-text-muted">loading apps…</div>
      ) : directApps.length === 0 && catalog.length === 0 ? (
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
        // Master-detail in ONE attached panel: a flush list column (border-r,
        // like the home threads rail) + the detail, joined - not floating cards.
        <div className="flex min-h-[55vh] flex-col overflow-hidden rounded-xl border border-border lg:flex-row lg:items-stretch">
          {/* LEFT - flush connectors column, collapses to a logo rail. */}
          {listCollapsed ? (
            <div className="flex shrink-0 flex-col items-center gap-2 border-b border-border-subtle bg-surface-warm py-2 lg:w-14 lg:border-b-0 lg:border-r">
              <button
                onClick={toggleList}
                title="Show apps list"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-strong hover:text-accent"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1 pb-1">
                {directApps.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => { setSelected(a.id); setCatalogPick(null); }}
                    title={a.title || a.id}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${selected === a.id && !catalogPick ? "ring-2 ring-accent" : "hover:bg-surface-strong"}`}
                  >
                    <AppRowLogo app={a} logos={logos} size={26} fallback="letter" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
          <aside className="flex w-full shrink-0 flex-col border-b border-border-subtle bg-surface-warm lg:w-72 lg:max-w-xs lg:border-b-0 lg:border-r">
            <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-3 py-2.5">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Apps</span>
              <button
                onClick={toggleList}
                title="Collapse list"
                className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-strong hover:text-accent"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search apps"
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
              />
            </div>
            <div className="mb-2 flex items-center gap-1 rounded-lg border border-border-subtle bg-background p-0.5">
              {LANE_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setLane(f.key)}
                  className={`flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors ${lane === f.key ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text-secondary"}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setConnecting(true); setCatalogPick(null); }}
              className="mb-3 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-accent-border bg-accent-soft/20 px-3 py-2 text-left transition-colors hover:bg-accent-soft/40"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-background"><Plus className="h-3.5 w-3.5" /></span>
              <span className="text-xs font-semibold text-text-primary">Connect an app</span>
            </button>
            {liveCount > 0 && (
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">{liveCount} of {directApps.length} live</div>
            )}
            <div className="space-y-4">
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
                          onToggleFav={() => void favApp(a)}
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
                          onToggleFav={() => void favApp(a)}
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
                      {catalogView.shown.map((c) => {
                        // Google is a catalog entry like any other, but its detail
                        // is the multi-profile workspace panel (selected==="google")
                        // and favoriting it scaffolds the real vault app first.
                        const isGoogle = c.iconSlug === "google" || c.name === "Google";
                        return (
                        <CatalogRow
                          key={c.iconSlug || c.name}
                          app={c}
                          logos={logos}
                          active={isGoogle ? selected === "google" && !catalogPick : catalogPick?.name === c.name}
                          onSelect={isGoogle
                            ? () => { setSelected("google"); setCatalogPick(null); setConnecting(false); }
                            : () => { setCatalogPick(c); setConnecting(false); }}
                          isFav={favs.has(favKeyOf(c.name))}
                          onToggleFav={isGoogle ? () => void favApp({ id: "google", title: "Google" }) : () => void favCatalogApp(c)}
                        />
                        );
                      })}
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
            </div>
          </aside>
          )}

          {/* RIGHT - the connect flow, the selected connector's config, or a
              catalog app's detail. Flush inside the panel (no own card). */}
          <div className="min-w-0 flex-1 overflow-y-auto bg-surface">
            {connecting ? (
              <ConnectAppFlow
                vaultPath={vaultPath}
                presetName={catalogPick?.name}
                onDone={async () => { setConnecting(false); setCatalogPick(null); await reload(); }}
                onCancel={() => setConnecting(false)}
              />
            ) : selected === "google" ? (
              // Google is an app object: its detail IS the multi-profile workspace
              // panel (each Google account is a profile inside this one app).
              <GoogleWorkspacePanel vaultPath={vaultPath} logos={logos} />
            ) : catalogPick ? (
              <>
                {catalogConnectErr && (
                  <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{catalogConnectErr}</div>
                )}
                <AppDetail
                  key={catalogPick.iconSlug || catalogPick.name}
                  app={catalogToApp(catalogPick)}
                  vaultPath={vaultPath}
                  logos={logos}
                  status={"disconnected"}
                  busy={false}
                  onSync={async () => {}}
                  onSetEnabled={() => {}}
                  onReload={reload}
                  connect={{ onConnect: () => connectCatalogApp(catalogPick), connecting: catalogConnecting, soul: catalogPick.soul }}
                />
              </>
            ) : directSelectedApp ? (
              <AppDetail
                key={directSelectedApp.id}
                app={directSelectedApp}
                vaultPath={vaultPath}
                logos={logos}
                status={appStatus(directSelectedApp)}
                busy={busy === directSelectedApp.id}
                onSync={() => syncNow(directSelectedApp.id)}
                onSetEnabled={(v) => setEnabled(directSelectedApp.id, v)}
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
      )}
    </>
  );
}

// The vault app id for a gateway-fronted app. Must match everywhere the app is
// scaffolded or favorited (ConnectedGatewayDetail + the row star) so the home
// sidebar, which filters by app id, finds the same entry.
function gatewayAppId(method: "composio" | "nango", slug: string): string {
  return `${method}-${slug}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

// The home-screen star for a connected gateway app. Returns a builder that, per
// row, reports whether it's pinned and toggles it. Toggling ON first scaffolds
// the gateway app as a real vault app (engine_gateway_app_add) so the sidebar -
// which lists vault apps and filters by favorite - can actually show it, then
// favorites it by the same id. This is what lets Composio / Nango apps be
// favorited straight from the list, exactly like Direct apps.
function useGatewayFav(method: "composio" | "nango") {
  const favs = useFavorites();
  return (slug: string, title: string) => {
    const id = gatewayAppId(method, slug);
    const key = favKeyOf(id);
    return {
      on: favs.has(key),
      toggle: async () => {
        if (!favs.has(key)) {
          await invoke("engine_gateway_app_add", { provider: method, toolkit: slug, id, title }).catch(() => {});
          window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
        }
        toggleFavorite(key);
      },
    };
  };
}

// The UNIVERSAL primitive for a connected gateway app (Composio or Nango). It
// scaffolds the gateway app as a first-class vault app (so the schedule persists
// and the daemon can sync it), loads it, then renders the SAME rich AppDetail as
// Direct apps - with gatewayProvider set so the per-method auth UI is hidden and
// a "Connected via X" pill + gateway SOURCE line are shown. A small Back control
// above lets the user return to the list.
function ConnectedGatewayDetail({ method, slug, title, vaultPath, logos, onBack }: {
  method: "composio" | "nango";
  slug: string;
  title: string;
  vaultPath: string;
  logos: Record<string, BrandLogo>;
  onBack: () => void;
}) {
  const id = gatewayAppId(method, slug);
  const [app, setApp] = useState<EngineApp | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      let list = await invoke<EngineApp[]>("engine_apps_list");
      let a = (list ?? []).find((x) => x.id === id);
      if (!a) {
        // Scaffold it as a vault app so the schedule persists + it's chattable.
        await invoke("engine_gateway_app_add", { provider: method, toolkit: slug, id, title }).catch(() => {});
        list = await invoke<EngineApp[]>("engine_apps_list");
        a = (list ?? []).find((x) => x.id === id);
      }
      setApp(a ? { ...a, title: appName(a.title) } : null);
    } catch { setApp(null); }
  }, [id, title, method, slug]);
  useEffect(() => { void load(); }, [load]);
  const onSync = useCallback(async (): Promise<SyncResult> => {
    if (!app) return { ok: false, error: "still setting up" };
    setBusy(true);
    try {
      const r = await invoke<SyncResult>("engine_app_sync", { id: app.id, vault: vaultPath });
      await load();
      return r ?? { ok: true };
    } catch (e) { console.error("sync gateway app", e); return { ok: false, error: String(e).slice(0, 200) }; }
    finally { setBusy(false); }
  }, [app, vaultPath, load]);
  const onSetEnabled = useCallback(async (v: boolean) => {
    if (!app) return;
    try { await invoke("engine_app_set_enabled", { id: app.id, enabled: v }); await load(); }
    catch (e) { console.error("set enabled", e); }
  }, [app, load]);
  return (
    <div className="space-y-2">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-accent">
        <ArrowUpRight className="h-3.5 w-3.5 rotate-[225deg]" /> Back
      </button>
      {app ? (
        <AppDetail
          app={app}
          vaultPath={vaultPath}
          logos={logos}
          status={appStatus(app)}
          busy={busy}
          onSync={onSync}
          onSetEnabled={(v) => void onSetEnabled(v)}
          onReload={load}
          gatewayProvider={method}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-text-muted" />
          <p className="mt-3 text-sm text-text-secondary">Setting up {title}…</p>
        </div>
      )}
    </div>
  );
}

// Composio's app catalog (toolkit slug -> display name + category). The consumer
// key is MCP-only (the REST catalog API rejects it), so this is bundled. Slugs are
// Composio's toolkit slugs, used verbatim by COMPOSIO_MANAGE_CONNECTIONS add.
const COMPOSIO_APPS: { slug: string; name: string; cat: string }[] = [
  { slug: "gmail", name: "Gmail", cat: "Email" },
  { slug: "outlook", name: "Outlook", cat: "Email" },
  { slug: "googlecalendar", name: "Google Calendar", cat: "Calendar" },
  { slug: "googledrive", name: "Google Drive", cat: "Files" },
  { slug: "googledocs", name: "Google Docs", cat: "Docs" },
  { slug: "googlesheets", name: "Google Sheets", cat: "Docs" },
  { slug: "googlemeet", name: "Google Meet", cat: "Meetings" },
  { slug: "notion", name: "Notion", cat: "Docs" },
  { slug: "slack", name: "Slack", cat: "Communication" },
  { slug: "discord", name: "Discord", cat: "Communication" },
  { slug: "microsoft_teams", name: "Microsoft Teams", cat: "Communication" },
  { slug: "telegram", name: "Telegram", cat: "Communication" },
  { slug: "github", name: "GitHub", cat: "Developer" },
  { slug: "gitlab", name: "GitLab", cat: "Developer" },
  { slug: "bitbucket", name: "Bitbucket", cat: "Developer" },
  { slug: "linear", name: "Linear", cat: "Developer" },
  { slug: "jira", name: "Jira", cat: "Developer" },
  { slug: "confluence", name: "Confluence", cat: "Docs" },
  { slug: "sentry", name: "Sentry", cat: "Developer" },
  { slug: "figma", name: "Figma", cat: "Design" },
  { slug: "asana", name: "Asana", cat: "Productivity" },
  { slug: "trello", name: "Trello", cat: "Productivity" },
  { slug: "clickup", name: "ClickUp", cat: "Productivity" },
  { slug: "todoist", name: "Todoist", cat: "Productivity" },
  { slug: "airtable", name: "Airtable", cat: "Productivity" },
  { slug: "calendly", name: "Calendly", cat: "Scheduling" },
  { slug: "zoom", name: "Zoom", cat: "Meetings" },
  { slug: "dropbox", name: "Dropbox", cat: "Files" },
  { slug: "box", name: "Box", cat: "Files" },
  { slug: "onedrive", name: "OneDrive", cat: "Files" },
  { slug: "hubspot", name: "HubSpot", cat: "CRM" },
  { slug: "salesforce", name: "Salesforce", cat: "CRM" },
  { slug: "pipedrive", name: "Pipedrive", cat: "CRM" },
  { slug: "intercom", name: "Intercom", cat: "Support" },
  { slug: "zendesk", name: "Zendesk", cat: "Support" },
  { slug: "mailchimp", name: "Mailchimp", cat: "Marketing" },
  { slug: "sendgrid", name: "SendGrid", cat: "Marketing" },
  { slug: "typeform", name: "Typeform", cat: "Forms" },
  { slug: "twilio", name: "Twilio", cat: "Communication" },
  { slug: "stripe", name: "Stripe", cat: "Finance" },
  { slug: "quickbooks", name: "QuickBooks", cat: "Finance" },
  { slug: "shopify", name: "Shopify", cat: "Commerce" },
  { slug: "twitter", name: "X (Twitter)", cat: "Social" },
  { slug: "linkedin", name: "LinkedIn", cat: "Social" },
  { slug: "reddit", name: "Reddit", cat: "Social" },
  { slug: "youtube", name: "YouTube", cat: "Social" },
  { slug: "spotify", name: "Spotify", cat: "Media" },
];

// Gateway listing cache. The Composio/Nango listings come from slow MCP round-trips,
// so we persist the last successful result with a timestamp and hydrate from it
// instantly on mount; we only hit the network when the cache is older than this
// staleness window (or when the user forces a Refresh).
const GATEWAY_CACHE_STALE_MS = 60_000;
const COMPOSIO_CACHE_KEY = "prevail.composio.connected.cache";
const NANGO_CACHE_KEY = "prevail.nango.cache";

function readGatewayCache<T>(key: string): { data: T; ts: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && typeof v.ts === "number" && "data" in v) return v as { data: T; ts: number };
    return null;
  } catch { return null; }
}
function writeGatewayCache<T>(key: string, data: T) {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch { /* ignore */ }
}
function clearGatewayCache(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// The Composio track: a managed gateway, completely separate from Direct. Set up
// the key once, then browse Composio's app catalog and connect any app, which opens
// a Composio auth link in the browser. Connections live in Composio; Prevail's
// agent uses them through the Composio MCP endpoint.
type ComposioCliStatus = { installed: boolean; loggedIn: boolean; account: string | null; bin: string | null };
function ComposioMode({ vaultPath, expanded }: { vaultPath: string; expanded: boolean }) {
  // The home-screen star for connected Composio apps (scaffold-then-favorite).
  const gatewayFav = useGatewayFav("composio");
  // Connect-via sub-mode: CLI (browser OAuth, the default) or MCP (the existing
  // key-based flow). Both set up the same Composio account; the agent uses the
  // Composio MCP either way. Persisted so the choice survives a reload.
  const [composioMethod, setComposioMethod] = useState<"cli" | "mcp">(() => {
    try { return localStorage.getItem("prevail.composio.method") === "mcp" ? "mcp" : "cli"; } catch { return "cli"; }
  });
  useEffect(() => { try { localStorage.setItem("prevail.composio.method", composioMethod); } catch { /* ignore */ } }, [composioMethod]);
  // CLI setup state.
  const [cliStatus, setCliStatus] = useState<ComposioCliStatus | null>(null);
  const [cliBusy, setCliBusy] = useState<null | "status" | "install" | "login">(null);
  const [cliOutput, setCliOutput] = useState<string | null>(null);
  const checkCliStatus = useCallback(async () => {
    setCliBusy("status");
    try { setCliStatus(await invoke<ComposioCliStatus>("composio_cli_status")); }
    catch { setCliStatus({ installed: false, loggedIn: false, account: null, bin: null }); }
    finally { setCliBusy((b) => (b === "status" ? null : b)); }
  }, []);
  useEffect(() => { if (composioMethod === "cli") void checkCliStatus(); }, [composioMethod, checkCliStatus]);
  const installCli = useCallback(async () => {
    setCliBusy("install"); setCliOutput(null);
    try { const r = await invoke<{ ok: boolean; output: string }>("composio_cli_install"); setCliOutput(r.output); }
    catch (e) { setCliOutput(String(e)); }
    finally { setCliBusy(null); await checkCliStatus(); }
  }, [checkCliStatus]);
  const loginCli = useCallback(async () => {
    setCliBusy("login"); setCliOutput(null);
    try { const r = await invoke<{ ok: boolean; output: string }>("composio_cli_login"); setCliOutput(r.output); }
    catch (e) { setCliOutput(String(e)); }
    finally { setCliBusy(null); await checkCliStatus(); }
  }, [checkCliStatus]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "verify">(null);
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [logos, setLogos] = useState<Record<string, BrandLogo>>({});
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [refreshingConn, setRefreshingConn] = useState(false);
  // Master-detail selection: the slug of the app whose detail shows in the right
  // pane. A connected slug renders ConnectedGatewayDetail; an available one shows
  // a small Connect pane.
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  useEffect(() => { void invoke<Record<string, BrandLogo>>("ingestion_connector_logos").then(setLogos).catch(() => {}); }, []);
  // Which Composio apps are actively connected (one MCP call over the catalog).
  // Cached: a successful result is persisted with a timestamp so the list renders
  // instantly next time. `force` ignores the staleness window (the Refresh button).
  const loadConnections = useCallback(async (force = false) => {
    if (!force) {
      const cached = readGatewayCache<{ active: string[] }>(COMPOSIO_CACHE_KEY);
      if (cached && Date.now() - cached.ts < GATEWAY_CACHE_STALE_MS) return;
    }
    setRefreshingConn(true);
    try {
      const r = await invoke<{ active: string[] }>("composio_connections", { toolkits: COMPOSIO_APPS.map((a) => a.slug) });
      const active = r.active ?? [];
      setConnected(new Set(active));
      writeGatewayCache(COMPOSIO_CACHE_KEY, { active });
    } catch { /* keep current */ }
    finally { setRefreshingConn(false); }
  }, []);
  const refresh = useCallback(async () => {
    try { const s = await invoke<{ configured: boolean }>("composio_status"); setConfigured(!!s.configured); }
    catch { setConfigured(false); }
  }, []);
  const verify = useCallback(async () => {
    setBusy("verify"); setVerified(null); setVerifyMsg("Checking the connection to Composio…");
    try { const r = await invoke<{ ok: boolean; error?: string }>("composio_verify"); setVerified(!!r.ok); setVerifyMsg(r.ok ? "Connected to Composio." : `Not connected: ${r.error ?? "unknown"}`); }
    catch (e) { setVerified(false); setVerifyMsg(String(e)); }
    finally { setBusy(null); }
  }, []);
  useEffect(() => { void refresh().then(() => { void verify(); }); }, [refresh, verify]);
  // Load connection status once set up, and re-check when the window regains focus
  // (the user just authorized an app in the browser and came back). Hydrate from
  // the cache immediately so the list renders with no spinner, then only hit the
  // network if the cache is stale (or absent). The focus refresh is throttled the
  // same way via loadConnections's staleness check.
  // Connectors load once Composio is usable: the MCP key verified, OR the CLI is
  // logged in. Either path reaches the same Composio account, so connectors list
  // through the existing MCP call in both modes.
  const connectorsUsable = (composioMethod === "mcp" && verified === true) || (composioMethod === "cli" && !!cliStatus?.loggedIn);
  useEffect(() => {
    if (!connectorsUsable) return;
    const cached = readGatewayCache<{ active: string[] }>(COMPOSIO_CACHE_KEY);
    if (cached) setConnected(new Set(cached.data.active ?? []));
    void loadConnections();
    const onFocus = () => { void loadConnections(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [connectorsUsable, loadConnections]);
  const save = async () => {
    setBusy("save"); setVerifyMsg(null);
    try { await invoke("composio_set_key", { key: keyInput.trim() }); setKeyInput(""); setEditingKey(false); await refresh(); void verify(); }
    catch (e) { setVerifyMsg(String(e)); }
    finally { setBusy(null); }
  };
  const removeKey = async () => {
    setBusy("save");
    try { await invoke("composio_set_key", { key: "" }); setKeyInput(""); setEditingKey(false); setVerified(null); setVerifyMsg(null); setConnected(new Set()); clearGatewayCache(COMPOSIO_CACHE_KEY); await refresh(); }
    catch (e) { setVerifyMsg(String(e)); }
    finally { setBusy(null); }
  };
  const connectApp = async (slug: string) => {
    setConnectingSlug(slug); setConnectMsg(null);
    try {
      const r = await invoke<{ ok: boolean; authUrl?: string }>("composio_connect_app", { toolkit: slug });
      if (r.authUrl) { await openUrl(r.authUrl); setConnectMsg(`Opening the ${slug} sign-in in your browser. Authorize it there, then it is connected in Composio.`); }
      else setConnectMsg(r.ok ? `Requested ${slug}. Open the Composio dashboard to finish authorizing.` : `Couldn't start ${slug}.`);
    } catch (e) { setConnectMsg(String(e)); }
    finally { setConnectingSlug(null); }
  };
  // Show the setup form unless we have a VALID key. Connectors only render when
  // verified === true, so an invalid/missing key never shows the catalog.
  const showForm = !configured || verified === false || editingKey;
  const verifying = configured && verified === null && busy === "verify";
  const q = query.trim().toLowerCase();
  const shown = !q ? COMPOSIO_APPS : COMPOSIO_APPS.filter((a) => `${a.name} ${a.slug} ${a.cat}`.toLowerCase().includes(q));
  const connectedApps = shown.filter((a) => connected.has(a.slug));
  const availableApps = shown.filter((a) => !connected.has(a.slug));
  const selected = selectedSlug ? COMPOSIO_APPS.find((a) => a.slug === selectedSlug) ?? null : null;
  const selectedConnected = selected ? connected.has(selected.slug) : false;
  const cliLoggedIn = !!cliStatus?.loggedIn;
  // Composio is usable (so the catalog + connect flows render) when EITHER the
  // MCP key verified OR the CLI is logged in. Connecting an app still uses the
  // existing composio_connect_app MCP path in both modes.
  const usable = (composioMethod === "mcp" && verified === true) || (composioMethod === "cli" && cliLoggedIn);
  // The setup/config dropdown is driven by the tab row (expanded), so there's no
  // separate header line. It still shows whenever there's setup left to do, so a
  // disconnected user can always reach the connect steps.
  const showSetup = expanded || !usable;
  return (
    <div className="space-y-4">
      {/* Setup/config dropdown - opened from the Composio tab, no header row. */}
      {showSetup && (
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-start gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {composioMethod === "mcp" && verified === false && <span className="inline-flex items-center gap-1 rounded-full border border-danger/40 bg-danger/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-danger">Invalid key</span>}
          {/* Connect via: CLI (default) or MCP. Small segmented control. */}
          <div className="ml-auto inline-flex rounded-md border border-border bg-background p-0.5">
            {([["cli", "CLI", Terminal], ["mcp", "MCP", Boxes]] as const).map(([m, label, Icon]) => (
              <button
                key={m}
                onClick={() => setComposioMethod(m)}
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${composioMethod === m ? "bg-accent text-background" : "text-text-secondary hover:text-text-primary"}`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1.5 max-w-prose text-[12px] leading-relaxed text-text-secondary">One managed gateway: a single key fronts 1000+ apps. Authorize each app once in Composio, then Prevail's agent uses them through the Composio MCP endpoint - no per-app setup on this Mac. <button onClick={() => void openUrl("https://composio.dev")} className="text-accent hover:underline">What is Composio?</button></p>
        {composioMethod === "cli" ? (
          (() => {
            const installed = !!cliStatus?.installed;
            const loggedIn = !!cliStatus?.loggedIn;
            const checking = cliBusy === "status" && cliStatus === null;
            // A two-step guided flow so it's always clear what to do NEXT:
            // 1) install the CLI, 2) sign in. Each step shows done / now-do-this /
            // waiting, with the action button only on the active step.
            const Step = ({ n, title, sub, state, children }: { n: number; title: string; sub: string; state: "done" | "active" | "wait"; children?: React.ReactNode }) => (
              <div className={`flex gap-3 rounded-lg border p-3 ${state === "active" ? "border-accent-border bg-accent-soft/30" : "border-border-subtle bg-background"}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${state === "done" ? "bg-ok text-background" : state === "active" ? "bg-accent text-background" : "bg-surface-warm text-text-muted"}`}>
                  {state === "done" ? <Check className="h-3.5 w-3.5" /> : n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-semibold ${state === "wait" ? "text-text-muted" : "text-text-primary"}`}>{title}</div>
                  <div className="mt-0.5 text-[11px] text-text-muted">{sub}</div>
                  {state === "active" && children && <div className="mt-2">{children}</div>}
                </div>
              </div>
            );
            return (
              <div className="mt-3 max-w-xl space-y-2">
                <p className="text-[11px] leading-relaxed text-text-secondary">Two quick steps - no key to copy. Prevail then uses your Composio connection. <button onClick={() => void openUrl("https://docs.composio.dev")} className="text-accent hover:underline">Get help</button>.</p>
                {checking ? (
                  <div className="flex items-center gap-2 text-[11px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the Composio CLI…</div>
                ) : (
                  <>
                    <Step n={1} title="Install the Composio CLI" sub={installed ? "Installed on this Mac." : "A one-time download. Click below; it shows progress, then moves you to step 2."} state={installed ? "done" : "active"}>
                      <button onClick={installCli} disabled={cliBusy !== null} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{cliBusy === "install" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Installing…</> : <><Download className="h-3.5 w-3.5" /> Install Composio CLI</>}</button>
                    </Step>
                    <Step n={2} title="Sign in to Composio" sub={loggedIn ? `Signed in${cliStatus?.account ? ` as ${cliStatus.account}` : ""}.` : installed ? "Opens your browser to sign in once. After you finish, come back - the panel turns green and your apps become usable." : "Available once the CLI is installed."} state={loggedIn ? "done" : installed ? "active" : "wait"}>
                      <button onClick={loginCli} disabled={cliBusy !== null} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{cliBusy === "login" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for browser sign-in…</> : <><ExternalLink className="h-3.5 w-3.5" /> Sign in to Composio</>}</button>
                    </Step>
                    {loggedIn ? (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-[11px]">
                        <span className="inline-flex items-center gap-1 font-semibold text-ok"><Check className="h-3.5 w-3.5" /> Connected. Pick an app below to start using it.</span>
                      </div>
                    ) : (
                      <button onClick={checkCliStatus} disabled={cliBusy !== null} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">{cliBusy === "status" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh status</button>
                    )}
                  </>
                )}
                {cliBusy === "login" && <p className="flex items-center gap-2 text-[11px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Finish the sign-in in your browser, then return here.</p>}
                {cliOutput && (
                  <details className="rounded-md border border-border bg-background">
                    <summary className="cursor-pointer px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">Install / sign-in log</summary>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-2 py-1.5 font-mono text-[10px] text-text-muted">{cliOutput}</pre>
                  </details>
                )}
              </div>
            );
          })()
        ) : showForm ? (
          <div className="mt-3 max-w-xl space-y-2">
            <p className="text-[11px] leading-relaxed text-text-secondary">Paste your <span className="font-mono text-text-primary">X-CONSUMER-API-KEY</span> from <button onClick={() => void openUrl("https://connect.composio.dev")} className="text-accent hover:underline">connect.composio.dev</button> (starts with <span className="font-mono">ck_</span>). Stored in your Mac's Keychain.</p>
            {verified === false && <p className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">That key did not authenticate to Composio. Enter a valid X-CONSUMER-API-KEY.</p>}
            <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} type="password" placeholder="ck_…" onKeyDown={(e) => { if (e.key === "Enter" && keyInput.trim()) void save(); }}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent-border" />
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={save} disabled={busy !== null || !keyInput.trim()} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save key</button>
              {(editingKey || (configured && verified === false)) && <button onClick={() => { setEditingKey(false); setKeyInput(""); }} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:border-accent-border">Cancel</button>}
              {configured && <button onClick={removeKey} disabled={busy !== null} className="text-[11px] text-text-muted hover:text-danger hover:underline">Remove key</button>}
            </div>
            {verifyMsg && verified !== false && <p className="text-[11px] text-text-secondary">{verifyMsg}</p>}
          </div>
        ) : verifying ? (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your Composio key…</div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
            <span className="font-semibold text-accent">Key valid.</span>
            <button onClick={verify} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">{busy === "verify" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Re-verify</button>
            <button onClick={() => setEditingKey(true)} className="text-[10px] hover:text-accent hover:underline">Change key</button>
            <button onClick={removeKey} disabled={busy !== null} className="text-[10px] hover:text-danger hover:underline">Remove key</button>
            <button onClick={() => void openUrl("https://dashboard.composio.dev")} className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline">Dashboard <ExternalLink className="h-2.5 w-2.5" /></button>
          </div>
        )}
        </div>
        <HeaderLogoCluster slugs={COMPOSIO_APPS.slice(0, 10).map((a) => ({ title: a.name, id: a.slug }))} logos={logos} />
        </div>
      </div>
      )}

      {/* Master-detail (shared template), shown once the gateway is usable. */}
      {usable && (
      <MasterDetail
        title="Apps"
        storageKey="prevail.composio.listCollapsed"
        toolbar={
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps, or type any Composio app name"
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none" />
            </div>
            {q && availableApps.length === 0 && connectedApps.length === 0 && (
              <button onClick={() => void connectApp(q.replace(/[^a-z0-9_]/g, ""))} disabled={connectingSlug !== null}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                {connectingSlug ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Connect "{q}"
              </button>
            )}
            <button onClick={() => void loadConnections(true)} disabled={refreshingConn} title="Refresh connection status"
              className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
              {refreshingConn ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
            </button>
            {connectMsg && <div className="rounded-lg border border-accent-border bg-accent-soft/20 px-3 py-2 text-[12px] text-text-secondary">{connectMsg}</div>}
          </div>
        }
        list={
          <div className="space-y-4">
            {connectedApps.length > 0 && (
              <section className="space-y-1">
                <div className="px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Connected · {connectedApps.length}</div>
                {connectedApps.map((a) => (
                  <GatewayRow key={a.slug} title={a.name} sub={a.cat} logoId={a.slug} logos={logos} connected active={selectedSlug === a.slug} onSelect={() => setSelectedSlug(a.slug)} fav={gatewayFav(a.slug, a.name)} />
                ))}
              </section>
            )}
            <section className="space-y-1">
              <div className="px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Available to connect · {availableApps.length}</div>
              {availableApps.map((a) => (
                <GatewayRow key={a.slug} title={a.name} sub={a.cat} logoId={a.slug} logos={logos} active={selectedSlug === a.slug} onSelect={() => setSelectedSlug(a.slug)} />
              ))}
            </section>
            {shown.length === 0 && <div className="px-1 text-xs text-text-muted">No Composio apps match "{query}".</div>}
          </div>
        }
        rail={
          <>
            {shown.map((a) => (
              <button key={a.slug} onClick={() => setSelectedSlug(a.slug)} title={a.name}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${selectedSlug === a.slug ? "ring-2 ring-accent" : "hover:bg-surface-strong"}`}>
                <AppRowLogo app={{ title: a.name, id: a.slug }} logos={logos} size={26} fallback="letter" />
              </button>
            ))}
          </>
        }
        detail={
          selected && selectedConnected ? (
            <ConnectedGatewayDetail key={selected.slug} method="composio" slug={selected.slug} title={selected.name} vaultPath={vaultPath} logos={logos} onBack={() => setSelectedSlug(null)} />
          ) : selected ? (
            <GatewayConnectDetail key={selected.slug} title={selected.name} sub={selected.cat} logoId={selected.slug} logos={logos} method="composio" connecting={connectingSlug === selected.slug} onConnect={() => void connectApp(selected.slug)} />
          ) : (
            <div className="p-8 text-center text-sm text-text-muted">Select an app to view details.</div>
          )
        }
      />
      )}
    </div>
  );
}

// Nango track: a third parallel gateway. The user supplies their Nango secret key,
// Prevail lists the integrations configured in their Nango project, and connecting
// one opens a Nango Connect session in the browser. Nango then syncs the data.
type NangoIntegration = { unique_key: string; provider: string; display_name: string };
function NangoMode({ vaultPath, expanded }: { vaultPath: string; expanded: boolean }) {
  // The home-screen star for connected Nango apps (scaffold-then-favorite).
  const gatewayFav = useGatewayFav("nango");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "verify">(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<NangoIntegration[]>([]);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  // Master-detail selection: the unique_key of the integration shown on the right.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [logos, setLogos] = useState<Record<string, BrandLogo>>({});
  const [query, setQuery] = useState("");
  useEffect(() => { void invoke<Record<string, BrandLogo>>("ingestion_connector_logos").then(setLogos).catch(() => {}); }, []);
  const refresh = useCallback(async () => {
    try { const s = await invoke<{ configured: boolean }>("nango_status"); setConfigured(!!s.configured); }
    catch { setConfigured(false); }
  }, []);
  // Cached: integrations + active connections come from slow MCP calls, so a
  // successful result is persisted with a timestamp. `force` ignores the staleness
  // window (the Refresh button and a fresh verify).
  const loadData = useCallback(async (force = false) => {
    if (!force) {
      const cached = readGatewayCache<{ integrations: NangoIntegration[]; active: string[] }>(NANGO_CACHE_KEY);
      if (cached && Date.now() - cached.ts < GATEWAY_CACHE_STALE_MS) return;
    }
    let integrations: NangoIntegration[] | null = null;
    let active: string[] | null = null;
    try { const r = await invoke<{ integrations: NangoIntegration[] }>("nango_integrations"); integrations = r.integrations ?? []; setIntegrations(integrations); } catch { /* */ }
    try { const c = await invoke<{ active: string[] }>("nango_connections"); active = c.active ?? []; setConnected(new Set(active)); } catch { /* */ }
    if (integrations !== null || active !== null) {
      const prev = readGatewayCache<{ integrations: NangoIntegration[]; active: string[] }>(NANGO_CACHE_KEY)?.data;
      writeGatewayCache(NANGO_CACHE_KEY, {
        integrations: integrations ?? prev?.integrations ?? [],
        active: active ?? prev?.active ?? [],
      });
    }
  }, []);
  const verify = useCallback(async () => {
    setBusy("verify"); setVerified(null); setVerifyMsg("Checking your Nango key…");
    try { const r = await invoke<{ ok: boolean; error?: string }>("nango_verify"); setVerified(!!r.ok); setVerifyMsg(r.ok ? "Connected to Nango." : `Not connected: ${r.error ?? "unknown"}`); if (r.ok) await loadData(); }
    catch (e) { setVerified(false); setVerifyMsg(String(e)); }
    finally { setBusy(null); }
  }, [loadData]);
  useEffect(() => { void refresh().then(() => { void verify(); }); }, [refresh, verify]);
  // Hydrate from the cache immediately so the lists render with no spinner, then
  // only hit the network if the cache is stale (handled inside loadData). The focus
  // refresh is throttled the same way.
  useEffect(() => {
    if (verified !== true) return;
    const cached = readGatewayCache<{ integrations: NangoIntegration[]; active: string[] }>(NANGO_CACHE_KEY);
    if (cached) { setIntegrations(cached.data.integrations ?? []); setConnected(new Set(cached.data.active ?? [])); }
    const onFocus = () => { void loadData(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [verified, loadData]);
  const save = async () => {
    setBusy("save"); setVerifyMsg(null);
    try { await invoke("nango_set_key", { key: keyInput.trim() }); setKeyInput(""); setEditingKey(false); await refresh(); void verify(); }
    catch (e) { setVerifyMsg(String(e)); }
    finally { setBusy(null); }
  };
  const removeKey = async () => {
    setBusy("save");
    try { await invoke("nango_set_key", { key: "" }); setKeyInput(""); setEditingKey(false); setVerified(null); setVerifyMsg(null); setIntegrations([]); setConnected(new Set()); clearGatewayCache(NANGO_CACHE_KEY); await refresh(); }
    catch (e) { setVerifyMsg(String(e)); }
    finally { setBusy(null); }
  };
  const connect = async (uniq: string) => {
    setConnectingKey(uniq); setConnectMsg(null);
    try {
      const r = await invoke<{ ok: boolean; connectUrl?: string }>("nango_connect", { integration: uniq });
      if (r.connectUrl) { await openUrl(r.connectUrl); setConnectMsg(`Opening the Nango sign-in for ${uniq} in your browser. Authorize it there, then it is connected.`); }
      else setConnectMsg(`Couldn't start the connect flow for ${uniq}.`);
    } catch (e) { setConnectMsg(String(e)); }
    finally { setConnectingKey(null); }
  };
  const showForm = !configured || verified === false || editingKey;
  const verifying = configured && verified === null && busy === "verify";
  const q = query.trim().toLowerCase();
  const shown = !q ? integrations : integrations.filter((i) => `${i.display_name} ${i.unique_key} ${i.provider}`.toLowerCase().includes(q));
  const connectedApps = shown.filter((i) => connected.has(i.unique_key));
  const availableApps = shown.filter((i) => !connected.has(i.unique_key));
  const selected = selectedKey ? integrations.find((i) => i.unique_key === selectedKey) ?? null : null;
  const selectedConnected = selected ? connected.has(selected.unique_key) : false;
  const usable = verified === true;
  // Setup/config dropdown driven by the Nango tab (expanded); always shown while
  // there's still setup to do so a disconnected user can reach the key field.
  const showSetup = expanded || !usable;
  return (
    <div className="space-y-4">
      {/* Setup/config dropdown - opened from the Nango tab, no header row. */}
      {showSetup && (
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-start gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
        <p className="max-w-prose text-[12px] leading-relaxed text-text-secondary">Your own Nango project, fronted by one secret key. Prevail lists the integrations you configured in Nango; connect one and Nango runs the sign-in and syncs its data for the agent to use. <button onClick={() => void openUrl("https://nango.dev")} className="text-accent hover:underline">What is Nango?</button></p>
        {showForm ? (
          <div className="mt-3 max-w-xl space-y-2">
            <p className="text-[11px] leading-relaxed text-text-secondary">Copy your <span className="font-mono text-text-primary">Secret Key</span> from <button onClick={() => void openUrl("https://app.nango.dev/dev/getting-started")} className="text-accent hover:underline">app.nango.dev</button> (Environment Settings). Stored in your Mac's Keychain.</p>
            {verified === false && <p className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">That key did not authenticate to Nango. Enter a valid secret key.</p>}
            <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} type="password" placeholder="nango secret key…" onKeyDown={(e) => { if (e.key === "Enter" && keyInput.trim()) void save(); }}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent-border" />
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={save} disabled={busy !== null || !keyInput.trim()} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save key</button>
              {(editingKey || (configured && verified === false)) && <button onClick={() => { setEditingKey(false); setKeyInput(""); }} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:border-accent-border">Cancel</button>}
              {configured && <button onClick={removeKey} disabled={busy !== null} className="text-[11px] text-text-muted hover:text-danger hover:underline">Remove key</button>}
            </div>
            {verifyMsg && verified !== false && <p className="text-[11px] text-text-secondary">{verifyMsg}</p>}
          </div>
        ) : verifying ? (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your Nango key…</div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
            <span className="font-semibold text-accent">Key valid.</span>
            <button onClick={verify} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">{busy === "verify" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Re-verify</button>
            <button onClick={() => setEditingKey(true)} className="text-[10px] hover:text-accent hover:underline">Change key</button>
            <button onClick={removeKey} disabled={busy !== null} className="text-[10px] hover:text-danger hover:underline">Remove key</button>
            <button onClick={() => void openUrl("https://app.nango.dev")} className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline">Dashboard <ExternalLink className="h-2.5 w-2.5" /></button>
          </div>
        )}
        </div>
        <HeaderLogoCluster
          slugs={[
            ...integrations.map((i) => ({ title: i.display_name, id: i.provider || i.unique_key })),
            ...HEADER_POPULAR,
          ].slice(0, 10)}
          logos={logos}
        />
        </div>
      </div>
      )}

      {/* Master-detail (shared template), shown once the key is verified. */}
      {verified === true && (
      <MasterDetail
        title="Apps"
        storageKey="prevail.nango.listCollapsed"
        toolbar={
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your Nango integrations"
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none" />
            </div>
            <button onClick={() => void loadData(true)} title="Refresh integrations + connections"
              className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:border-accent-border hover:text-accent">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
            {connectMsg && <div className="rounded-lg border border-accent-border bg-accent-soft/20 px-3 py-2 text-[12px] text-text-secondary">{connectMsg}</div>}
          </div>
        }
        list={
          integrations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-center text-[12px] text-text-secondary">
              No integrations configured in your Nango project yet. Add one in the <button onClick={() => void openUrl("https://app.nango.dev")} className="text-accent hover:underline">Nango dashboard</button>, then Refresh.
            </div>
          ) : (
            <div className="space-y-4">
              {connectedApps.length > 0 && (
                <section className="space-y-1">
                  <div className="px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Connected · {connectedApps.length}</div>
                  {connectedApps.map((i) => (
                    <GatewayRow key={i.unique_key} title={i.display_name} sub={i.provider || i.unique_key} logoId={i.provider || i.unique_key} logos={logos} connected active={selectedKey === i.unique_key} onSelect={() => setSelectedKey(i.unique_key)} fav={gatewayFav(i.unique_key, i.display_name)} />
                  ))}
                </section>
              )}
              <section className="space-y-1">
                <div className="px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Available to connect · {availableApps.length}</div>
                {availableApps.map((i) => (
                  <GatewayRow key={i.unique_key} title={i.display_name} sub={i.provider || i.unique_key} logoId={i.provider || i.unique_key} logos={logos} active={selectedKey === i.unique_key} onSelect={() => setSelectedKey(i.unique_key)} />
                ))}
              </section>
              {shown.length === 0 && <div className="px-1 text-xs text-text-muted">No integrations match "{query}".</div>}
            </div>
          )
        }
        rail={
          <>
            {shown.map((i) => (
              <button key={i.unique_key} onClick={() => setSelectedKey(i.unique_key)} title={i.display_name}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${selectedKey === i.unique_key ? "ring-2 ring-accent" : "hover:bg-surface-strong"}`}>
                <AppRowLogo app={{ title: i.display_name, id: i.provider || i.unique_key }} logos={logos} size={26} fallback="letter" />
              </button>
            ))}
          </>
        }
        detail={
          selected && selectedConnected ? (
            <ConnectedGatewayDetail key={selected.unique_key} method="nango" slug={selected.unique_key} title={selected.display_name} vaultPath={vaultPath} logos={logos} onBack={() => setSelectedKey(null)} />
          ) : selected ? (
            <GatewayConnectDetail key={selected.unique_key} title={selected.display_name} sub={selected.provider || selected.unique_key} logoId={selected.provider || selected.unique_key} logos={logos} method="nango" connecting={connectingKey === selected.unique_key} onConnect={() => void connect(selected.unique_key)} />
          ) : (
            <div className="p-8 text-center text-sm text-text-muted">Select an app to view details.</div>
          )
        }
      />
      )}
    </div>
  );
}

// A purely decorative cluster of brand logos for the right side of a mode's
// full-width header card, so the whitespace there doesn't read as blank. It's a
// compact low-opacity grid of AppRowLogo tiles - non-interactive, unselectable,
// and hidden on narrow widths so it never affects the header's flex layout.
function HeaderLogoCluster({ slugs, logos }: { slugs: { title: string; id: string }[]; logos: Record<string, BrandLogo> }) {
  const tiles = slugs.slice(0, 12);
  if (tiles.length === 0) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none ml-auto hidden shrink-0 select-none grid-cols-4 gap-1.5 opacity-70 [mask-image:linear-gradient(to_right,transparent,black_40%)] lg:grid"
    >
      {tiles.map((s, i) => (
        <span key={`${s.id}-${i}`} className="flex items-center justify-center rounded-md bg-surface-warm/60 p-0.5">
          <AppRowLogo app={s} logos={logos} size={28} fallback="letter" />
        </span>
      ))}
    </div>
  );
}

// A large brand field for the full-width Apps header - dense enough to fill the
// right ~half of the band and read as "lots of apps", right-to-left under a fade.
const APP_LOGO_FIELD: { title: string; id: string }[] = [
  { title: "Gmail", id: "gmail" },
  { title: "Google Calendar", id: "googlecalendar" },
  { title: "Google Drive", id: "googledrive" },
  { title: "Notion", id: "notion" },
  { title: "Slack", id: "slack" },
  { title: "GitHub", id: "github" },
  { title: "Linear", id: "linear" },
  { title: "LinkedIn", id: "linkedin" },
  { title: "Spotify", id: "spotify" },
  { title: "Stripe", id: "stripe" },
  { title: "Dropbox", id: "dropbox" },
  { title: "Airbnb", id: "airbnb" },
  { title: "HubSpot", id: "hubspot" },
  { title: "Airtable", id: "airtable" },
  { title: "Figma", id: "figma" },
  { title: "Jira", id: "jira" },
  { title: "Asana", id: "asana" },
  { title: "Trello", id: "trello" },
  { title: "Discord", id: "discord" },
  { title: "Zoom", id: "zoom" },
  { title: "Calendly", id: "calendly" },
  { title: "Shopify", id: "shopify" },
  { title: "QuickBooks", id: "quickbooks" },
  { title: "PayPal", id: "paypal" },
  { title: "YouTube", id: "youtube" },
  { title: "Reddit", id: "reddit" },
  { title: "Telegram", id: "telegram" },
  { title: "X", id: "twitter" },
];

// A curated popular set reused by the Nango and Direct header clusters (the
// Composio header derives its own from COMPOSIO_APPS).
const HEADER_POPULAR: { title: string; id: string }[] = [
  { title: "Gmail", id: "gmail" },
  { title: "Google Calendar", id: "googlecalendar" },
  { title: "Google Drive", id: "googledrive" },
  { title: "Notion", id: "notion" },
  { title: "Slack", id: "slack" },
  { title: "GitHub", id: "github" },
  { title: "Linear", id: "linear" },
  { title: "HubSpot", id: "hubspot" },
  { title: "Airtable", id: "airtable" },
  { title: "Stripe", id: "stripe" },
];

// One compact row in a gateway (Composio / Nango) left list: brand logo, name,
// a small subtitle (category / provider), and a Connected check or a Connect
// chevron. Selecting it shows the app's detail in the right pane.
function GatewayRow({ title, sub, logoId, logos, connected, active, onSelect, fav }: {
  title: string;
  sub: string;
  logoId: string;
  logos: Record<string, BrandLogo>;
  connected?: boolean;
  active: boolean;
  onSelect: () => void;
  // Present only for CONNECTED rows: the home-screen star, same primitive as the
  // Direct list. Toggling it scaffolds the gateway app (so the sidebar can find
  // it) and pins / unpins it from the home screen.
  fav?: { on: boolean; toggle: () => void };
}) {
  return (
    <div className={`group flex w-full items-center gap-1 rounded-lg border-l-2 pr-2 transition-colors ${active ? "border-l-accent bg-accent-soft shadow-sm ring-1 ring-accent-border" : "border-l-transparent ring-1 ring-transparent hover:bg-surface-warm"}`}>
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-2.5 text-left"
      >
        <AppRowLogo app={{ title, id: logoId }} logos={logos} size={28} fallback="letter" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${active ? "text-accent" : "text-text-primary"}`}>{title}</span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">{sub}</span>
        </span>
      </button>
      {connected && fav && (
        <button
          onClick={fav.toggle}
          title={fav.on ? "On your home screen - click to remove" : "Add to your home screen"}
          aria-pressed={fav.on}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:text-accent ${fav.on ? "text-accent" : "text-text-muted opacity-0 group-hover:opacity-100"}`}
        >
          <Star className={`h-3.5 w-3.5 ${fav.on ? "fill-accent" : ""}`} />
        </button>
      )}
      {connected ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
      ) : (
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 rotate-45 text-text-muted" />
      )}
    </div>
  );
}

// The right pane for an AVAILABLE (not-yet-connected) gateway app: brand mark,
// name, and a clear Connect CTA that opens the gateway's auth link in the browser.
function GatewayConnectDetail({ title, sub, logoId, logos, method, connecting, onConnect }: {
  title: string;
  sub: string;
  logoId: string;
  logos: Record<string, BrandLogo>;
  method: "composio" | "nango";
  connecting: boolean;
  onConnect: () => void;
}) {
  const label = method === "composio" ? "Composio" : "Nango";
  return (
    <div className="overflow-hidden bg-surface">
      <div className="flex flex-wrap items-start gap-4 border-b border-border-subtle px-5 py-5">
        <AppRowLogo app={{ title, id: logoId }} logos={logos} size={56} fallback="letter" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-lg font-semibold text-text-primary">{title}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted"><Globe className="h-2.5 w-2.5" /> Available to connect</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-muted">
            <span>{titleCase(sub)}</span>
            <span>· connects via {label}</span>
          </div>
          <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-text-secondary">Connect {title} through {label}. It opens a sign-in in your browser; authorize it there and it is connected in {label}. Prevail's agent can then use it.</p>
        </div>
        <button
          onClick={onConnect}
          disabled={connecting}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-60"
        >
          {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {connecting ? "Connecting…" : "Connect"}
        </button>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-start gap-2 rounded-lg border border-accent-border/40 bg-accent-soft/20 px-3 py-2.5 text-[12px] leading-relaxed text-text-secondary">
          <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span>After you authorize in the browser, come back to this window - the list refreshes and {title} moves to Connected, where you can set its refresh schedule.</span>
        </div>
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
    <div className={`group flex items-center gap-1 rounded-lg border-l-2 pr-2.5 transition-colors ${active ? "border-l-accent bg-accent-soft shadow-sm ring-1 ring-accent-border" : "border-l-transparent ring-1 ring-transparent hover:bg-surface-warm"}`}>
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left">
        <AppRowLogo app={app} logos={logos} size={28} fallback="letter" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${active ? "text-accent" : "text-text-primary"}`}>{app.title || app.id}</span>
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
    <div className={`group flex items-center gap-1 rounded-lg border-l-2 pr-2.5 transition-colors ${active ? "border-l-accent bg-accent-soft shadow-sm ring-1 ring-accent-border" : "border-l-transparent ring-1 ring-transparent hover:bg-surface-warm"}`}>
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left">
        <AppRowLogo app={catalogLogoApp(app)} logos={logos} size={28} fallback="letter" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${active ? "text-accent" : "text-text-primary"}`}>{app.name}</span>
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

// Superseded by the unified AppDetail (Connect mode); kept exported for reference.
export function CatalogDetail({ app, logos, onConnect, connecting }: {
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
// The actual colorful Google Chrome logo (lucide's is a monochrome outline).
function ChromeLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4caf50" d="M44,24c0,11.05-8.95,20-20,20S4,35.05,4,24S12.95,4,24,4S44,12.95,44,24z" />
      <path fill="#ffc107" d="M24,4v16l8,4l-8.84,20C12.62,43.54,4,34.82,4,24C4,12.95,12.95,4,24,4z" />
      <path fill="#ff3d00" d="M44,24c0-5.05-1.88-9.65-4.96-13.17L23,20l5,4l-3.16,20C35.05,43.54,44,34.82,44,24z" />
      <path fill="#1565c0" d="M24,32c-4.42,0-8-3.58-8-8s3.58-8,8-8s8,3.58,8,8S28.42,32,24,32z" />
      <path fill="#2196f3" d="M24,30c-3.31,0-6-2.69-6-6s2.69-6,6-6s6,2.69,6,6S27.31,30,24,30z" />
    </svg>
  );
}

// Synthesize a minimal EngineApp from a catalog entry so an un-added app renders
// in the SAME AppDetail view (in Connect mode) — one detail view for everything.
// Hand-off when a user starts "Learn New Skill" on an app that isn't added yet:
// we implicitly connect (scaffold) it, which re-routes to the real AppDetail —
// this carries the goal across that remount so learning starts automatically,
// without a separate "Connect" step. Keyed by the derived app id (which
// catalogToApp and connectCatalogApp compute identically).
let pendingAutolearn: { id: string; goal: string } | null = null;

function catalogToApp(c: CatalogApp): EngineApp {
  return {
    id: (c.iconSlug || c.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48),
    title: c.name,
    integration: c.via || c.pattern || "manual",
    status: "available",
    configured: false,
    domains: c.domain ? [c.domain] : [],
    lastSuccessTs: null,
    lastError: null,
    account: null,
    refresh: null,
  } as EngineApp;
}

function AppDetail({ app, vaultPath, logos, status, busy, onSync, onSetEnabled, onReload, gatewayProvider, connect }: {
  app: EngineApp;
  vaultPath: string;
  logos: Record<string, BrandLogo>;
  status: AppStatus;
  busy: boolean;
  onSync: () => Promise<SyncResult | void>;
  onSetEnabled: (v: boolean) => void;
  onReload: () => Promise<void> | void;
  // Set when this is an un-added CATALOG app: the SAME detail view renders, but
  // the primary action is Connect (not Sync), and connected-only bits are muted.
  // This is what makes catalog + connected apps share one view.
  connect?: { onConnect: () => void; connecting: boolean; soul?: string };
  // When set, this app is fronted by a managed gateway (Composio / Nango) rather
  // than connected directly. The per-method auth UI (Method picker + login /
  // credentials / MCP-setup) is meaningless for a gateway app, so it is hidden;
  // a "Connected via X" pill is shown and the SOURCE line reflects the gateway.
  gatewayProvider?: "composio" | "nango";
}) {
  const meta = STATUS_META[status];
  const enabled = app.enabled !== false;
  // Star = pin to the home sidebar. The one control, shared by every mode, that
  // decides what shows on the home screen (Direct, Composio, and Nango apps all
  // reach this same detail header). Keyed by the app's unique id (not its name)
  // so the same-named app connected three ways - Direct "notion", Composio
  // "composio-notion", Nango "nango-notion" - is starred / removed independently.
  const favs = useFavorites();
  const favKey = favKeyOf(app.id);
  const isFav = favs.has(favKey);
  // Apps redesign: the actual data files this connector has loaded (so the user
  // can SEE what was pulled, and reveal it). Loaded for the selected app, and
  // reloaded after a successful sync (lastSuccessTs change).
  // Agentic browser learn/replay + the skills it records. Available for ANY app:
  // the agent drives a real browser to learn how to fetch your data, records it
  // as a reusable skill (vault/apps/<id>/skills/), and replays it next time.
  const [learnMode, setLearnMode] = useState<ConnectorRunMode | null>(null);
  const [composing, setComposing] = useState(false);
  const [goalText, setGoalText] = useState("");
  const [skills, setSkills] = useState<{ id: string; runner: string; trigger: string }[]>([]);
  const loadSkills = useCallback(() => {
    invoke<{ id: string; runner: string; trigger: string }[]>("engine_app_skills", { id: app.id })
      .then((s) => setSkills(Array.isArray(s) ? s : []))
      .catch(() => setSkills([]));
  }, [app.id]);
  useEffect(() => { loadSkills(); }, [loadSkills, app.lastSuccessTs]);
  // Per-app soul: the same construct domains use (soul.md) — a markdown note
  // declaring WHY this app is in the harness, persisted to apps/<id>/soul.md and
  // read by the agent as standing context. Editable inline; saved to the file.
  const [soulText, setSoulText] = useState("");
  const [soulDraft, setSoulDraft] = useState("");
  const [editSoul, setEditSoul] = useState(false);
  const [soulBusy, setSoulBusy] = useState(false);
  useEffect(() => {
    let live = true;
    // Un-added catalog apps have no soul.md yet — fall back to the soul shipped
    // in the catalog so the card is pre-filled before the user even connects.
    const fallback = connect?.soul ?? "";
    invoke<{ soul?: string }>("engine_app_get_soul", { id: app.id })
      .then((r) => { if (live) setSoulText((typeof r?.soul === "string" && r.soul) ? r.soul : fallback); })
      .catch(() => { if (live) setSoulText(fallback); });
    return () => { live = false; };
  }, [app.id, connect?.soul]);
  // If we just implicitly connected this app to start a learn, pick the goal
  // back up and open the learn flow straight away.
  useEffect(() => {
    if (pendingAutolearn && pendingAutolearn.id === app.id && !connect) {
      setGoalText(pendingAutolearn.goal);
      setComposing(false);
      setLearnMode("learn");
      pendingAutolearn = null;
    }
  }, [app.id, connect]);
  const openSoulEditor = useCallback(() => { setSoulDraft(soulText); setEditSoul(true); }, [soulText]);
  const saveSoul = useCallback(async () => {
    setSoulBusy(true);
    try {
      const r = await invoke<{ ok?: boolean; soul?: string }>("engine_app_set_soul", { id: app.id, soul: soulDraft });
      if (r?.ok !== false) { setSoulText(typeof r?.soul === "string" ? r.soul : soulDraft.trim()); setEditSoul(false); }
    } catch { /* leave editor open on failure */ } finally { setSoulBusy(false); }
  }, [app.id, soulDraft]);
  // After a successful learn, capture the FOLDER + FREQUENCY the user described
  // in plain English (e.g. "...file under Travel, check monthly") and apply them
  // — so the conversation sets the config, not separate forms.
  const applyLearnedConfig = useCallback(async (goal: string) => {
    const text = (goal || "").toLowerCase();
    if (!text.trim()) return;
    const freq: Array<[RegExp, string]> = [
      [/\b(hourly|every hour)\b/, "hourly"],
      [/\b(daily|every day|each day)\b/, "daily"],
      [/\b(weekly|every week|each week)\b/, "weekly"],
      [/\b(monthly|every month|each month)\b/, "30d"],
    ];
    for (const [re, every] of freq) {
      if (re.test(text)) { try { await invoke("engine_app_set_schedule", { id: app.id, every, at: null, on: null }); } catch { /* best effort */ } break; }
    }
    try {
      const ds = await invoke<{ name: string }[]>("scan_vault", { path: vaultPath });
      const names = (ds ?? []).map((d) => d.name.toLowerCase());
      const hit = names.find((n) => new RegExp(`\\b${n.replace(/[^a-z0-9]/g, "")}\\b`).test(text.replace(/[^a-z0-9 ]/g, "")));
      const have = (app.domains ?? []).map((d) => d.toLowerCase());
      if (hit && !have.includes(hit)) {
        await invoke("engine_app_set_domains", { id: app.id, domains: [...(app.domains ?? []), hit] });
      }
    } catch { /* domains optional */ }
    window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
    await onReload();
  }, [app.id, app.domains, vaultPath, onReload]);
  // Optional one-time convenience: copy the user's EXISTING Chrome login for this
  // site into the connector's isolated profile (Chrome must be quit), so they
  // skip even the one sign-in. Scoped to this site only.
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importLogins = useCallback(async () => {
    setImporting(true); setImportMsg(null);
    let host = "";
    try { host = new URL(appWebsite(app)).hostname; } catch { /* derive in CLI */ }
    try {
      const r = await invoke<{ ok: boolean; message?: string; imported?: number }>("engine_connector_import_login", { id: app.id, host });
      setImportMsg(r.ok ? `✓ ${r.message ?? "imported"}` : `✗ ${r.message ?? "failed"}`);
    } catch (e) { setImportMsg(`✗ ${String(e).slice(0, 160)}`); }
    finally { setImporting(false); }
  }, [app.id, app]);
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
  // The engine validates: hourly, <N>h (2..23), <N>d (1..90), <N>w (1..12),
  // daily, weekly - with optional `at` (HH:MM) and `on` (mon..sun). The editor
  // models this as a "mode" + a count so flexible/multi-day cadences are back.
  type SchedMode = "off" | "hourly" | "hours" | "days" | "weeks" | "daily" | "weekly";
  // Turn the saved `every` (e.g. "daily", "3d", "12h", "2w") into the editor's
  // mode + numeric count so the editor pre-populates from the current schedule.
  const parseSchedule = (r: EngineApp["refresh"]): { mode: SchedMode; n: number } => {
    const every = (r?.every ?? "").toLowerCase().trim();
    if (!r || !every || every === "off") return { mode: "off", n: 1 };
    if (every === "hourly") return { mode: "hourly", n: 1 };
    if (every === "daily") return { mode: "daily", n: 1 };
    if (every === "weekly") return { mode: "weekly", n: 1 };
    const m = /^(\d+)([hdw])$/.exec(every);
    if (m) {
      const n = Number(m[1]);
      if (m[2] === "h") return { mode: "hours", n };
      if (m[2] === "d") return { mode: "days", n };
      return { mode: "weeks", n };
    }
    return { mode: "daily", n: 1 };
  };
  const [schedOpen, setSchedOpen] = useState(false); // compact schedule+sync popup
  const initialSched = parseSchedule(app.refresh);
  const [schedMode, setSchedMode] = useState<SchedMode>(initialSched.mode);
  const [schedN, setSchedN] = useState(initialSched.n);
  const [schedAt, setSchedAt] = useState(app.refresh?.at ?? "");
  const [schedOn, setSchedOn] = useState(app.refresh?.on ?? "");
  const [schedBusy, setSchedBusy] = useState(false);
  // Clamp the count to the engine's accepted range for the active mode, then
  // build the `every` string it expects.
  const clampN = (mode: SchedMode, n: number): number => {
    if (mode === "hours") return Math.min(23, Math.max(2, n || 2));
    if (mode === "days") return Math.min(90, Math.max(1, n || 1));
    if (mode === "weeks") return Math.min(12, Math.max(1, n || 1));
    return n;
  };
  const everyString = (mode: SchedMode, n: number): string => {
    switch (mode) {
      case "hourly": return "hourly";
      case "hours": return `${clampN("hours", n)}h`;
      case "days": return `${clampN("days", n)}d`;
      case "weeks": return `${clampN("weeks", n)}w`;
      case "daily": return "daily";
      case "weekly": return "weekly";
      default: return "off";
    }
  };
  const saveSchedule = async (clear?: boolean) => {
    setSchedBusy(true);
    try {
      const every = clear ? "off" : everyString(schedMode, schedN);
      const wantsAt = !clear && (schedMode === "daily" || schedMode === "weekly");
      const wantsOn = !clear && schedMode === "weekly";
      await invoke("engine_app_set_schedule", {
        id: app.id,
        every,
        at: wantsAt && schedAt ? schedAt : null,
        on: wantsOn && schedOn ? schedOn : null,
      });
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
      await onReload();
    } catch (e) { console.error("set schedule", e); }
    finally { setSchedBusy(false); }
  };
  // Open the compact schedule+sync popup, seeding the form from the current
  // cadence (Schedule and Sync live here, away from Domains).
  const openSchedModal = () => {
    const p = parseSchedule(app.refresh);
    setSchedMode(p.mode === "off" ? "daily" : p.mode);
    setSchedN(p.n);
    setSchedAt(app.refresh?.at ?? "");
    setSchedOn(app.refresh?.on ?? "");
    setSchedOpen(true);
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
  // Browser-method connectors authorize by opening a REAL browser the user logs
  // into (the browser equivalent of OAuth's "Sign in"). engine_app_browser_login
  // is a long-running Tauri command that opens the browser; when it returns we run
  // the same verify sync the other auth flows do.
  const isBrowser = integ === "browser" || integ === "playwright";
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
  // The "learned lane": browser apps, un-configured manual apps, or anything that
  // already has a recorded skill. For these, the agentic Learn flow IS the setup —
  // so the legacy METHOD / RE-EVALUATE / WHAT-TO-PULL config is redundant and hidden.
  // Real API/OAuth/CLI/MCP apps still show it (the method genuinely matters there).
  const learnedLane = isBrowser || integ === "manual" || integ === "" || skills.length > 0;
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const runSync = async () => {
    // Gateway syncs run a live agent turn that can take a minute or two, so say
    // so plainly - the old bare spinner read as a freeze.
    setSyncMsg(gatewayProvider
      ? `Pulling fresh data from ${app.title || app.id}… this runs a live fetch and can take a minute or two. You can keep working.`
      : `Pulling fresh data from ${app.title || app.id}…`);
    const before = 0;
    try {
      const r = await onSync();
      // Honest result: the engine reports ok=false (with a reason) when auth
      // failed or nothing was pulled. Surface that instead of a fake "Synced".
      if (r && r.ok === false) {
        setSyncMsg(`Sync failed: ${r.error ? r.error.slice(0, 200) : "no data was pulled (check the connection)."}`);
        return;
      }
      // onReload (via the parent) refreshes app.lastSuccessTs, which re-runs the
      // app_data_files effect; report the count we can see now as a best effort.
      const files = await invoke<{ path: string; name: string; bytes: number; mtime: number }[]>("app_data_files", { vault: vaultPath, appId: app.id }).catch(() => null);
      const n = Array.isArray(files) ? files.length : before;
      setSyncMsg(`Synced - ${n} file${n === 1 ? "" : "s"}.`);
    } catch (e) {
      setSyncMsg(`Sync failed: ${String(e).slice(0, 200)}`);
    }
  };
  const humanizeSkill = (sid: string) => sid.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const domainsLine = (app.domains ?? []).map(titleCase).join(", ");
  const card = "rounded-xl border border-border-subtle bg-background/50 p-5";
  const notConnected = !!connect;
  const ConnectBtn = ({ label }: { label: string }) => (
    <button onClick={() => connect?.onConnect()} disabled={connect?.connecting}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-60">
      {connect?.connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {connect?.connecting ? "Connecting…" : label}
    </button>
  );
  return (
    <div className="bg-surface pb-2">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-4 px-6 pb-5 pt-5">
        <AppRowLogo app={app} logos={logos} size={52} fallback="letter" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="truncate text-2xl font-bold tracking-tight text-text-primary">{app.title || app.id}</h2>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${meta.ring} ${meta.tint}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${status === "connecting" ? "animate-pulse" : ""}`} />
              {meta.label}
            </span>
            {gatewayProvider && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                <Check className="h-2.5 w-2.5" /> via {titleCase(gatewayProvider)}
              </span>
            )}
            {!gatewayProvider && !learnedLane && <span className="rounded border border-border-subtle px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-text-muted">{methodLabel(app.integration)}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-text-muted">
            {domainsLine && <span className="inline-flex items-center gap-1"><Globe className="h-3.5 w-3.5" /> {domainsLine}</span>}
            {domainsLine && <span>·</span>}
            <button onClick={() => void openUrl(appWebsite(app))} className="inline-flex items-center gap-1 hover:text-accent">
              Visit {app.title || app.id} <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => toggleFavorite(favKey)} title={isFav ? "On your home screen — click to remove" : "Add to your home screen"} aria-pressed={isFav}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${isFav ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"}`}>
            <Star className={`h-4 w-4 ${isFav ? "fill-accent" : ""}`} />
          </button>
          {notConnected ? (
            <ConnectBtn label="Connect" />
          ) : (
            <button onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-app", { detail: app }))} title="Open in chat"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-background hover:bg-accent-hover">
              <MessageSquare className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Even two-column grid — row 1: About | Browser Sync, row 2: Learned Skills | Schedule */}
      <div className="grid grid-cols-1 items-stretch gap-4 px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Soul (top-left) — same construct domains use */}
        <div className={`${card} flex h-full flex-col`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Sparkles className="h-4 w-4 text-accent" /> Soul</h3>
            {!editSoul && <button onClick={openSoulEditor} title="Edit soul" className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:border-accent-border hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>}
          </div>
          {editSoul ? (
            <div className="mt-2 flex flex-1 flex-col">
              <textarea autoFocus rows={4} value={soulDraft} onChange={(e) => setSoulDraft(e.target.value)}
                placeholder={`Why ${app.title || app.id} is in your harness — what it feeds your world.`}
                className="w-full flex-1 resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted/60 focus:border-accent-border focus:outline-none" />
              <div className="mt-2 flex items-center gap-2">
                <button onClick={saveSoul} disabled={soulBusy} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{soulBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save</button>
                <button onClick={() => setEditSoul(false)} className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary">Cancel</button>
                <span className="ml-auto font-mono text-[10px] text-text-muted/70">apps/{app.id}/soul.md</span>
              </div>
            </div>
          ) : soulText.trim() ? (
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">{soulText.trim()}</p>
          ) : (
            <button onClick={openSoulEditor} className="mt-2 flex flex-1 flex-col items-start justify-center rounded-lg border border-dashed border-border bg-surface/40 px-4 py-5 text-left hover:border-accent-border">
              <span className="text-[13px] text-text-secondary">Give {app.title || app.id} a soul.</span>
              <span className="mt-0.5 text-[12px] text-text-muted">Why it's in your harness — your AI reads this as standing context.</span>
            </button>
          )}
        </div>

        {/* Browser Sync (top-right) */}
        {!gatewayProvider ? (
          <div className={`${card} flex h-full flex-col`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Globe className="h-4 w-4 text-accent" /> Browser Sync</div>
              <HelpCircle className="h-4 w-4 text-text-muted/70" />
            </div>
            <div className="flex flex-1 flex-col justify-center">
              <div className="my-4 flex items-center justify-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-border-subtle bg-white"><ChromeLogo size={28} /></span>
                <span className="font-mono text-text-muted/50">·····</span>
                <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-accent-border bg-accent-soft text-accent"><Sparkles className="h-6 w-6" /></span>
              </div>
              {notConnected ? (
                <p className="text-center text-[12px] leading-snug text-text-muted">Log in once in your own Chrome — the agent learns how to fetch your data, then replays it automatically.</p>
              ) : (
                <div className="flex flex-col items-center">
                  <button onClick={importLogins} disabled={importing}
                    title="Already signed into this site in Chrome? Import that login (quit Chrome first) so you skip signing in."
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
                    {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} {importing ? "Importing…" : "Import login"}
                  </button>
                  {importMsg && <p className={`mt-1.5 text-center text-[11px] ${importMsg.startsWith("✓") ? "text-ok" : "text-danger"}`}>{importMsg}</p>}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden lg:block" />
        )}

        {/* Learned Skills (bottom-left) */}
        <div className={`${card} h-full`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Sparkles className="h-4 w-4 text-accent" /> Learned Skills{skills.length > 0 && <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-muted">{skills.length}</span>}</div>
              {!learnMode && !composing && (
                <button onClick={() => { setGoalText(""); setComposing(true); }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10">
                  <Plus className="h-3.5 w-3.5" /> Learn New Skill
                </button>
              )}
            </div>
            {!gatewayProvider && (
              <p className="mt-1.5 text-[12px] text-text-muted">Skills are actions Prevail learned to do for you on {app.title || app.id} — taught once, replayed automatically.</p>
            )}

            {learnMode ? (
              <div className="mt-3">
                <ConnectorRunPanel appId={app.id} mode={learnMode} goal={goalText || undefined} url={appWebsite(app)}
                  onDone={(ok) => { void onReload(); loadSkills(); if (ok) { void applyLearnedConfig(goalText); setLearnMode(null); } }}
                  onClose={() => setLearnMode(null)} />
              </div>
            ) : composing ? (
              <div className="mt-3 space-y-2 rounded-lg border border-border-subtle bg-surface p-3">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary"><Sparkles className="h-4 w-4 text-accent" /> Tell me what to fetch</div>
                <textarea autoFocus rows={3} value={goalText} onChange={(e) => setGoalText(e.target.value)}
                  placeholder={'e.g. "Download my booking confirmations, file them under Travel, and check monthly."'}
                  className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-muted/60 focus:border-accent-border focus:outline-none" />
                <div className="flex items-center gap-2">
                  <button onClick={() => {
                    if (notConnected && connect) { pendingAutolearn = { id: app.id, goal: goalText }; connect.onConnect(); return; }
                    setComposing(false); setLearnMode("learn");
                  }} disabled={!goalText.trim() || (notConnected && connect?.connecting)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-40">{notConnected && connect?.connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Start learning</button>
                  <button onClick={() => setComposing(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
                </div>
                <p className="text-[11px] text-text-muted">Your Chrome opens — log in once. I'll learn the steps + remember the folder and cadence from what you said.</p>
              </div>
            ) : skills.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-border bg-surface/40 px-4 py-6 text-center">
                <div className="text-[13px] text-text-secondary">No skills yet.</div>
                <div className="mt-0.5 text-[12px] text-text-muted">Click <span className="text-accent">Learn New Skill</span>, say what to fetch{notConnected ? " — I'll connect and learn it in one go." : <> — saved in <code className="rounded bg-surface-warm px-1 font-mono text-[11px]">vault/apps/{app.id}/skills/</code></>}</div>
              </div>
            ) : (
              <ul className="mt-3 space-y-2">
                {skills.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Sparkles className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-text-primary">{humanizeSkill(s.id)}</div>
                      <div className="text-[11px] text-text-muted">{s.runner === "browser" ? "Browser skill" : s.runner}{s.trigger ? ` · ${s.trigger}` : ""}</div>
                    </div>
                    <span className="hidden items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ok sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-ok" /> ready</span>
                    <button onClick={() => setLearnMode("replay")} disabled={!!learnMode}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
                      <Play className="h-3 w-3" /> Run now
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>

        {/* Schedule / Domains / Status (bottom-right) */}
        <div className={`${card} h-full`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Tag className="h-4 w-4 text-accent" /> Domains fed</div>
              {!editDomains && !notConnected && <button onClick={openDomainEditor} title="Edit domains" className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:border-accent-border hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>}
            </div>
            <div className="mt-3">
              {!editDomains ? (
                <div className="flex flex-wrap gap-1.5">
                  {(app.domains ?? []).length ? (app.domains).map((d) => (
                    <button key={d} onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: d }))} className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] text-text-secondary hover:border-accent-border hover:text-accent">{titleCase(d)}</button>
                  )) : <span className="text-[12px] text-text-muted">none yet</span>}
                </div>
              ) : (
                <div>
                  <div className="flex flex-wrap gap-1.5">
                    {(allDomains.length ? allDomains : [...domSel]).map((d) => { const on = domSel.has(d); return (
                      <button key={d} onClick={() => setDomSel((cur) => { const n = new Set(cur); n.has(d) ? n.delete(d) : n.add(d); return n; })} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${on ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-surface text-text-muted hover:text-text-secondary"}`}>{titleCase(d)}</button>
                    ); })}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={saveDomains} disabled={domBusy} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{domBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save</button>
                    <button onClick={() => setEditDomains(false)} className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
      </div>

      {/* Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-6 py-4">
        {notConnected ? (
          <span className="inline-flex items-center gap-2.5 text-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-border text-text-muted"><Plug className="h-4 w-4" /></span>
            <span><span className="font-medium text-text-primary">Not connected yet.</span> <span className="text-text-muted">Connect to start feeding {app.title || app.id} into your vault.</span></span>
          </span>
        ) : syncMsg ? (
          <span className={`inline-flex items-center gap-2 text-sm ${syncMsg.startsWith("Sync failed") ? "text-danger" : "text-text-secondary"}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-ok" />} {syncMsg}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2.5 text-sm">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${status === "connected" ? "border-ok/50 text-ok" : "border-border text-text-muted"}`}><Check className="h-4 w-4" /></span>
            <span><span className="font-medium text-text-primary">{status === "connected" ? "All set!" : "Almost there"}</span> <span className="text-text-muted">We'll keep your {app.title || app.id} data up to date.</span></span>
          </span>
        )}
        {notConnected ? null : confirmDelete ? (
          <span className="flex items-center gap-2">
            <button onClick={removeApp} disabled={deleting} className="inline-flex items-center gap-1.5 rounded-md border border-danger/50 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger hover:bg-danger/20 disabled:opacity-50">{deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete {app.title} for good</button>
            <button onClick={() => { setConfirmDelete(false); setDeleteErr(null); }} className="text-[11px] text-text-muted hover:text-text-secondary">cancel</button>
            {deleteErr && <span className="text-[11px] text-danger">{deleteErr}</span>}
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            <button onClick={() => void runSync()} disabled={busy} title="Sync now" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {busy ? "Syncing…" : "Sync"}</button>
            <button onClick={openSchedModal} title={`Schedule & sync — ${scheduleLabel(app.refresh)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-accent-border hover:text-accent"><Clock className="h-3.5 w-3.5" /> Schedule{enabled && app.refresh ? <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-ok" /> : null}</button>
            {app.path && <button onClick={() => void invoke("open_in_finder", { path: app.path! }).catch(() => {})} title="Open folder" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted hover:border-accent-border hover:text-accent"><FolderOpen className="h-4 w-4" /></button>}
            <button onClick={() => setConfirmDelete(true)} title="Remove this app entirely" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
          </div>
        )}
      </div>

      {/* Compact Schedule & sync popup (kept apart from Domains) */}
      {schedOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSchedOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xs rounded-xl border border-border bg-background p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Clock className="h-4 w-4 text-accent" /> Schedule &amp; sync</div>
              <button onClick={() => setSchedOpen(false)} title="Close" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <select value={schedMode} onChange={(e) => setSchedMode(e.target.value as SchedMode)} className="rounded-md border border-border bg-surface px-2 py-1 text-xs focus:border-accent-border focus:outline-none">
                <option value="off">Off</option><option value="hourly">Hourly</option><option value="hours">Every N hours</option><option value="days">Every N days</option><option value="weeks">Every N weeks</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
              </select>
              {(schedMode === "hours" || schedMode === "days" || schedMode === "weeks") && (
                <input type="number" min={schedMode === "hours" ? 2 : 1} max={schedMode === "hours" ? 23 : schedMode === "days" ? 90 : 12} value={schedN} onChange={(e) => setSchedN(Number(e.target.value))} onBlur={() => setSchedN((n) => clampN(schedMode, n))} className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-xs focus:border-accent-border focus:outline-none" />
              )}
              {(schedMode === "daily" || schedMode === "weekly") && (
                <input type="time" value={schedAt} onChange={(e) => setSchedAt(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1 text-xs focus:border-accent-border focus:outline-none" />
              )}
              {schedMode === "weekly" && (
                <select value={schedOn} onChange={(e) => setSchedOn(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1 text-xs focus:border-accent-border focus:outline-none">
                  <option value="">any day</option>{["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
                </select>
              )}
            </div>
            <label className="mt-3 flex cursor-pointer items-center justify-between gap-2 border-t border-border-subtle pt-3">
              <span className="text-[13px] text-text-secondary">Scheduled sync</span>
              <Toggle on={enabled} onChange={onSetEnabled} label={`${app.title} scheduled sync`} />
            </label>
            <div className="mt-1.5 space-y-0.5 text-[11px] text-text-muted">
              <div>Last run: {app.lastSuccessTs ? relTime(app.lastSuccessTs) : "never"}</div>
              {app.nextDueTs ? <div>Next run: {relTime(app.nextDueTs)}</div> : null}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button onClick={async () => { await saveSchedule(schedMode === "off"); setSchedOpen(false); }} disabled={schedBusy} className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{schedBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save</button>
              <button onClick={() => setSchedOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className="min-w-0 flex-1 text-text-secondary">{children}</span>
    </div>
  );
}
