// Apps - the data-inflow surface. An app is "working" only if it's reliably
// refreshing the vault on a schedule, so this page's whole job is to make that
// UNMISTAKABLE: every app shows one color-coded status, the method it connects
// by, when it last synced and when it syncs next, and which domains it feeds.
// Connecting a new app is a single goal sentence (the Connection Agent figures
// out the method) - not a wall of forms. See docs/APPS-REDESIGN.md.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowUpRight, Boxes, Check, ChevronLeft, ChevronRight, Clock, Download, ExternalLink, FileText, FolderOpen, Globe, HelpCircle, Link2, Loader2, MessageSquare, MoreVertical, Pencil, Play, Plug, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Star, Tag, Terminal, Trash2, X, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MasterDetail } from "./masterdetail";
import { ConnectorRunPanel, type ConnectorRunMode } from "./connectorrun";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, listen } from "./bridge";
import { appName, relTime, titleCase } from "./format";
import { PREF, getPref, lsGet, lsSet } from "./storage";
import { Toggle } from "./ui";
import { ConnectAppFlow } from "./appconnect";
import { AppRowLogo } from "./panels3";
import { GoogleWorkspacePanel } from "./googlepanel";
import { favKeyOf, toggleFavorite, useFavorites } from "./appfavorites";
import type { BrandLogo, CatalogApp, CatalogSkill, ChatEvent, ConnectorCatalog, DomainContextBundle, EngineApp } from "./types";

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
  attention:    { glyph: "▲", label: "Needs attention", tint: "text-err",     ring: "border-err/40", dot: "bg-err" },
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

// The connection LANES the user thinks in: an official CLI, or a direct app
// connection (api / oauth / agentic browser). Works for both catalog entries
// (pattern/via) and installed apps (integration).
// NOTE (fix #9): we used to surface an "Aggregators" lane keyed off `via:
// "plaid"`, but that tagged the ~28 BANKS that connect THROUGH Plaid as
// aggregators, not Plaid itself. A bank is not an aggregator; the aggregator is
// the one app (Plaid) that pulls data across many accounts. With Plaid being
// effectively the only true aggregator in the catalog, a dedicated tab just
// added a confusing, near-empty filter, so the lane was dropped. Plaid-backed
// banks now classify as "direct" like any other directly-fetched app.
export type AppLane = "cli" | "direct" | "mcp";
function laneOf(a: { pattern?: string; via?: string; integration?: string; gateway?: unknown | null; connection_hint?: { method?: string } }): AppLane {
  // MCP first: a catalog entry declares it via connection_hint.method, an
  // installed app via its integration id ("mcp"). Check before cli/direct so an
  // MCP server is never miscategorized as a generic Direct app.
  if (a.connection_hint?.method === "mcp" || (a.integration || "").toLowerCase().includes("mcp")) return "mcp";
  const p = (a.pattern || a.integration || "").toLowerCase();
  if (p.includes("cli")) return "cli";
  return "direct"; // api / oauth / browser / plaid-backed
}
export const LANE_FILTERS: { key: "all" | AppLane; label: string }[] = [
  { key: "all", label: "All" },
  { key: "cli", label: "CLI" },
  { key: "direct", label: "Direct" },
  { key: "mcp", label: "MCP" },
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

// The ONE primary connection method an app uses, so every app reads at a glance
// as exactly one of: CLI, Browser, API, MCP, or Manual. A few connectors could
// technically do more than one; we deliberately collapse to the favored/active
// one rather than surface a confusing multi-badge.
export type AppMethod = "cli" | "browser" | "api" | "mcp" | "manual";
export function methodOf(a: { id?: string; name?: string; title?: string; iconSlug?: string; pattern?: string; via?: string; integration?: string; connection_hint?: { method?: string } }): AppMethod {
  const s = `${(a.connection_hint?.method || "")} ${(a.integration || a.pattern || a.via || "")}`.toLowerCase();
  // #45: Google connects through the gws CLI - one connection fronts the whole
  // Workspace (Gmail, Calendar, Drive, …). The unified entry is id/title/name
  // "google"; a stale manual scaffold may carry integration "manual", and the
  // manifest also marks it google_workspace. Classify any of those as CLI so the
  // row/detail never mislabels Google as "Manual".
  const ident = (a.id || a.title || a.name || "").trim().toLowerCase();
  if (ident === "google" || s.includes("google_workspace") || /\bgws\b/.test(s)) return "cli";
  if (s.includes("mcp") || s.includes("composio")) return "mcp";
  if (s.includes("browser") || s.includes("playwright")) return "browser";
  if (s.includes("cli")) return "cli";
  if (s.includes("api") || s.includes("http") || s.includes("oauth")) return "api";
  return "manual";
}
// Icon + tinted color per method, so the method is recognizable by shape AND
// hue, not just text. Manual stays neutral (it is the "nothing automated" case).
const METHOD_META: Record<AppMethod, { label: string; Icon: LucideIcon; cls: string }> = {
  cli:     { label: "CLI",     Icon: Terminal, cls: "border-violet-400/30 bg-violet-500/10 text-violet-600 dark:text-violet-300" },
  browser: { label: "Browser", Icon: Globe,    cls: "border-sky-400/30 bg-sky-500/10 text-sky-600 dark:text-sky-300" },
  api:     { label: "API",     Icon: Plug,     cls: "border-teal-400/30 bg-teal-500/10 text-teal-600 dark:text-teal-300" },
  mcp:     { label: "MCP",     Icon: Boxes,    cls: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300" },
  manual:  { label: "Manual",  Icon: Pencil,   cls: "border-border-subtle bg-surface-warm text-text-muted" },
};
function MethodBadge({ method, className = "" }: { method: AppMethod; className?: string }) {
  const m = METHOD_META[method];
  const Icon = m.Icon;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider ${m.cls} ${className}`}>
      <Icon className="h-2.5 w-2.5" /> {m.label}
    </span>
  );
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

// The three aggregator/gateway connectors are single catalog entries that, when
// picked, route to their own gateway flow rather than the generic Connect path:
// Composio / Nango open the existing managed-gateway panes (one key fronts all
// of that gateway's integrations), and Zapier opens the "Add custom MCP" modal
// prefilled for the Zapier MCP server (the user pastes their mcp.zapier.com URL).
function gatewayAppKind(c: { name?: string | null; iconSlug?: string | null }): "composio" | "nango" | "zapier" | null {
  const k = (c.iconSlug || c.name || "").trim().toLowerCase();
  if (k === "composio") return "composio";
  if (k === "nango") return "nango";
  if (k === "zapier") return "zapier";
  return null;
}

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
  // Lane filter: All / CLI / Direct.
  const [lane, setLane] = useState<"all" | AppLane>("all");
  // Collapsible left-list sections (fix #4). "My list" starts COLLAPSED for a
  // cleaner initial view; "Available to add" starts open. Both persist.
  const [myListOpen, setMyListOpen] = useState(() => { try { return localStorage.getItem("prevail.apps.myListOpen") === "1"; } catch { return false; } });
  const [availOpen, setAvailOpen] = useState(() => { try { return localStorage.getItem("prevail.apps.availOpen") !== "0"; } catch { return true; } });
  const toggleMyList = useCallback(() => setMyListOpen((v) => { const n = !v; try { localStorage.setItem("prevail.apps.myListOpen", n ? "1" : "0"); } catch { /* ignore */ } return n; }), []);
  const toggleAvail = useCallback(() => setAvailOpen((v) => { const n = !v; try { localStorage.setItem("prevail.apps.availOpen", n ? "1" : "0"); } catch { /* ignore */ } return n; }), []);
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
  // When a gateway connector (Composio / Nango) is picked, its managed-gateway
  // pane takes over the right detail (one key fronts all that gateway's apps).
  // Selecting any other row clears this so the normal detail returns.
  const [gatewayPane, setGatewayPane] = useState<"composio" | "nango" | null>(null);
  // "Add custom MCP": a small modal that scaffolds any stdio MCP server the user
  // names, passing its spawn command (and optional one-time install) to the
  // engine the same way a catalog MCP entry does. The vault domain list backs
  // the picker (same source the AppDetail domain editor uses: scan_vault).
  const [mcpFormOpen, setMcpFormOpen] = useState(false);
  const [mcpForm, setMcpForm] = useState({ name: "", command: "", install: "", domain: "" });
  const [mcpFormBusy, setMcpFormBusy] = useState(false);
  const [mcpFormErr, setMcpFormErr] = useState<string | null>(null);
  const [vaultDomains, setVaultDomains] = useState<string[]>([]);
  const openMcpForm = useCallback(async () => {
    setMcpForm({ name: "", command: "", install: "", domain: "" });
    setMcpFormErr(null);
    setMcpFormOpen(true);
    if (vaultDomains.length === 0) {
      try {
        const ds = await invoke<{ name: string }[]>("scan_vault", { path: vaultPath });
        setVaultDomains((ds ?? []).map((d) => d.name.toLowerCase()).sort());
      } catch { /* domains optional - the picker just stays empty */ }
    }
  }, [vaultDomains.length, vaultPath]);

  // Zapier connects through its hosted MCP server (mcp.zapier.com), not a stdio
  // binary, so we reuse the "Add custom MCP" modal prefilled to bridge that
  // remote endpoint via mcp-remote. The user pastes their own Zapier MCP URL
  // (which carries their key) in place of the placeholder, then adds the server.
  const openZapierMcpForm = useCallback(async () => {
    setMcpForm({
      name: "Zapier",
      command: "npx -y mcp-remote https://mcp.zapier.com/api/mcp/s/YOUR_KEY/mcp",
      install: "",
      domain: "",
    });
    setMcpFormErr(null);
    setMcpFormOpen(true);
    if (vaultDomains.length === 0) {
      try {
        const ds = await invoke<{ name: string }[]>("scan_vault", { path: vaultPath });
        setVaultDomains((ds ?? []).map((d) => d.name.toLowerCase()).sort());
      } catch { /* domains optional */ }
    }
  }, [vaultDomains.length, vaultPath]);

  // Pick a catalog app: gateway connectors route to their own flow, everything
  // else opens the standard connect detail. Used by every catalog row so the
  // routing is identical wherever a catalog entry is shown.
  const selectCatalogApp = useCallback((c: CatalogApp) => {
    const kind = gatewayAppKind(c);
    if (kind === "composio" || kind === "nango") {
      setGatewayPane(kind); setCatalogPick(null); setSelected(null); setConnecting(false);
      return;
    }
    if (kind === "zapier") {
      setGatewayPane(null); setCatalogPick(null); setConnecting(false);
      void openZapierMcpForm();
      return;
    }
    setGatewayPane(null); setCatalogPick(c); setConnecting(false);
  }, [openZapierMcpForm]);

  const reload = useCallback(async (): Promise<EngineApp[]> => {
    try {
      const list = await invoke<EngineApp[]>("engine_apps_list", { vault: vaultPath });
      const next = Array.isArray(list) ? list.map((x) => ({ ...x, title: appName(x.title) })) : [];
      setApps(next);
      // Default selection: keep the current one if it still exists, else the
      // first DIRECT app (the shared `selected` drives the Direct pane; gateway
      // apps have their own mode + selection, so they must not become the default).
      setSelected((cur) => (cur && next.some((a) => a.id === cur) ? cur : (next.find((a) => !a.gateway)?.id ?? next[0]?.id ?? null)));
      return next;
    } catch { setApps([]); return []; }
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
      // For an MCP server, carry the stdio spawn command (and optional one-time
      // install) down to the engine so the connector knows how to launch it.
      const isMcp = c.connection_hint?.method === "mcp";
      const mcpCommand = isMcp ? c.connection_hint?.command : undefined;
      const mcpInstall = isMcp ? c.connection_hint?.install : undefined;
      try {
        await invoke("engine_app_add", { vault: vaultPath, id, title: c.name, integration, domains, mcpCommand, mcpInstall });
      } catch (e) {
        // Already installed: just open it. Anything else is a real failure.
        if (!/already exists/i.test(String(e))) throw e;
      }
      // Wire the catalog-shipped soul into the new app's soul.md at add-time.
      if (c.soul) { try { await invoke("engine_app_set_soul", { id, soul: c.soul }); } catch { /* soul is best-effort */ } }
      const after = await reload();
      // Only focus the app if it actually persisted. A locked vault accepts the
      // add call but writes nothing readable, so the app never appears in the
      // list. Selecting that ghost id used to blank the whole pane; instead we
      // keep the picked app in view and explain what to do.
      const added = after.find((a) => a.id === id) ?? after.find((a) => appName(a.title).toLowerCase() === c.name.toLowerCase());
      if (added) {
        setCatalogPick(null); setConnecting(false);
        setSelected(added.id);
      } else {
        setConnecting(false);
        setCatalogConnectErr(`Couldn't add ${c.name}. If your vault is locked (see the status bar), unlock it first, then connect.`);
        // Keep catalogPick set so the detail stays on this app rather than going blank.
      }
    } catch (e) {
      setCatalogConnectErr(`Couldn't add ${c.name}: ${String(e).slice(0, 160)}`);
    } finally {
      setCatalogConnecting(false);
    }
  }, [reload, vaultPath]);

  // Scaffold a custom MCP server from the modal: derive an id from the name,
  // add it as an "mcp" integration carrying its spawn command, then reload and
  // select it (mirrors connectCatalogApp's guarded selection so a locked vault
  // that writes nothing never blanks the pane).
  const addCustomMcp = useCallback(async () => {
    const title = mcpForm.name.trim();
    const command = mcpForm.command.trim();
    const install = mcpForm.install.trim();
    if (!title) { setMcpFormErr("Give the server a name."); return; }
    if (!command) { setMcpFormErr("Enter the command Prevail should run to start the server."); return; }
    setMcpFormBusy(true);
    setMcpFormErr(null);
    try {
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "mcp-server";
      const domains = mcpForm.domain ? [mcpForm.domain] : [];
      try {
        await invoke("engine_app_add", { vault: vaultPath, id, title, integration: "mcp", domains, mcpCommand: command, mcpInstall: install || undefined });
      } catch (e) {
        if (!/already exists/i.test(String(e))) throw e;
      }
      const after = await reload();
      const added = after.find((a) => a.id === id) ?? after.find((a) => appName(a.title).toLowerCase() === title.toLowerCase());
      if (added) {
        setMcpFormOpen(false);
        setCatalogPick(null); setConnecting(false);
        setSelected(added.id);
      } else {
        setMcpFormErr(`Couldn't add ${title}. If your vault is locked (see the status bar), unlock it first, then try again.`);
      }
    } catch (e) {
      setMcpFormErr(`Couldn't add ${title}: ${String(e).slice(0, 160)}`);
    } finally {
      setMcpFormBusy(false);
    }
  }, [mcpForm, reload, vaultPath]);

  // Direct mode shows ONLY directly-connected apps. Gateway apps (Composio /
  // Nango) live in their own modes and must never leak into the Direct list -
  // so everything the Direct branch renders (list, "my list", counts, detail)
  // is derived from this gateway-free slice, not the raw `apps`.
  // Google is NOT special here: until it's scaffolded to disk it lives in the
  // catalog ("Available to add") like every other connector - it's the single
  // unified `gws` entry (see catalog.json). Selecting it opens the multi-profile
  // panel, and scaffolding (on favorite or "Connect for the agent") turns it
  // into a real vault app that then shows in this list like any installed app.
  // Favorites ("my list") drive both the home sidebar and the de-dup below, so the
  // store is read here (hoisted above the list memos) - a pinned app is shown once,
  // in My list, and excluded from the status groups / catalog below (#39).
  const favs = useFavorites();
  const isPinnedApp = useCallback(
    (a: { id?: string; title?: string | null; name?: string }) =>
      favs.has(favKeyOf(a.title || a.name || a.id || "")) || favs.has(favKeyOf(a.id || "")),
    [favs],
  );
  const directApps = useMemo(() => {
    const all = (apps ?? []).filter((a) => !a.gateway);
    // #45: collapse any duplicate ids (e.g. a stale manual "google" alongside the
    // gws one) to a single entry, preferring the one with a real method over a
    // manual stale dup so Google always reads as its CLI connection.
    const byId = new Map<string, EngineApp>();
    for (const a of all) {
      const prev = byId.get(a.id);
      if (!prev) { byId.set(a.id, a); continue; }
      byId.set(a.id, methodOf(prev) === "manual" ? a : prev);
    }
    return [...byId.values()];
  }, [apps]);
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
      // #39: a pinned app already shows in "My list" above - never repeat it in the
      // status groups below.
      if (isPinnedApp(a)) return false;
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
  }, [directApps, query, lane, isPinnedApp]);

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
      // #39: a pinned catalog app already shows in "My list" above; don't repeat it.
      if (isPinnedApp({ name: c.name })) return false;
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
  }, [apps, catalog, query, lane, isPinnedApp]);

  const liveCount = directApps.filter((a) => appStatus(a) === "connected").length;

  // "My list" - the user's pinned apps, connected or catalog, surfaced at the top
  // of the sidebar for quick access. A pinned catalog app and its installed self
  // share a normalized key, so once connected it shows from the connected side.
  // (`favs` is read above, hoisted so the list memos can de-dup against it.)
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
    // MY LIST must respect the active lane filter (fix #9): a pinned CLI app
    // should not surface while the "Direct" tab is selected, and vice-versa, so
    // the section never shows items that don't match the chosen category.
    const laneOk = (x: { pattern?: string; via?: string; integration?: string; connection_hint?: { method?: string } }) => lane === "all" || laneOf(x) === lane;
    const connected = directApps.filter((a) => (favs.has(favKeyOf(a.title || a.id)) || favs.has(favKeyOf(a.id))) && laneOk(a));
    const connectedKeys = new Set(connected.map((a) => favKeyOf(a.title || a.id)));
    const seen = new Set<string>();
    const catalogPinned = catalog.filter((c) => {
      const k = favKeyOf(c.name);
      if (!favs.has(k) || connectedKeys.has(k) || seen.has(k)) return false;
      if (!laneOk(c)) return false;
      seen.add(k);
      return true;
    });
    return { connected, catalog: catalogPinned, count: connected.length + catalogPinned.length };
  }, [directApps, catalog, favs, lane]);
  const selectedApp = (apps ?? []).find((a) => a.id === selected) ?? null;
  // The Direct detail pane only ever shows a Direct app. A gateway app that
  // happens to be the shared `selected` (e.g. just-scaffolded) must not render
  // here without its gateway chrome - it belongs to its own mode.
  const directSelectedApp = selectedApp && !selectedApp.gateway ? selectedApp : null;
  // A catalog row reads as active when its detail/flow is what's currently open:
  // a gateway connector follows the gateway pane, anything else the catalog pick.
  const catalogRowActive = useCallback((c: CatalogApp) => {
    const kind = gatewayAppKind(c);
    if (kind === "composio" || kind === "nango") return gatewayPane === kind;
    return catalogPick?.name === c.name;
  }, [gatewayPane, catalogPick]);

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
        <div className="flex max-h-[82vh] min-h-[55vh] flex-col overflow-hidden rounded-xl border border-border lg:max-h-[calc(100vh-13rem)] lg:flex-row lg:items-stretch">
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
                    onClick={() => { setSelected(a.id); setCatalogPick(null); setGatewayPane(null); }}
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
            {/* Sticky controls (fix #2): search, lane tabs, and "Connect an app"
                stay fixed while only the list below scrolls. */}
            <div className="shrink-0 border-b border-border-subtle p-3">
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
            {lane === "mcp" && (
              <button
                onClick={() => void openMcpForm()}
                className="mb-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-1.5 text-left transition-colors hover:border-accent-border hover:bg-accent-soft/20"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-strong text-accent"><Boxes className="h-3.5 w-3.5" /></span>
                <span className="text-xs font-medium text-text-secondary">Add custom MCP</span>
              </button>
            )}
            <button
              onClick={() => { setConnecting(true); setCatalogPick(null); setGatewayPane(null); }}
              className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-accent-border bg-accent-soft/20 px-3 py-2 text-left transition-colors hover:bg-accent-soft/40"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-background"><Plus className="h-3.5 w-3.5" /></span>
              <span className="text-xs font-semibold text-text-primary">Connect an app</span>
            </button>
            {liveCount > 0 && (
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">{liveCount} of {directApps.length} live</div>
            )}
            </div>
            {/* Only this region scrolls. #47: extra bottom padding + a faint end
                marker so the list ends gracefully instead of cutting off mid-row. */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 pb-10">
              {groups.length === 0 && catalogView.shown.length === 0 ? (
                <div className="px-1 text-xs text-text-muted">No apps match "{query}".</div>
              ) : (
                <>
                  {/* My list - the user's pinned apps, connected or catalog, up top.
                      Collapsible (fix #4); collapsed by default. */}
                  {pinned.count > 0 && (
                    <section className="space-y-1">
                      <button onClick={toggleMyList} className="flex w-full items-center gap-1 px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-accent transition-colors hover:text-accent-hover">
                        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${myListOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
                        <Star className="h-2.5 w-2.5 fill-accent" /> My list · {pinned.count}
                      </button>
                      {myListOpen && pinned.connected.map((a) => (
                        <ConnectorRow
                          key={`pin-${a.id}`}
                          app={a}
                          logos={logos}
                          status={appStatus(a)}
                          active={selected === a.id && !catalogPick}
                          onSelect={() => { setSelected(a.id); setCatalogPick(null); setGatewayPane(null); }}
                          isFav
                          onToggleFav={() => void favApp(a)}
                        />
                      ))}
                      {myListOpen && pinned.catalog.map((c) => (
                        <CatalogRow
                          key={`pin-${c.iconSlug || c.name}`}
                          app={c}
                          logos={logos}
                          active={catalogRowActive(c)}
                          onSelect={() => selectCatalogApp(c)}
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
                          onSelect={() => { setSelected(a.id); setCatalogPick(null); setGatewayPane(null); }}
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
                      <button onClick={toggleAvail} className="flex w-full items-center gap-1 px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted transition-colors hover:text-text-secondary">
                        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${availOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
                        Available to add · {catalogView.total}
                      </button>
                      {availOpen && catalogView.shown.map((c) => {
                        // Google is a catalog entry like any other, but its detail
                        // is the multi-profile workspace panel (selected==="google")
                        // and favoriting it scaffolds the real vault app first.
                        const isGoogle = c.iconSlug === "google" || c.name === "Google";
                        return (
                        <CatalogRow
                          key={c.iconSlug || c.name}
                          app={c}
                          logos={logos}
                          active={isGoogle ? selected === "google" && !catalogPick && !gatewayPane : catalogRowActive(c)}
                          onSelect={isGoogle
                            ? () => { setSelected("google"); setCatalogPick(null); setGatewayPane(null); setConnecting(false); }
                            : () => selectCatalogApp(c)}
                          isFav={favs.has(favKeyOf(c.name))}
                          onToggleFav={isGoogle ? () => void favApp({ id: "google", title: "Google" }) : () => void favCatalogApp(c)}
                        />
                        );
                      })}
                      {availOpen && !catalogView.searching && catalogView.total > catalogView.shown.length && (
                        <div className="px-1 pt-0.5 text-[10px] text-text-muted/70">
                          showing {catalogView.shown.length} of {catalogView.total} - search to find more
                        </div>
                      )}
                    </section>
                  )}
                  {/* #47: a quiet end-of-list marker so the scroll resolves instead
                      of stopping abruptly. */}
                  {(groups.length > 0 || catalogView.shown.length > 0) && (
                    <div aria-hidden className="select-none pt-1 text-center font-mono text-[9px] tracking-[0.4em] text-text-muted/30">· · ·</div>
                  )}
                </>
              )}
            </div>
          </aside>
          )}

          {/* RIGHT - the connect flow, the selected connector's config, or a
              catalog app's detail. A small gutter (desktop) keeps the detail
              from butting against the list column's divider. */}
          <div className="min-w-0 flex-1 overflow-y-auto bg-surface lg:p-3">
            {connecting ? (
              <ConnectAppFlow
                vaultPath={vaultPath}
                presetName={catalogPick?.name}
                presetGoal={catalogPick?.note || catalogPick?.soul}
                onDone={async () => { setConnecting(false); setCatalogPick(null); await reload(); }}
                onCancel={() => setConnecting(false)}
              />
            ) : gatewayPane === "composio" ? (
              // Composio: one key fronts all of Composio's integrations. Reuses
              // the existing managed-gateway pane (key -> browse -> connect).
              <ComposioMode vaultPath={vaultPath} expanded />
            ) : gatewayPane === "nango" ? (
              // Nango: one project secret key fronts your configured Nango
              // integrations. Reuses the existing Nango gateway pane.
              <NangoMode vaultPath={vaultPath} expanded />
            ) : catalogPick ? (
              // Fix #14/#3: a catalog pick must win over a stale `selected ===
              // "google"`. Selecting any catalog app sets catalogPick but leaves
              // `selected` untouched, so checking google FIRST left the Google
              // panel showing after you clicked, say, DoorDash. catalogPick is
              // now evaluated before the google branch, and because the google
              // ROW clears catalogPick (and other rows set it), the right branch
              // always reflects the just-clicked item synchronously.
              <>
                {catalogConnectErr && (
                  <div className="mb-3 rounded-lg border border-err/40 bg-err/10 px-3 py-2 text-xs text-err">{catalogConnectErr}</div>
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
                  connect={{ onConnect: () => connectCatalogApp(catalogPick), connecting: catalogConnecting, soul: catalogPick.soul, skills: catalogPick.skills, onResearch: () => setConnecting(true) }}
                />
              </>
            ) : selected === "google" ? (
              // Google is an app object: its detail IS the multi-profile workspace
              // panel (each Google account is a profile inside this one app).
              <GoogleWorkspacePanel vaultPath={vaultPath} logos={logos} />
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

      {/* Add custom MCP: name + stdio command (+ optional one-time install) +
          a domain to feed. Scaffolds an "mcp" app carrying the spawn command. */}
      {mcpFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4" onClick={() => !mcpFormBusy && setMcpFormOpen(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent"><Boxes className="h-4 w-4" /></span>
                <span className="text-sm font-semibold text-text-primary">Add a custom MCP server</span>
              </div>
              <button onClick={() => !mcpFormBusy && setMcpFormOpen(false)} className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-strong hover:text-text-primary"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-xs leading-relaxed text-text-muted">
                Point Prevail at any stdio MCP server. Prevail launches it with the command below and the agent can use its tools.
              </p>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">Name</span>
                <input
                  value={mcpForm.name}
                  onChange={(e) => setMcpForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="GitHub MCP"
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">Command</span>
                <input
                  value={mcpForm.command}
                  onChange={(e) => setMcpForm((f) => ({ ...f, command: e.target.value }))}
                  placeholder="npx -y @modelcontextprotocol/server-..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">Install command <span className="font-normal text-text-muted">(optional, one time)</span></span>
                <input
                  value={mcpForm.install}
                  onChange={(e) => setMcpForm((f) => ({ ...f, install: e.target.value }))}
                  placeholder="npm i -g some-mcp-server"
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">Feeds domain <span className="font-normal text-text-muted">(optional)</span></span>
                <select
                  value={mcpForm.domain}
                  onChange={(e) => setMcpForm((f) => ({ ...f, domain: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-text-primary focus:border-accent-border focus:outline-none"
                >
                  <option value="">No specific domain</option>
                  {vaultDomains.map((d) => (
                    <option key={d} value={d}>{titleCase(d)}</option>
                  ))}
                </select>
              </label>
              {mcpFormErr && (
                <div className="rounded-lg border border-err/40 bg-err/10 px-3 py-2 text-xs text-err">{mcpFormErr}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
              <button onClick={() => setMcpFormOpen(false)} disabled={mcpFormBusy} className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50">Cancel</button>
              <button onClick={() => void addCustomMcp()} disabled={mcpFormBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background transition-colors hover:bg-accent-hover disabled:opacity-50">
                {mcpFormBusy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…</> : <><Plus className="h-3.5 w-3.5" /> Add server</>}
              </button>
            </div>
          </div>
        </div>
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
      let list = await invoke<EngineApp[]>("engine_apps_list", { vault: vaultPath });
      let a = (list ?? []).find((x) => x.id === id);
      if (!a) {
        // Scaffold it as a vault app so the schedule persists + it's chattable.
        await invoke("engine_gateway_app_add", { provider: method, toolkit: slug, id, title }).catch(() => {});
        list = await invoke<EngineApp[]>("engine_apps_list", { vault: vaultPath });
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
          {composioMethod === "mcp" && verified === false && <span className="inline-flex items-center gap-1 rounded-full border border-err/40 bg-err/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-err">Invalid key</span>}
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
            {verified === false && <p className="rounded-md border border-err/40 bg-err/10 px-2 py-1 text-[11px] text-err">That key did not authenticate to Composio. Enter a valid X-CONSUMER-API-KEY.</p>}
            <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} type="password" placeholder="ck_…" onKeyDown={(e) => { if (e.key === "Enter" && keyInput.trim()) void save(); }}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent-border" />
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={save} disabled={busy !== null || !keyInput.trim()} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save key</button>
              {(editingKey || (configured && verified === false)) && <button onClick={() => { setEditingKey(false); setKeyInput(""); }} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:border-accent-border">Cancel</button>}
              {configured && <button onClick={removeKey} disabled={busy !== null} className="text-[11px] text-text-muted hover:text-err hover:underline">Remove key</button>}
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
            <button onClick={removeKey} disabled={busy !== null} className="text-[10px] hover:text-err hover:underline">Remove key</button>
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
            {verified === false && <p className="rounded-md border border-err/40 bg-err/10 px-2 py-1 text-[11px] text-err">That key did not authenticate to Nango. Enter a valid secret key.</p>}
            <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} type="password" placeholder="nango secret key…" onKeyDown={(e) => { if (e.key === "Enter" && keyInput.trim()) void save(); }}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent-border" />
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={save} disabled={busy !== null || !keyInput.trim()} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save key</button>
              {(editingKey || (configured && verified === false)) && <button onClick={() => { setEditingKey(false); setKeyInput(""); }} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:border-accent-border">Cancel</button>}
              {configured && <button onClick={removeKey} disabled={busy !== null} className="text-[11px] text-text-muted hover:text-err hover:underline">Remove key</button>}
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
            <button onClick={removeKey} disabled={busy !== null} className="text-[10px] hover:text-err hover:underline">Remove key</button>
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

// The minimal connector row (#46 / #40 / #38). At rest a row is just the brand
// logo + name + a tiny status dot - no always-on colored method pills. The method
// and category are revealed on HOVER (a quiet line under the name) and repeated,
// with the row's actions, inside a kebab menu on the right. Active rows get a
// strong, distinct highlight: accent-soft fill + a thick left accent bar + ring.
const ROW_BASE = "group relative flex items-center gap-1 rounded-lg border-l-[3px] pr-1.5 transition-colors";
function rowCls(active: boolean): string {
  return `${ROW_BASE} ${active
    ? "border-l-accent bg-accent-soft shadow-sm ring-1 ring-accent-border"
    : "border-l-transparent ring-1 ring-transparent hover:border-l-border hover:bg-surface-strong hover:ring-border-subtle"}`;
}

type KebabAction = { icon: LucideIcon; label: string; onClick: () => void };
// The per-row "details + actions" menu (lucide MoreVertical). Opens a small popover
// positioned with `fixed` (so the scrolling list never clips it) that shows the
// status, the method, and the category, then the row's actions. The trigger appears
// on hover and stays while the menu is open or when `visible` (e.g. a pinned row).
function RowKebab({ method, category, statusLabel, statusDot, actions, visible }: {
  method: string;
  category?: string;
  statusLabel: string;
  statusDot: string;
  actions: KebabAction[];
  visible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => { setOpen(false); setPos(null); }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as Element | null; if (!t?.closest?.("[data-rowkebab]")) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { close(); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.round(r.bottom + 4), left: Math.round(Math.max(8, r.right - 224)) });
    setOpen(true);
  };
  return (
    <div data-rowkebab className="shrink-0">
      <button
        ref={btnRef}
        onClick={toggle}
        title="Details and actions"
        aria-label="Details and actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-surface-strong hover:text-accent ${open || visible ? "text-text-secondary opacity-100" : "text-text-muted opacity-0 group-hover:opacity-100"}`}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && pos && (
        <div role="menu" onClick={(e) => e.stopPropagation()} style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="border-b border-border-subtle px-3 py-2">
            <div className="flex items-center gap-2 text-[11px]">
              <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot}`} />
              <span className="font-medium text-text-secondary">{statusLabel}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
              <span className="rounded border border-border-subtle bg-surface-warm px-1.5 py-0.5">{method}</span>
              {category && <span className="max-w-[7rem] truncate rounded border border-border-subtle bg-surface-warm px-1.5 py-0.5">{category}</span>}
            </div>
          </div>
          <div className="py-1">
            {actions.map((a, i) => { const Icon = a.icon; return (
              <button key={i} role="menuitem" onClick={() => { a.onClick(); close(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary">
                <Icon className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{a.label}</span>
              </button>
            ); })}
          </div>
        </div>
      )}
    </div>
  );
}

// The quiet hover-revealed "method · category" line. Reserves its height so the
// row never reflows when it fades in; stays visible while the row is active.
function RowMeta({ method, category, active }: { method: string; category?: string; active: boolean }) {
  return (
    <span className={`mt-0.5 block h-3 truncate font-mono text-[9px] uppercase tracking-wider text-text-muted transition-opacity group-hover:opacity-100 ${active ? "opacity-100" : "opacity-0"}`}>
      {method}{category ? ` · ${category}` : ""}
    </span>
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
  const method = METHOD_META[methodOf(app)].label;
  const category = (app.domains ?? [])[0] ? titleCase((app.domains)[0]) : "";
  return (
    <div className={rowCls(active)}>
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-2.5 text-left">
        <AppRowLogo app={app} logos={logos} size={28} fallback="letter" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${active ? "text-accent" : "text-text-primary"}`}>{app.title || app.id}</span>
          <RowMeta method={method} category={category} active={active} />
        </span>
      </button>
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot} ${status === "connecting" ? "animate-pulse" : ""}`} title={meta.label} />
      <RowKebab
        method={method}
        category={category}
        statusLabel={meta.label}
        statusDot={meta.dot}
        visible={isFav}
        actions={[
          { icon: ArrowUpRight, label: "Open", onClick: onSelect },
          { icon: ExternalLink, label: `Visit ${app.title || app.id}`, onClick: () => void openUrl(appWebsite(app)) },
          ...(app.path ? [{ icon: FolderOpen, label: "Open in Finder", onClick: () => void invoke("open_in_finder", { path: app.path! }).catch(() => {}) }] : []),
          { icon: Star, label: isFav ? "Unpin from My list" : "Pin to My list", onClick: onToggleFav },
        ]}
      />
    </div>
  );
}

// Map a catalog app to the minimal shape AppRowLogo needs (it keys off title/id
// against the logos map). Catalog apps may not be in the logos map - then it
// falls back to a letter mark, which is the requested behavior.
function catalogLogoApp(c: CatalogApp): { title?: string; id?: string } {
  return { title: c.name, id: c.iconSlug || c.name };
}

// Best-effort website for a catalog (not-yet-installed) app, for the row's "Visit"
// action: the catalog domain when present, else a www.<slug>.com guess.
function catalogWebsite(c: CatalogApp): string {
  if (c.domain) return /^https?:\/\//.test(c.domain) ? c.domain : `https://${c.domain}`;
  const slug = (c.iconSlug || c.name).toLowerCase().replace(/[^a-z0-9]/g, "") || "app";
  return `https://www.${slug}.com`;
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
  const meta = STATUS_META.disconnected;
  const method = METHOD_META[methodOf(app)].label;
  const category = titleCase(app.domain || (app.tags && app.tags[0]) || "");
  return (
    <div className={rowCls(active)}>
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-2.5 text-left">
        <AppRowLogo app={catalogLogoApp(app)} logos={logos} size={28} fallback="letter" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${active ? "text-accent" : "text-text-primary"}`}>{app.name}</span>
          <RowMeta method={method} category={category} active={active} />
        </span>
      </button>
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} title={meta.label} />
      <RowKebab
        method={method}
        category={category}
        statusLabel={meta.label}
        statusDot={meta.dot}
        visible={isFav}
        actions={[
          { icon: ArrowUpRight, label: "Open", onClick: onSelect },
          { icon: ExternalLink, label: `Visit ${app.name}`, onClick: () => void openUrl(catalogWebsite(app)) },
          { icon: Star, label: isFav ? "Unpin from My list" : "Pin to My list", onClick: onToggleFav },
        ]}
      />
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
  const soul = (app.soul || "").trim();
  const skills = app.skills ?? [];
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

      {/* What it can do - the skills this connector gives the agent. Comes from
          the curated catalog so the user sees the value before connecting. */}
      {skills.length > 0 && (
        <div className="border-t border-border-subtle px-5 py-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">What it can do</div>
          {soul && <p className="mb-3 max-w-prose text-[12px] italic leading-relaxed text-text-muted">{soul}</p>}
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {skills.map((s) => (
              <li key={s.id} className="rounded-lg border border-border-subtle bg-background px-3 py-2">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary"><Zap className="h-3 w-3 text-accent" /> {s.title}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-text-secondary">{s.description}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
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

// The detail pane is a TABBED interface (fix #7), mirroring the chat-experience
// tab pattern: a pill row under the header, one panel shown at a time.
type AppTab = "welcome" | "soul" | "journal" | "skills" | "connections" | "chat";

// A runnable skill as the UI displays it. The engine now returns the richer
// contract shape (id/name/method/primary/source/trigger/summary) and includes
// shipped STARTER packs even before connect; older fields (runner/favorite) are
// kept optional for back-compat. We only DISPLAY what the engine returns.
type AppSkill = {
  id: string;
  name?: string;
  method?: "browser" | "mcp" | "api" | "other" | string;
  primary?: boolean;
  source?: "starter" | "learned";
  trigger?: string;
  summary?: string;
  // Back-compat with the previous schema.
  runner?: string;
  favorite?: boolean;
};

// Method badge for a skill row: Browser / MCP / API / Other, derived from the
// skill's declared method when present, else inferred from its runner.
function skillMethod(s: AppSkill): "Browser" | "MCP" | "API" | "Other" {
  const m = (s.method || s.runner || "").toLowerCase();
  if (m.includes("mcp")) return "MCP";
  if (m.includes("api") || m.includes("http") || m.includes("oauth")) return "API";
  if (m === "other") return "Other";
  return "Browser";
}

// Bespoke, researched Soul text for the headline connectors people actually
// reach for first. Each entry reads like instructions: what the app is, what
// data it exposes, how that data reaches the vault, and how the agent puts it
// to work for the relevant life domain. Keyed by normalized id/name (lowercase,
// alphanumeric only), which matches both the catalog-derived id and the title.
//
// COVERAGE: these ~55 entries cover the curated, recognizable set across every
// domain (money, fitness, productivity, media, travel, food, security, etc.).
// The full catalog is ~1,400+ apps, so the long tail does NOT get hand-written
// text; it falls through to the category-aware composer below, which produces a
// solid multi-sentence Soul from the app's primary domain. No em dashes anywhere
// (app-wide style rule).
const SOUL_DETAILS: Record<string, string> = {
  // Fitness and health
  alltrails: "AllTrails knows where and how you move outdoors: the trails you save, the hikes and runs you log, distance, elevation gain, pace, and the conditions you faced. Prevail brings those activities and saved routes into your vault so the picture of your training load and outdoor time lives next to the rest of your health data. With it in context, your AI can plan routes that fit your fitness, balance hard and easy days, line up nutrition and recovery around big efforts, and steer you toward trails that match your goals and the weather.",
  strava: "Strava is your training diary: rides, runs, and workouts with pace, heart rate, power, distance, and elevation, plus the segments and personal records you care about. Prevail pulls these activities into your vault so effort and recovery trends are visible over weeks, not just per session. In context, your AI can spot overtraining, suggest when to push or rest, and tie performance to sleep, nutrition, and schedule.",
  garminconnect: "Garmin Connect holds the full readout from your watch or bike computer: workouts, steps, heart rate, sleep stages, stress, body battery, and training status. Prevail brings these daily metrics and activities into your vault so recovery and load sit alongside the rest of your health picture. Your AI can use it to time hard sessions, flag undertraining or burnout, and align nutrition and rest with how your body is actually responding.",
  ouraring: "Oura tracks recovery and readiness: sleep stages and timing, resting heart rate, heart rate variability, body temperature, and a daily readiness score. Prevail pulls these nightly metrics into your vault so sleep and recovery trends are visible next to your training and schedule. In context, your AI can tell you when to push and when to back off, protect your sleep window, and connect poor nights to the choices that caused them.",
  whoop: "Whoop measures strain and recovery continuously: heart rate, heart rate variability, respiratory rate, sleep performance, and a daily recovery score. Prevail brings these readings into your vault so effort and recovery are tracked as a system, not isolated days. Your AI can use it to plan training intensity, surface when recovery is lagging, and tie strain to sleep, stress, and nutrition.",
  fitbit: "Fitbit logs your everyday movement and wellness: steps, heart rate, active minutes, sleep, and weight. Prevail pulls these metrics into your vault so the slow trends in your activity and rest are easy to see. In context, your AI can nudge you toward movement goals, watch sleep consistency, and relate your energy to how you have been living.",
  peloton: "Peloton records your guided workouts: rides, runs, strength, and yoga with duration, output, heart rate, and the classes and instructors you favor. Prevail brings this workout history into your vault so your training volume and preferences live with the rest of your fitness data. Your AI can use it to build a balanced week, suggest classes that fit your goals, and keep effort and recovery in sync.",
  applehealth: "Apple Health is the hub your iPhone and Apple Watch feed: steps, heart rate, workouts, sleep, and any health records other apps write into it. Prevail brings this consolidated health picture into your vault so the signals scattered across devices live in one place. In context, your AI can track trends across activity, sleep, and vitals, prep you for appointments, and connect how you feel to how you have been living.",
  epicmychart: "Epic MyChart is your patient portal: visit summaries, lab results, medications, immunizations, upcoming appointments, and messages from your care team. Prevail brings these records into your vault so your medical history is in your hands and not scattered across portals. Your AI can use it to track results over time, keep medications and follow-ups straight, and help you walk into appointments fully prepared.",
  onemedical: "One Medical holds your primary-care relationship: appointments, visit notes, prescriptions, and messages with your providers. Prevail brings these into your vault so your care history and next steps are easy to find. In context, your AI can track follow-ups, remember what was said, and help you prepare for and act on each visit.",
  calm: "Calm reflects how you tend to your mind: the meditations, sleep stories, and breathing sessions you use and how consistent you are. Prevail brings this into your vault as a signal of stress and routine. Your AI can use it to protect wind-down time, suggest the right session for the moment, and notice when stress is creeping up.",
  headspace: "Headspace tracks your mindfulness practice: the sessions you complete, your streaks, and the themes you return to. Prevail brings this into your vault as a window into stress, focus, and routine. In context, your AI can help you keep the habit, surface a session that fits how your day is going, and tie practice to how you feel and perform.",

  // Money, banking, and payments
  plaid: "Plaid is an aggregator: with one secure connection it pulls balances and transactions across many of your bank and card accounts at once. Prevail brings that unified financial picture into your vault so spending, cash flow, and net worth are all in one place. In context, your AI can categorize spending, flag unusual charges, and keep budgets and goals honest against real numbers.",
  chase: "Chase exposes your checking, savings, and credit card activity: balances, posted and pending transactions, statements, and payment due dates. Prevail brings this into your vault so your day-to-day money lives in one place you control. Your AI can use it to categorize spending, watch cash flow, flag unusual charges, and keep your budget honest against what actually cleared.",
  bankofamerica: "Bank of America exposes your account balances, transactions, statements, and card activity. Prevail brings this into your vault so your everyday spending and cash flow are visible alongside the rest of your money. In context, your AI can categorize transactions, surface recurring charges, and keep budgets and savings goals tied to real numbers.",
  americanexpress: "American Express holds your card activity: charges, statements, payment due dates, rewards balances, and the merchants you spend with. Prevail brings this into your vault so card spending sits next to the rest of your financial picture. Your AI can use it to track spending by category, watch for unusual charges, surface rewards worth using, and keep payments from slipping.",
  capitalone: "Capital One exposes your card and bank activity: balances, transactions, statements, and rewards. Prevail brings this into your vault so spending and cash flow are easy to follow. In context, your AI can categorize charges, flag anomalies, and keep your budget aligned with what you are actually spending.",
  wellsfargo: "Wells Fargo exposes your checking, savings, and card activity: balances, transactions, and statements. Prevail brings this into your vault so your accounts are visible in one place you own. Your AI can use it to track cash flow, categorize spending, and keep budgets and bills on track.",
  paypal: "PayPal holds your payments and transfers: purchases, money sent and received, balances, and linked funding sources. Prevail brings this into your vault so the spending and income flowing through PayPal joins the rest of your money picture. In context, your AI can categorize activity, track who you pay and get paid by, and surface recurring charges.",
  venmo: "Venmo records the money you move with people: payments, requests, transfers, and the notes attached to them. Prevail brings this into your vault so peer-to-peer spending is part of your full financial picture rather than an untracked gap. Your AI can use it to categorize what you spend socially, settle who owes what, and fold it into your budget.",
  applepay: "Apple Pay reflects your tap-to-pay and in-app purchases: the transactions, merchants, and cards behind them. Prevail brings this into your vault so contactless spending is captured alongside your other accounts. In context, your AI can categorize purchases, spot recurring charges, and keep your budget complete.",

  // Investing
  fidelityinvestments: "Fidelity holds your investing and retirement accounts: positions, balances, trades, dividends, cost basis, and performance. Prevail brings this into your vault so your portfolio sits next to the rest of your wealth picture. Your AI can use it to track allocation and returns, watch fees and cash drag, and keep your investing aligned with your goals and risk tolerance.",
  charlesschwab: "Charles Schwab exposes your brokerage and retirement holdings: positions, balances, transactions, and performance. Prevail brings this into your vault so your investments are visible alongside your cash and debts. In context, your AI can track allocation, monitor gains and losses, and help you keep the portfolio aligned with your plan.",
  robinhood: "Robinhood holds your trading activity: stock, ETF, options, and crypto positions, orders, and balances. Prevail brings this into your vault so your investing sits with the rest of your money. Your AI can use it to track allocation and performance, watch risk concentration, and keep trading honest against your longer-term goals.",
  coinbase: "Coinbase exposes your crypto holdings and activity: balances, buys, sells, transfers, and the assets you hold. Prevail brings this into your vault so your crypto is part of your full net-worth picture rather than a silo. In context, your AI can track value and cost basis, watch volatility and concentration, and prepare clean records for taxes.",
  vanguard: "Vanguard holds your funds and retirement accounts: positions, balances, contributions, and performance. Prevail brings this into your vault so your long-term investing lives with the rest of your wealth. Your AI can use it to track allocation, monitor contributions toward goals, and keep fees and balance in view.",

  // Budgeting and taxes
  intuitquickbooks: "QuickBooks holds your business books: income, expenses, invoices, bills, and reports. Prevail brings this into your vault so your business finances are part of the context your AI reasons over. In context, your AI can track profit and cash flow, organize deductible spending, and keep records ready well before tax time.",
  intuitturbotax: "TurboTax holds your tax filings: prior returns, income documents, deductions, and refund or balance history. Prevail brings these into your vault so your tax picture is available year-round, not just in April. Your AI can use it to estimate what you will owe, surface deductions worth tracking, and keep documents organized for the next filing.",
  ynab: "YNAB is your zero-based budget: categories, assigned money, transactions, and goals. Prevail brings this into your vault so your plan for every dollar lives alongside your real account activity. In context, your AI can keep categories funded, flag overspending early, and help you steer money toward the goals you set.",
  monarchmoney: "Monarch Money aggregates your accounts and budget: balances, transactions, categories, net worth, and recurring bills. Prevail brings this unified picture into your vault so your whole financial life is in one place you control. Your AI can use it to track spending and net worth, watch subscriptions, and keep budgets and goals on course.",
  rocketmoney: "Rocket Money surfaces your subscriptions and recurring spending: bills, free trials, and where your money leaks each month. Prevail brings this into your vault so recurring costs are visible and easy to manage. In context, your AI can flag subscriptions worth canceling, watch for surprise increases, and keep monthly commitments under control.",
  expensify: "Expensify holds your expenses and receipts: scanned receipts, categorized spending, mileage, and reports. Prevail brings this into your vault so business and reimbursable spending is organized and searchable. Your AI can use it to keep deductible spending tidy, prepare reports, and have clean records ready for taxes.",
  creditkarma: "Credit Karma exposes your credit picture: scores, report details, open accounts, balances, and inquiries. Prevail brings this into your vault so your credit health is tracked over time, not checked once and forgotten. In context, your AI can watch your score, catch errors or signs of fraud early, and help you plan moves like paying down balances or applying for new credit.",

  // Productivity and notes
  google: "Google is the hub of your digital life: Gmail, Calendar, Drive, Contacts, and more. Prevail signs in once and brings the pieces you choose into your vault, so your mail, schedule, documents, and contacts become shared context. In context, your AI can pull commitments and dates out of email, protect focus time on your calendar, find the right document fast, and tie it all to the goals you set.",
  notion: "Notion holds your knowledge and projects: notes, docs, databases, tasks, and wikis. Prevail brings the pages and databases you choose into your vault so your second brain is part of the context your AI reasons over. Your AI can use it to connect notes to the work they belong to, track tasks and deadlines, and turn loose ideas into next steps.",
  asana: "Asana holds your projects and tasks: assignments, due dates, statuses, and the projects they roll up to. Prevail brings this into your vault so the work you owe and the work you are waiting on is visible alongside your calendar. In context, your AI can keep deadlines in view, surface what needs attention next, and tie tasks to your larger goals.",
  todoist: "Todoist is your task list: tasks, projects, due dates, priorities, and labels. Prevail brings this into your vault so your commitments live next to your calendar and notes. Your AI can use it to keep deadlines straight, surface what to do next, and turn vague intentions into scheduled action.",
  trello: "Trello holds your boards: cards, lists, due dates, and the flow of work across them. Prevail brings this into your vault so the state of your projects is part of your working context. In context, your AI can track what is in flight, surface what is stuck, and keep momentum on what matters.",
  jira: "Jira holds your engineering work: issues, sprints, statuses, assignees, and priorities. Prevail brings this into your vault so the work in flight is visible alongside your schedule. Your AI can use it to track what needs attention, surface blockers, and keep effort tied to your priorities.",
  linear: "Linear holds your product and engineering work: issues, projects, cycles, and statuses. Prevail brings this into your vault so what you are building is part of your working context. In context, your AI can track progress, surface what needs review or attention, and keep work aligned with your goals.",
  obsidian: "Obsidian is your local knowledge base: linked markdown notes, daily notes, and the web of ideas between them. Prevail brings these notes into your vault so your thinking is part of the context your AI reasons over. Your AI can use it to connect ideas, resurface relevant notes, and turn what you have written into action.",
  evernote: "Evernote holds your captured notes, clippings, and documents. Prevail brings these into your vault so the things you saved are searchable and connected to the rest of your context. In context, your AI can surface the right note at the right moment and tie what you captured to what you are doing.",
  things3: "Things holds your tasks and projects: to-dos, areas, deadlines, and your plan for today and upcoming. Prevail brings this into your vault so your commitments live next to your calendar and notes. Your AI can use it to keep deadlines in view, plan a realistic day, and move projects forward.",
  calendly: "Calendly holds your scheduling: booked meetings, event types, availability, and who booked time with you. Prevail brings this into your vault so meetings others book land in your working context. In context, your AI can protect focus time, spot conflicts, and plan your day around what is on the books.",

  // Communication and email
  slack: "Slack holds your team conversations: channels, direct messages, mentions, threads, and shared files. Prevail brings the conversations you choose into your vault so commitments and decisions are not buried in chat. Your AI can use it to surface what needs a response, pull out action items and dates, and keep the people and decisions that matter in context.",
  microsoftteams: "Microsoft Teams holds your work conversations and meetings: chats, channels, calls, and shared files. Prevail brings these into your vault so commitments and decisions are searchable alongside your other work. In context, your AI can surface what needs a reply, extract action items, and keep collaboration tied to your tasks and calendar.",
  discord: "Discord holds your community conversations: servers, channels, direct messages, and shared content. Prevail brings the conversations you choose into your vault so the threads you care about are part of your context. Your AI can use it to track open discussions, surface what needs a response, and keep useful content findable.",
  whatsapp: "WhatsApp holds your personal conversations: chats, groups, and shared media. Prevail brings the conversations you choose into your vault so commitments and plans made in chat are not lost. In context, your AI can surface what needs a reply, pull out dates and to-dos, and keep the people who matter in context.",
  protonmail: "Proton Mail holds your private, encrypted email: messages, threads, contacts, and attachments. Prevail brings the mail you choose into your vault so the commitments and records living in your inbox become usable context. Your AI can use it to surface what needs a reply, pull out receipts, dates, and tasks, and keep important threads from getting buried.",

  // Media
  spotify: "Spotify reflects your listening: the tracks, artists, and genres you return to, your playlists, and how your taste shifts over time. Prevail brings this into your vault as a signal of mood, focus, and routine. Your AI can use it to shape focus sessions, surface music for the task at hand, and notice patterns worth acting on.",
  applemusic: "Apple Music reflects your listening: the songs, artists, and playlists you favor and your library over time. Prevail brings this into your vault as a signal of mood, focus, and routine. In context, your AI can shape focus and downtime, surface the right music for the moment, and notice patterns worth acting on.",
  netflix: "Netflix reflects your viewing: the shows and films you watch, your list, and your habits over time. Prevail brings this into your vault as a window into how you spend downtime. Your AI can use it to surface what fits the moment, notice how much time goes here, and connect it to your routine.",
  youtubemusic: "YouTube Music reflects your listening: the tracks, artists, and playlists you return to and your library. Prevail brings this into your vault as a signal of mood, focus, and routine. In context, your AI can shape focus sessions, surface music for the task at hand, and notice patterns worth acting on.",

  // Travel
  uber: "Uber holds your rides: trips taken, routes, fares, and the places you go. Prevail brings this into your vault so your movement and travel spending are part of your context. Your AI can use it to track travel costs, remember the places you visit, and plan trips that fit your schedule and budget.",
  lyft: "Lyft holds your rides: trips, routes, fares, and destinations. Prevail brings this into your vault so where you go and what it costs are part of your picture. In context, your AI can track travel spending, recall frequent destinations, and help you plan around your day.",
  bookingcom: "Booking.com holds your travel reservations: hotels and stays, dates, prices, confirmations, and cancellation windows. Prevail brings these into your vault so your trips and their costs live in one place. Your AI can use it to keep itineraries straight, watch cancellation deadlines, and plan travel that fits your calendar and budget.",
  airbnb: "Airbnb holds your stays: bookings, dates, locations, prices, and saved listings. Prevail brings these into your vault so your trips and lodging costs are part of your travel picture. In context, your AI can keep itineraries together, track spending, and plan stays around your schedule and budget.",
  expedia: "Expedia holds your trips: flights, hotels, cars, dates, prices, and confirmations. Prevail brings these into your vault so the moving parts of a trip live in one itinerary. Your AI can use it to keep travel organized, watch dates and deadlines, and plan trips that fit your budget and calendar.",
  tripit: "TripIt assembles your itineraries: flights, hotels, cars, and reservations pulled together into one trip plan. Prevail brings these into your vault so every leg of a trip is in one place. In context, your AI can keep your schedule and travel in sync, surface the next step, and flag conflicts and timing risks.",
  googlemaps: "Google Maps holds your places and movement: saved locations, your timeline, frequent spots, and routes. Prevail brings the pieces you choose into your vault so where you go is part of your context. Your AI can use it to plan routes, remember the places you care about, and tie travel time to your schedule.",

  // Food
  doordash: "DoorDash holds your food orders: restaurants, items, prices, delivery history, and favorites. Prevail brings these into your vault so food spending and habits are part of your picture. Your AI can use it to track what you spend on food, remember the places and dishes you liked, and plan meals around your schedule and budget.",
  ubereats: "Uber Eats holds your food orders: restaurants, items, prices, and delivery history. Prevail brings these into your vault so eating-out spending and preferences are tracked. In context, your AI can watch food spending, recall favorites, and help you plan meals that fit your budget.",
  opentable: "OpenTable holds your dining reservations: restaurants, dates, party sizes, and your dining history. Prevail brings these into your vault so your plans and the places you love are part of your context. Your AI can use it to keep reservations on your calendar, remember favorites, and suggest spots that fit the occasion.",
  grubhub: "Grubhub holds your food orders: restaurants, items, prices, and delivery history. Prevail brings these into your vault so food spending and preferences are part of your picture. In context, your AI can track what you spend, recall favorites, and help plan meals around your budget.",
  instacart: "Instacart holds your grocery orders: items, stores, prices, and reorder history. Prevail brings these into your vault so grocery spending and what you actually buy are part of your context. Your AI can use it to track food costs, remember staples, and help plan shopping around meals and budget.",

  // Security
  "1password": "1Password holds the keys to your digital life: logins, passwords, passkeys, secure notes, and security alerts. Prevail brings the metadata you choose into your vault so you can see where your accounts live without exposing secrets. In context, your AI can map your account footprint, flag weak or reused credentials and breaches, and help you keep everything locked down.",
  bitwarden: "Bitwarden holds your credentials: logins, passwords, and secure notes across your accounts. Prevail brings the metadata you choose into your vault so your account footprint is visible without exposing secrets. Your AI can use it to surface weak or reused passwords, flag breaches, and keep your security tight.",
  dashlane: "Dashlane holds your logins, passwords, and security health. Prevail brings the metadata you choose into your vault so where your accounts live is part of your context without revealing secrets. In context, your AI can flag weak or reused credentials and breaches and help you stay secure.",
  nordvpn: "NordVPN reflects how you protect your connection: usage, servers, and security settings. Prevail brings what you choose into your vault so your privacy posture is part of your context. Your AI can use it to keep protection consistent and surface anything that needs attention.",

  // Shopping
  amazon: "Amazon holds your purchase history: orders, items, prices, subscriptions, and deliveries. Prevail brings these into your vault so what you buy and what it costs are part of your context. Your AI can use it to track spending, watch recurring orders and subscriptions, remember past purchases, and follow deliveries.",
  costco: "Costco holds your membership and purchases: orders, items, prices, and renewal dates. Prevail brings these into your vault so warehouse and online spending is part of your picture. In context, your AI can track spending, remember what you stock up on, and keep the membership and its costs in view.",
  ebay: "eBay holds your buying and selling: orders, bids, listings, prices, and history. Prevail brings these into your vault so the money flowing through eBay is part of your context. Your AI can use it to track spending and proceeds, watch listings, and remember what you bought and sold.",

  // Learning
  audible: "Audible holds your listening life: the audiobooks in your library, your progress, and what you have finished. Prevail brings these into your vault so what you are learning and enjoying is part of your context. Your AI can use it to track progress toward reading goals, surface the next title worth your time, and connect what you are listening to with your interests.",
  duolingo: "Duolingo tracks your language learning: lessons, streaks, skills, and progress. Prevail brings these into your vault so your learning habit and momentum are visible. In context, your AI can help you keep the streak alive, surface what to practice next, and tie progress to your goals.",
  goodreads: "Goodreads holds your reading life: the books you have read, are reading, and want to read, plus your ratings and shelves. Prevail brings these into your vault so your reading goals and tastes are part of your context. Your AI can use it to track progress, surface your next read, and connect books to your interests.",

  // Career and social
  linkedin: "LinkedIn holds your professional life: your profile, connections, messages, and activity. Prevail brings the pieces you choose into your vault so your network and career signals are part of your context. In context, your AI can track opportunities and contacts, keep your record current, and tie career moves to your longer-term goals.",
  instagram: "Instagram reflects your social activity: the accounts you follow, what you post and save, and how you engage. Prevail brings what you choose into your vault as a window into your interests and time spent. Your AI can use it to track what you have shared and saved, surface what is worth attention, and notice patterns in how you spend time there.",
  reddit: "Reddit holds your interests and activity: the communities you follow, your posts and comments, and what you save. Prevail brings what you choose into your vault so the topics you care about are part of your context. In context, your AI can surface saved content, track discussions you care about, and notice where your attention goes.",
  xtwitter: "X holds your feed and activity: who you follow, your posts, bookmarks, and engagement. Prevail brings what you choose into your vault as a signal of your interests and attention. Your AI can use it to surface what you saved, track topics you care about, and notice patterns in how you spend time there.",

  // Smart home
  ring: "Ring holds your home security activity: doorbell and camera events, motion alerts, and recordings. Prevail brings the metadata you choose into your vault so what happens at home is part of your context. In context, your AI can surface events that need attention and keep a record of activity at your doors.",
  philipshue: "Philips Hue reflects your lighting: scenes, routines, and how your lights respond to your day. Prevail brings what you choose into your vault so your home routines are part of your context. Your AI can use it to align lighting with your schedule and surface routines worth automating.",
  googlehome: "Google Home holds your smart-home setup: devices, routines, and activity. Prevail brings what you choose into your vault so what is happening at home is part of your context. In context, your AI can track device activity, automate routines, and surface anything that needs attention.",

  // Dev and automotive
  github: "GitHub holds your code and project activity: repositories, issues, pull requests, commits, and reviews. Prevail brings these into your vault so the work you are building is part of your context. Your AI can use it to track work in flight, surface what needs review or attention, and keep engineering effort tied to your priorities.",
  zoom: "Zoom holds your meetings: scheduled calls, recordings, and transcripts. Prevail brings what you choose into your vault so what was said and decided is searchable alongside your other work. In context, your AI can pull out action items and decisions, keep follow-ups straight, and tie meetings to your tasks and calendar.",
  tesla: "Tesla exposes your vehicle: charge level and history, location, trips, climate, and software status. Prevail brings what you choose into your vault so your car is part of your daily context. Your AI can use it to plan charging and routes, track mileage and efficiency, and keep maintenance and costs in view.",
};

// Category-aware fallback for the long tail. The catalog runs to ~1,400+ apps,
// far more than is sensible to hand-write, so any app without a bespoke entry
// above leans on its primary domain to still produce a solid, multi-sentence
// Soul. Each domain says what that kind of app typically holds and what the
// agent does with it; the method clause explains how the data reaches the vault.
const CATEGORY_SOUL: Record<string, { holds: string; uses: string }> = {
  money: { holds: "your balances, transactions, transfers, and statements", uses: "track spending, cash flow, and net worth, flag unusual charges, and keep your budget and goals honest against real numbers" },
  credit: { holds: "your credit scores, report details, open accounts, and inquiries", uses: "watch your score over time, catch errors or signs of fraud early, and plan moves like paying down balances or applying for new credit" },
  investing: { holds: "your holdings, balances, trades, dividends, and performance", uses: "track allocation and returns, watch fees and risk, and keep your investing aligned with your goals" },
  taxes: { holds: "your income, expenses, receipts, and tax documents", uses: "organize deductible spending, estimate what you owe, and keep clean records ready well before filing season" },
  insurance: { holds: "your policies, coverage, premiums, claims, and renewal dates", uses: "track what you are covered for, surface gaps or overlaps, and remind you before renewals and deadlines" },
  realestate: { holds: "your listings, bookings, properties, and related costs", uses: "track value and expenses, plan stays or moves, and keep housing decisions tied to your budget and calendar" },
  health: { holds: "your records, results, prescriptions, appointments, and visit history", uses: "keep a clear picture of your health over time, track medications and follow-ups, and prepare for appointments with full context" },
  fitness: { holds: "your workouts, activity, heart rate, sleep, and recovery", uses: "see training load and recovery trends, balance hard and easy days, and tie performance to sleep, nutrition, and schedule" },
  email: { holds: "your messages, threads, contacts, and attachments", uses: "surface what needs a reply, pull out commitments, receipts, and dates, and keep important threads from getting buried" },
  communication: { holds: "your conversations, contacts, and shared files", uses: "track open threads and commitments, surface what needs a response, and keep the people and decisions that matter in context" },
  productivity: { holds: "your notes, tasks, projects, and documents", uses: "keep tasks and deadlines in one place, connect notes to the work they belong to, and turn loose ideas into tracked next steps" },
  calendar: { holds: "your events, meetings, invitations, and availability", uses: "protect focus time, spot conflicts and travel gaps, and plan your days around what actually matters" },
  files: { holds: "your documents, photos, and stored files", uses: "find the right file fast, keep important records together, and bring relevant documents into whatever you are working on" },
  security: { holds: "your logins, passkeys, and security alerts", uses: "map where your accounts live, flag weak or reused credentials and breaches, and keep your digital life locked down" },
  career: { holds: "your profile, connections, documents, and professional activity", uses: "track opportunities and contacts, keep your record current, and tie career moves to your longer-term goals" },
  shopping: { holds: "your orders, purchases, subscriptions, and delivery status", uses: "track spending and deliveries, watch recurring charges, and remember what you bought and when" },
  travel: { holds: "your trips, bookings, itineraries, loyalty points, and routes", uses: "keep itineraries in one place, track points and status, and plan trips that fit your schedule and budget" },
  smarthome: { holds: "your devices, routines, sensors, and activity", uses: "track what is happening at home, automate routines, and surface anything that needs attention" },
  social: { holds: "your posts, activity, connections, and saved content", uses: "track what you have shared and saved, surface what is worth your attention, and notice patterns in how you spend time there" },
  media: { holds: "your listening and viewing: the music, shows, and content you return to", uses: "shape focus and downtime, surface what fits the moment, and notice patterns in mood and routine worth acting on" },
  learning: { holds: "your courses, books, progress, and library", uses: "track what you are learning and reading, keep momentum on goals, and surface the next thing worth your time" },
  government: { holds: "your official records, benefits, filings, and notices", uses: "keep important documents and deadlines in one place, track benefits and obligations, and never miss a required action" },
  utilities: { holds: "your accounts, usage, bills, and service status", uses: "track usage and costs, catch billing surprises, and stay ahead of due dates and outages" },
  automotive: { holds: "your vehicle status, trips, charging or fuel, and service history", uses: "track mileage and maintenance, plan routes and charging, and keep ownership costs in view" },
  food: { holds: "your orders, reservations, favorites, and delivery history", uses: "track food spending, remember the places and dishes you liked, and plan meals around your schedule and budget" },
  family: { holds: "your shared schedules, contacts, tasks, and care arrangements", uses: "keep the household coordinated, track commitments and appointments, and make sure nothing for the people you care about slips" },
  giving: { holds: "your donations, pledges, and giving history", uses: "track what you have given, keep records ready for taxes, and align your giving with the causes you care about" },
  legal: { holds: "your documents, contracts, signatures, and deadlines", uses: "keep agreements and key dates in one place, track what needs signing or review, and have the right documents on hand" },
  news: { holds: "the sources, topics, and articles you follow", uses: "surface what matters to you, cut through the noise, and keep you current on the subjects you track" },
  dev: { holds: "your repositories, issues, builds, and project activity", uses: "track work in flight, surface what needs review or attention, and keep engineering effort tied to your priorities" },
};

const CATEGORY_SOUL_DEFAULT = { holds: "the records it keeps about you", uses: "fold that into the context your AI reasons over and put it to work on the goals you set" };

// Build the "how the data reaches your vault" clause from the connection method.
function howClause(name: string, method: string): string {
  return method === "Browser"
    ? `Prevail signs into ${name} once in a real browser, learns how to fetch what you ask for, and replays that automatically on a schedule.`
    : method === "MCP"
      ? `Prevail talks to ${name} through its MCP server and pulls what you ask for on a schedule.`
      : method === "API"
        ? `Prevail connects to the ${name} API and pulls what you ask for on a schedule.`
        : `Prevail connects to ${name} and keeps what you ask for in sync on a schedule.`;
}

// Compose a rich, instruction-style description of what connecting this app
// does: what data it exposes, how it is collected into the vault, and how it is
// used. Used as the always-shown "How this connection works" block in the Soul
// tab so every app reads richly. Bespoke text covers the curated set above; the
// long tail uses the category-aware composer keyed on the app's primary domain.
function richSoulFor(app: EngineApp): string {
  const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const hit = SOUL_DETAILS[norm(app.id)] || SOUL_DETAILS[norm(app.title || "")];
  if (hit) return hit;
  const name = app.title || app.id;
  const method = methodLabel(app.integration);
  const domain = (app.domains ?? [])[0] || "";
  const cat = CATEGORY_SOUL[domain] || CATEGORY_SOUL_DEFAULT;
  return `${name} holds ${cat.holds}. ${howClause(name, method)} Everything it pulls lands in your private vault, where your AI can ${cat.uses}.`;
}

// One skill row in the Skills tab: brand-neutral icon, name, where it came from
// (starter / learned), the method it runs by, a primary/fallback indicator, and
// a Run control.
function SkillRow({ s, label, method, primary, disabled, running, onRun }: {
  s: AppSkill;
  label: string;
  method: "Browser" | "MCP" | "API" | "Other";
  primary: boolean;
  disabled?: boolean;
  running?: boolean;
  onRun?: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Sparkles className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-text-primary">{label}</span>
          <Star className={`h-3 w-3 shrink-0 ${primary ? "fill-accent text-accent" : "text-text-muted/50"}`} aria-label={primary ? "Primary skill" : "Fallback skill"} />
        </div>
        <div className="text-[11px] text-text-muted">{s.source === "starter" ? "Starter" : "Learned"} · {primary ? "Primary" : "Fallback"}{s.trigger ? ` · ${s.trigger}` : ""}</div>
        {s.summary && <div className="truncate text-[11px] text-text-muted/80">{s.summary}</div>}
      </div>
      <span className="inline-flex shrink-0 items-center rounded-full border border-border-subtle bg-surface-warm px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">{method}</span>
      <button onClick={onRun} disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} {running ? "Running…" : "Run"}
      </button>
    </li>
  );
}

// Live runner for a single skill. Spawns engine_app_run_skill and renders the
// streamed ChatEvent NDJSON (engine-skill:line / engine-skill:done), reusing the
// same stream shape as chat / agent runs. A browser-method skill performs its
// first-time login on the first run, so this doubles as the "Run setup" path.
function SkillRunPanel({ appId, skill, label, vaultPath, onClose, onDone }: {
  appId: string;
  skill: string;
  label: string;
  vaultPath: string;
  onClose: () => void;
  onDone?: (ok: boolean) => void;
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
      const session = `skillrun-${crypto.randomUUID()}`;
      sessionRef.current = session;
      const unLine = await listen<{ session: string; stream?: string; data: ChatEvent | string }>("engine-skill:line", (e) => {
        const p = e.payload;
        if (p.session !== session) return;
        // stderr / non-JSON lines: keep them visible so failures surface honestly.
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
      invoke("engine_app_run_skill", { session, vault: vaultPath, app: appId, skill }).catch((err) => {
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
  }, [appId, skill]);
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
            ? <span className="inline-flex items-center gap-1.5 text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> starting the skill… a browser may open for first-time sign-in.</span>
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

// One-paragraph "what connecting does" overview for the Welcome tab.
function welcomeText(app: EngineApp, notConnected: boolean): string {
  const name = app.title || app.id;
  if (notConnected) {
    return `Connecting ${name} lets Prevail pull your data from ${name} into your private vault on this Mac. You connect once; Prevail confirms the best method, drives any sign-in for you, then keeps the data in sync. Once connected, it is available as context to any domain you point it at, with no copies leaving your machine unless you say so.`;
  }
  return `${name} is connected and feeding your vault. Prevail keeps its data in sync on the schedule you set, and that data is available as context to the domains it feeds. Use the tabs below to give it a soul, see the skills Prevail has learned on it, manage which domains it feeds, or open a chat scoped to ${name}.`;
}

// App/domain parity: the Journal tab. An app is a domain with a little more, so a
// connected app keeps the SAME context bundle a domain does - state, decisions,
// journal, and recent activity logs - written under vault/data/apps/<id>/. This
// reads that bundle via the `app_context` command (mirrors `domain_context`) and
// renders it self-contained, the way domainpanels shows a domain's context. Empty
// fields are normal for a freshly-connected app: the record builds as it syncs.
function AppContextView({ vaultPath, appId, appTitle, card }: { vaultPath: string; appId: string; appTitle: string; card: string }) {
  const [ctx, setCtx] = useState<DomainContextBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    invoke<DomainContextBundle>("app_context", { vault: vaultPath, appId })
      .then((c) => { if (live) { setCtx(c); setLoading(false); } })
      .catch((e) => { if (live) { setErr(String(e)); setLoading(false); } });
    return () => { live = false; };
  }, [vaultPath, appId]);

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading {appTitle} journal…</div>;
  }
  if (err) {
    return <div className="rounded-lg border border-err/40 bg-err/10 px-3 py-2 text-xs text-err">Couldn't load this app's journal: {err}</div>;
  }
  const c = ctx;
  const isEmpty = !c || (!c.state && !c.decisions && !c.journal && c.recent_logs.length === 0);
  if (isEmpty) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-xl border border-dashed border-border bg-surface/40 px-4 py-8 text-center">
          <Activity className="mx-auto h-7 w-7 text-text-muted opacity-50" />
          <p className="mt-3 text-sm text-text-secondary">No journal yet - this builds as the app syncs and you work with it.</p>
          <p className="mt-1 text-xs text-text-muted">State, decisions, and activity for {appTitle} are kept under vault/data/apps/{appId}/, just like a domain.</p>
        </div>
      </div>
    );
  }
  const block = "max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-background px-3 py-2.5 text-[12px] leading-relaxed text-text-secondary";
  return (
    <div className="max-w-2xl space-y-4">
      {c!.state && (
        <div className={card}>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><FileText className="h-4 w-4 text-accent" /> State</h3>
          <p className="mt-1 text-[12px] text-text-muted">Snapshot of where things stand now.</p>
          <pre className={`mt-2 ${block}`}>{c!.state}</pre>
        </div>
      )}
      {c!.journal && (
        <div className={card}>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Activity className="h-4 w-4 text-accent" /> Journal</h3>
          <p className="mt-1 text-[12px] text-text-muted">The running record this app keeps; the rest is distilled from it.</p>
          <pre className={`mt-2 ${block}`}>{c!.journal}</pre>
        </div>
      )}
      {c!.decisions && (
        <div className={card}>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Check className="h-4 w-4 text-accent" /> Decisions</h3>
          <p className="mt-1 text-[12px] text-text-muted">What was decided and why.</p>
          <pre className={`mt-2 ${block}`}>{c!.decisions}</pre>
        </div>
      )}
      {c!.recent_logs.length > 0 && (
        <div className={card}>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Clock className="h-4 w-4 text-accent" /> Recent activity</h3>
          <ul className="mt-2 space-y-1.5">
            {c!.recent_logs.map((l) => (
              <li key={l.path} className="rounded-lg border border-border-subtle bg-background px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-text-secondary">{l.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-text-muted">{relTime(l.mtime_secs * 1000)}</span>
                </div>
                {l.preview && <div className="mt-0.5 truncate text-[11px] text-text-muted">{l.preview}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AppDetail({ app, vaultPath, logos, status, busy, onSync, onSetEnabled, onReload, gatewayProvider, connect }: {
  app: EngineApp;
  vaultPath: string;
  logos: Record<string, BrandLogo>;
  status: AppStatus;
  busy: boolean;
  onSync: () => Promise<SyncResult | void>;
  onSetEnabled: (v: boolean) => void;
  onReload: () => void | Promise<unknown>;
  // Set when this is an un-added CATALOG app: the SAME detail view renders, but
  // the primary action is Connect (not Sync), and connected-only bits are muted.
  // This is what makes catalog + connected apps share one view.
  connect?: { onConnect: () => void; connecting: boolean; soul?: string; skills?: CatalogSkill[]; onResearch?: () => void };
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
  // as a reusable skill (vault/data/apps/<id>/skills/), and replays it next time.
  const [learnMode, setLearnMode] = useState<ConnectorRunMode | null>(null);
  const [composing, setComposing] = useState(false);
  const [goalText, setGoalText] = useState("");
  // Which detail tab is showing. AppDetail is keyed by app.id upstream, so this
  // resets to "welcome" whenever a different app is selected.
  const [tab, setTab] = useState<AppTab>("welcome");
  const [skills, setSkills] = useState<AppSkill[]>([]);
  const loadSkills = useCallback(() => {
    invoke<AppSkill[]>("engine_app_skills", { id: app.id })
      .then((s) => setSkills(Array.isArray(s) ? s : []))
      .catch(() => setSkills([]));
  }, [app.id]);
  useEffect(() => { loadSkills(); }, [loadSkills, app.lastSuccessTs]);
  // Which skill is running inline (its streamed progress shows in the Skills tab).
  const [runningSkill, setRunningSkill] = useState<string | null>(null);
  // The skill Prevail runs by default. Starter packs ship runnable pre-connect,
  // so this is set even for apps the user has not pressed Connect on (#19).
  const primarySkill = useMemo(() => skills.find((s) => s.primary) ?? skills[0] ?? null, [skills]);
  const hasRunnableSkills = skills.length > 0;
  // "Run setup": run the primary skill (a browser skill signs you in on its
  // first run), surfacing progress in the Skills tab. No separate Connect gate.
  const runSetup = useCallback(() => {
    if (!primarySkill) return;
    setTab("skills");
    setRunningSkill(primarySkill.id);
  }, [primarySkill]);
  // Per-app soul: the same construct domains use (soul.md) — a markdown note
  // declaring WHY this app is in the harness, persisted to vault/data/apps/<id>/soul.md and
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
      setTab("skills");
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
  // #49: the old "Connect" button was confusing - skills run without it, and the
  // Skills tab itself says "no Connect step required". Its one real job is to
  // scaffold the catalog app into your vault (so you can configure it / teach
  // skills), so it's labeled for that purpose and only shown when the app has no
  // runnable skills yet. When starter skills exist, the scaffold happens quietly
  // (Run setup / Learn a skill add the app on first run) and the button is dropped.
  const ConnectBtn = ({ label }: { label: string }) => (
    <button onClick={() => connect?.onConnect()} disabled={connect?.connecting}
      title="Add this app to your vault so you can teach it skills and set its schedule. Skills can run without this."
      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-60">
      {connect?.connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {connect?.connecting ? "Adding…" : label}
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
            <MethodBadge method={methodOf(app)} className="text-[10px]" />
            {gatewayProvider && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                <Check className="h-2.5 w-2.5" /> via {titleCase(gatewayProvider)}
              </span>
            )}
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
          <button onClick={() => toggleFavorite(favKey)} title={isFav ? "On your home screen, click to remove" : "Add to your home screen"} aria-pressed={isFav}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${isFav ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"}`}>
            <Star className={`h-4 w-4 ${isFav ? "fill-accent" : ""}`} />
          </button>
          {/* #19/#49: when the app has runnable skills (starter packs ship ready),
              the ONE primary action is "Run setup" (runs the primary skill, which
              handles any first-time sign-in). There is no separate Connect button -
              skills run without it and the scaffold happens quietly on first run.
              The status chip next to the title reflects whether a run has succeeded. */}
          {hasRunnableSkills && (
            <button onClick={runSetup} disabled={!!runningSkill || !!learnMode}
              title="Run the primary skill. A browser-based skill signs you in on its first run."
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-60">
              {runningSkill ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run setup
            </button>
          )}
          {notConnected ? (
            // #52: the transparent agentic path - Prevail researches the best way
            // to connect (MCP / API / CLI / browser), recommends it with a reason,
            // and sets it up after you confirm. Shown alongside the quick add.
            <>
              {connect?.onResearch && (
                <button onClick={() => connect.onResearch!()} disabled={connect?.connecting}
                  title="Prevail researches MCP, an official API, a local CLI, or a guided browser login, recommends the best one with a reason, then sets it up after you confirm."
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3 py-2 text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-60">
                  <Search className="h-4 w-4" /> Find the best way
                </button>
              )}
              {hasRunnableSkills ? null : <ConnectBtn label="Add to my apps" />}
            </>
          ) : (
            <button onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-app", { detail: app }))} title="Open in chat"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-background hover:bg-accent-hover">
              <MessageSquare className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tabbed detail (fix #7), mirroring the chat-experience tab pattern: a
          pill row, one panel shown at a time. */}
      <div className="border-b border-border-subtle px-6">
        <div className="flex flex-wrap items-center gap-1 pb-3">
          {([
            { id: "welcome", label: "Welcome", icon: Plug },
            { id: "soul", label: "Soul", icon: Sparkles },
            // App/domain parity: a connected app keeps a journal + state + decisions
            // just like a domain. Catalog (not-yet-added) apps have no data dir, so
            // the tab only appears once the app exists in the vault.
            ...(!notConnected ? [{ id: "journal" as const, label: "Journal", icon: Activity }] : []),
            { id: "skills", label: "Skills", icon: Boxes },
            { id: "connections", label: "Connections", icon: Link2 },
            ...(!notConnected ? [{ id: "chat" as const, label: "Chat", icon: MessageSquare }] : []),
          ] as { id: AppTab; label: string; icon: typeof Plug }[]).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  // Chat reuses the existing app-chat navigation (the same event
                  // the header chat button fires) instead of rendering inline.
                  if (t.id === "chat") { window.dispatchEvent(new CustomEvent("prevail:open-app", { detail: app })); return; }
                  setTab(t.id);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-accent text-background shadow-sm" : "text-text-muted hover:bg-surface-warm hover:text-text-secondary"}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {t.id === "skills" && skills.length > 0 && <span className={`rounded-full px-1.5 py-px font-mono text-[9px] ${active ? "bg-background/20 text-background" : "bg-surface-warm text-text-muted"}`}>{skills.length}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-6 py-5">
        {/* WELCOME - a short overview of what connecting this app does. */}
        {tab === "welcome" && (
          <div className="max-w-2xl space-y-4">
            <div className={card}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Plug className="h-4 w-4 text-accent" /> What connecting {app.title || app.id} does</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">{welcomeText(app, notConnected)}</p>
              <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                {!gatewayProvider && !learnedLane && <CatalogField label="Connection">{methodLabel(app.integration)}</CatalogField>}
                {gatewayProvider && <CatalogField label="Connection">{`Via ${titleCase(gatewayProvider)}`}</CatalogField>}
                <CatalogField label="Status">{meta.label}</CatalogField>
                {domainsLine && <CatalogField label="Feeds domains">{domainsLine}</CatalogField>}
              </dl>
            </div>
            {/* What it can do - the curated skills this connector gives the agent,
                shown before connecting so the value is clear up front. Comes from
                the catalog (connect.skills); once added, the Skills tab shows the
                real runnable skills. */}
            {connect?.skills && connect.skills.length > 0 && (
              <div className={card}>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Zap className="h-4 w-4 text-accent" /> What it can do</h3>
                <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {connect.skills.map((s) => (
                    <li key={s.id} className="rounded-lg border border-border-subtle bg-background px-3 py-2">
                      <div className="text-[13px] font-medium text-text-primary">{s.title}</div>
                      <div className="mt-0.5 text-[12px] leading-relaxed text-text-secondary">{s.description}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* SOUL - the editable note plus a rich, instruction-style description. */}
        {tab === "soul" && (
          <div className="max-w-2xl space-y-4">
            <div className={`${card} flex flex-col`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Sparkles className="h-4 w-4 text-accent" /> Soul</h3>
                {!editSoul && <button onClick={openSoulEditor} title="Edit soul" className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:border-accent-border hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>}
              </div>
              {editSoul ? (
                <div className="mt-2 flex flex-col">
                  <textarea autoFocus rows={5} value={soulDraft} onChange={(e) => setSoulDraft(e.target.value)}
                    placeholder={`Why ${app.title || app.id} is in your harness: what it feeds your world.`}
                    className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted/60 focus:border-accent-border focus:outline-none" />
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={saveSoul} disabled={soulBusy} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{soulBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save</button>
                    <button onClick={() => setEditSoul(false)} className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary">Cancel</button>
                    <span className="ml-auto font-mono text-[10px] text-text-muted/70">vault/data/apps/{app.id}/soul.md</span>
                  </div>
                </div>
              ) : soulText.trim() ? (
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">{soulText.trim()}</p>
              ) : (
                <button onClick={openSoulEditor} className="mt-2 flex flex-col items-start justify-center rounded-lg border border-dashed border-border bg-surface/40 px-4 py-5 text-left hover:border-accent-border">
                  <span className="text-[13px] text-text-secondary">Give {app.title || app.id} a soul.</span>
                  <span className="mt-0.5 text-[12px] text-text-muted">Why it's in your harness: your AI reads this as standing context.</span>
                </button>
              )}
            </div>
            {/* Always-shown rich elaboration: what it exposes, how it reaches the
                vault, and how it is used. Leaves the editable note above untouched. */}
            <div className={card}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><HelpCircle className="h-4 w-4 text-accent" /> How this connection works</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">{richSoulFor(app)}</p>
            </div>
          </div>
        )}

        {/* JOURNAL - app/domain parity. The same rich context a domain exposes:
            state snapshot, distilled decisions, the running journal, and recent
            activity logs. Builds up as the app syncs and you work with it. */}
        {tab === "journal" && !notConnected && (
          <AppContextView vaultPath={vaultPath} appId={app.id} appTitle={app.title || app.id} card={card} />
        )}

        {/* SKILLS (#17) - the app's REAL runnable skills, including shipped
            starter packs. Each row shows its method badge + primary/fallback
            indicator + a Run control that streams progress inline. "Learn New
            Skill" is kept so the user can still teach their own. */}
        {tab === "skills" && (
          <div className="w-full">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Sparkles className="h-4 w-4 text-accent" /> Skills{skills.length > 0 && <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-muted">{skills.length}</span>}</div>
              {!learnMode && !composing && (
                <button onClick={() => { setGoalText(""); setComposing(true); }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10">
                  <Plus className="h-3.5 w-3.5" /> Learn New Skill
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[12px] text-text-muted">Actions Prevail can run for you on {app.title || app.id}. Starter skills ship ready to run; you can also teach your own. Each runs by a method (Browser, MCP, or API), and your primary skill is the one Prevail runs by default. Run a skill any time, no Connect step required.</p>

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
                <p className="text-[11px] text-text-muted">Your Chrome opens, log in once. I'll learn the steps and remember the folder and cadence from what you said.</p>
              </div>
            ) : (
              <>
                {/* Inline runner for the skill being run (streams progress). */}
                {runningSkill && (() => {
                  const rs = skills.find((s) => s.id === runningSkill);
                  return (
                    <SkillRunPanel
                      appId={app.id}
                      skill={runningSkill}
                      label={rs ? (rs.name || humanizeSkill(rs.id)) : humanizeSkill(runningSkill)}
                      vaultPath={vaultPath}
                      onClose={() => setRunningSkill(null)}
                      onDone={(ok) => { if (ok) { loadSkills(); void onReload(); } }}
                    />
                  );
                })()}
                {skills.length === 0 ? (
                  <div className="mt-3 rounded-lg border border-dashed border-border bg-surface/40 px-4 py-4 text-center">
                    <div className="text-[13px] text-text-secondary">No skills yet.</div>
                    <div className="mt-0.5 text-[12px] text-text-muted">Click <span className="text-accent">Learn New Skill</span> and say what to fetch{notConnected ? "; I'll set it up and learn it in one go." : <>: saved in <code className="rounded bg-surface-warm px-1 font-mono text-[11px]">vault/data/apps/{app.id}/skills/</code></>}.</div>
                  </div>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {skills.map((s, i) => (
                      <SkillRow key={s.id} s={s} label={s.name || humanizeSkill(s.id)} method={skillMethod(s)} primary={s.primary ?? s.favorite ?? i === 0}
                        disabled={!!learnMode || (!!runningSkill && runningSkill !== s.id)} running={runningSkill === s.id}
                        onRun={() => setRunningSkill(s.id)} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {/* CONNECTIONS - downloads / browser sync AND the editable connected-domains
            list, combined (fix #7). "Domains fed" is renamed "Connected domains". */}
        {tab === "connections" && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {!gatewayProvider ? (
              <div className={`${card} flex flex-col`}>
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
                  {/* #20: trimmed copy, and "Import login" is reachable directly
                      (no longer gated behind a connected state). */}
                  <p className="text-center text-[12px] leading-snug text-text-muted">Log in once in Chrome; the agent learns to fetch your data, then replays it.</p>
                  <div className="mt-3 flex flex-col items-center">
                    <button onClick={importLogins} disabled={importing}
                      title="Already signed into this site in Chrome? Import that login (quit Chrome first) to skip signing in."
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
                      {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} {importing ? "Importing…" : "Import login from browser"}
                    </button>
                    {importMsg && <p className={`mt-1.5 text-center text-[11px] ${importMsg.startsWith("✓") ? "text-ok" : "text-err"}`}>{importMsg}</p>}
                  </div>
                </div>
              </div>
            ) : (
              <div className={`${card} flex flex-col justify-center`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Check className="h-4 w-4 text-accent" /> Connected via {titleCase(gatewayProvider)}</div>
                <p className="mt-2 text-[12px] leading-relaxed text-text-muted">{app.title || app.id} is fronted by {titleCase(gatewayProvider)}. Authorization and data fetch run through the gateway.</p>
              </div>
            )}

            {/* Connected domains (renamed from "Domains fed"), editable. */}
            <div className={`${card} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Tag className="h-4 w-4 text-accent" /> Connected domains</div>
                {!editDomains && !notConnected && <button onClick={openDomainEditor} title="Add or remove domains this app feeds" className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:border-accent-border hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>}
              </div>
              <p className="mt-1.5 text-[12px] text-text-muted">Domains {app.title || app.id} feeds.{notConnected ? "" : " Use the pencil to edit."}</p>
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
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-6 py-4">
        {notConnected ? (
          <span className="inline-flex items-center gap-2.5 text-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-border text-text-muted"><Plug className="h-4 w-4" /></span>
            <span><span className="font-medium text-text-primary">Not added yet.</span> <span className="text-text-muted">Run a skill, or add {app.title || app.id} to your apps to start feeding your vault.</span></span>
          </span>
        ) : syncMsg ? (
          <span className={`inline-flex items-center gap-2 text-sm ${syncMsg.startsWith("Sync failed") ? "text-err" : "text-text-secondary"}`}>
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
            <button onClick={removeApp} disabled={deleting} className="inline-flex items-center gap-1.5 rounded-md border border-err/50 bg-err/10 px-2.5 py-1.5 text-[11px] text-err hover:bg-err/20 disabled:opacity-50">{deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete {app.title} for good</button>
            <button onClick={() => { setConfirmDelete(false); setDeleteErr(null); }} className="text-[11px] text-text-muted hover:text-text-secondary">cancel</button>
            {deleteErr && <span className="text-[11px] text-err">{deleteErr}</span>}
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            <button onClick={() => void runSync()} disabled={busy} title="Sync now" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {busy ? "Syncing…" : "Sync"}</button>
            <button onClick={openSchedModal} title={`Schedule & sync: ${scheduleLabel(app.refresh)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-accent-border hover:text-accent"><Clock className="h-3.5 w-3.5" /> Schedule{enabled && app.refresh ? <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-ok" /> : null}</button>
            {app.path && <button onClick={() => void invoke("open_in_finder", { path: app.path! }).catch(() => {})} title="Open folder" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted hover:border-accent-border hover:text-accent"><FolderOpen className="h-4 w-4" /></button>}
            <button onClick={() => setConfirmDelete(true)} title="Remove this app entirely" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-err/10 hover:text-err"><Trash2 className="h-4 w-4" /></button>
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
