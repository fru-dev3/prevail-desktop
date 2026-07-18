// The domain/navigation Sidebar, extracted from App.tsx. Prop-driven (collapse
// state, domains, active selection, and a set of callbacks); renders the live
// gateway/MCP/benchmark status strips from shared modules.
import { Fragment, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { ArrowUpRight, Activity, Archive, Briefcase, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Folder, Layers, Loader2, MessagesSquare, Monitor, Moon, MoreVertical, Pin, Plug, Plus, PowerOff, RotateCcw, Settings as SettingsIcon, Sparkles, StarOff, Sun, Waypoints, X } from "lucide-react";
import { PrevailLogo } from "./PrevailLogo";
import { invoke } from "./bridge";
import { STATUS_TINT } from "./constants";
import { appName, scoreColor, titleCase } from "./format";
import { lsGet, lsSet } from "./storage";
import { favKeyOf, toggleFavorite, useFavorites } from "./appfavorites";
import { SidebarGatewayLive, SidebarMcpLive } from "./panels";
import { ProfileSwitcher } from "./profileswitcher";
import { EDITOR_NAV, WORK_NAV } from "./navdefs";
import { domainIcon } from "./icons";
import { useAppearance } from "./hooks";
import { SidebarBackupActive, SidebarBenchmarkRuns, SidebarBenchScheduled, SidebarProcesses } from "./cards";
import { useProcesses } from "./processes";
import { BENCH_SCHED, useBenchBatches } from "./bench";
import { BACKUP_CFG } from "./backup";
import { BrandMark } from "./brandmark";
import { AppRowLogo } from "./panels3";
import type { BrandLogo, CatalogApp, ConnectorCatalog, Domain, EngineApp, LifeReadiness, Mode, TabId } from "./types";

// Shared "selected row" treatment for every selectable nav row in the sidebar
// (General, Work, Domains, Apps). A solid accent fill reads as a clear,
// high-contrast selected state rather than a faint tint, and keeps the active
// item looking identical no matter which section it lives in.
const SEL_ROW = "bg-accent text-background font-semibold shadow-sm";
// Collapsed icon-rail version (icon only, no label so no font-weight needed).
const SEL_ICON = "bg-accent text-background shadow-sm";

export function Sidebar({
  collapsed,
  setCollapsed,
  vaultPath,
  domains,
  vaultError,
  selectedDomain,
  setSelectedDomain,
  activeAppId,
  openInFinder,
  tab,
  setTab,
  onDomainCreated,
  appearance,
  runningDomains,
  finishedDomains,
  domainStats,
  railWidth,
  onOpenOnboarding,
  onDomainsChanged,
  onOpenApp,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean | ((cur: boolean) => boolean)) => void;
  vaultPath: string;
  domains: Domain[];
  vaultError: string | null;
  selectedDomain: string | null;
  setSelectedDomain: (n: string) => void;
  activeAppId: string | null;
  openInFinder: (p: string | null) => void;
  tab: TabId;
  setTab: (t: TabId) => void;
  onDomainCreated: (d: Domain) => void;
  appearance: ReturnType<typeof useAppearance>;
  runningDomains: Set<string>;
  finishedDomains: Set<string>;
  domainStats: Record<string, number>;
  railWidth: number;
  onOpenOnboarding: () => void;
  onDomainsChanged: () => void;
  onOpenApp: (app: EngineApp) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  // Pinned domains live in localStorage as a comma-separated slug list.
  const PIN_KEY = "prevail.desktop.pinnedDomains";
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try {
      const raw = lsGet(PIN_KEY);
      return new Set(raw ? raw.split(",").filter(Boolean) : []);
    } catch { return new Set(); }
  });
  // Group collapse - Pinned vs All. Persisted so collapsing survives
  // app restarts.
  const [pinnedOpen, setPinnedOpen] = useState<boolean>(() => lsGet("prevail.sidebar.pinnedOpen") !== "0");
  // "All" collapsed by default so Domains opens just one level (Pinned + the
  // All header with its count), keeping the rail compact rather than listing
  // every domain. The header stays visible when collapsed, so nothing is lost.
  const [allOpen, setAllOpen] = useState<boolean>(() => lsGet("prevail.sidebar.allOpen") === "1");
  useEffect(() => { lsSet("prevail.sidebar.pinnedOpen", pinnedOpen ? "1" : "0"); }, [pinnedOpen]);
  useEffect(() => { lsSet("prevail.sidebar.allOpen", allOpen ? "1" : "0"); }, [allOpen]);
  const togglePin = (name: string) => {
    setPinned((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      lsSet(PIN_KEY, Array.from(next).join(","));
      return next;
    });
  };
  const railFilter = ""; // domain filter input removed from the sidebar
  // App-wide aggregate score (mean of every domain's context score) - the
  // single "how ready is my whole life-OS" number, pinned bottom-left.
  const [lifeScore, setLifeScore] = useState<{ value: number; count: number } | null>(null);
  // Agent-operable score from the Map panel (broadcast + cached), so this chip
  // deep-links to the Map without the sidebar re-scanning apps itself.
  const [mapScore, setMapScore] = useState<number | null>(() => {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem("prevail:map-score") : null;
    return v !== null && v !== "" ? Number(v) : null;
  });
  useEffect(() => {
    const onScore = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (typeof v === "number") setMapScore(v);
    };
    window.addEventListener("prevail:map-score", onScore);
    return () => window.removeEventListener("prevail:map-score", onScore);
  }, []);
  useEffect(() => {
    let on = true;
    invoke<LifeReadiness>("engine_score_all", { vault: vaultPath })
      .then((lr) => {
        if (on && lr && lr.life_readiness !== null) {
          setLifeScore({ value: lr.life_readiness, count: lr.domains.length });
        }
      })
      .catch(() => {});
    return () => { on = false; };
  }, [vaultPath, domains.length]);
  const sortedDomains = useMemo(() => {
    const q = railFilter.trim().toLowerCase();
    const isPinned = (d: Domain) => pinned.has(d.name);
    const matches = (d: Domain) =>
      !q ||
      d.name.toLowerCase().includes(q) ||
      titleCase(d.name).toLowerCase().includes(q);
    // Hide internal / app-scope pseudo-domains (e.g. "_app-composio-notion",
    // "_meta"): the sidebar lists real DOMAINS only, never apps. Apps live in
    // their own Apps section (and on the home screen when starred).
    const filtered = domains.filter((d) => !d.name.startsWith("_")).filter(matches);
    const pin = filtered.filter(isPinned);
    const rest = filtered.filter((d) => !isPinned(d));
    return [...pin, ...rest];
  }, [domains, pinned, railFilter]);
  const [addError, setAddError] = useState<string | null>(null);

  async function createDomain() {
    setAddError(null);
    try {
      const d = await invoke<Domain>("create_domain", { vault: vaultPath, name: newName });
      onDomainCreated(d);
      setNewName("");
      setAdding(false);
    } catch (e) {
      setAddError(String(e));
    }
  }

  // Domains top-level collapse.
  const [domainsOpen, setDomainsOpen] = useState<boolean>(() => lsGet("prevail.sidebar.domainsOpen") !== "0");
  useEffect(() => { lsSet("prevail.sidebar.domainsOpen", domainsOpen ? "1" : "0"); }, [domainsOpen]);

  // "Work" surfaces group — collapsible like Domains. Persisted.
  const [workOpen, setWorkOpen] = useState<boolean>(() => lsGet("prevail.sidebar.workOpen") !== "0");
  useEffect(() => { lsSet("prevail.sidebar.workOpen", workOpen ? "1" : "0"); }, [workOpen]);

  // Mode-aware nav (2026 redesign): the single left bar shows Work surfaces or
  // Editor sections depending on the active mode, rather than a second column.
  // Track which section is active for highlighting, kept in sync with the events
  // the content panels listen to.
  const [editorActive, setEditorActive] = useState("general");
  const [workActive, setWorkActive] = useState("tasks");
  useEffect(() => {
    const onEd = (e: Event) => { const d = (e as CustomEvent<string>).detail || "general"; setEditorActive(d.split(":")[0]); };
    const onWk = (e: Event) => { const d = (e as CustomEvent<string>).detail || "tasks"; setWorkActive(d); };
    window.addEventListener("prevail:settings-section", onEd as EventListener);
    window.addEventListener("prevail:work-section", onWk as EventListener);
    return () => {
      window.removeEventListener("prevail:settings-section", onEd as EventListener);
      window.removeEventListener("prevail:work-section", onWk as EventListener);
    };
  }, []);
  // App owns the actual mode switch + section jump (reliable even when the
  // content panel isn't mounted yet); we just reflect the choice + announce it.
  const selectEditor = (id: string) => { setEditorActive(id); window.dispatchEvent(new CustomEvent("prevail:settings-section", { detail: id })); };
  const selectWork = (id: string) => { setWorkActive(id); window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: id })); };

  // Archived domains - fetched from the engine. Shown in a collapsible
  // group at the bottom of the rail, each with a Restore action.
  const [archived, setArchived] = useState<string[]>([]);
  const [archivedOpen, setArchivedOpen] = useState<boolean>(() => lsGet("prevail.sidebar.archivedOpen") === "1");
  useEffect(() => { lsSet("prevail.sidebar.archivedOpen", archivedOpen ? "1" : "0"); }, [archivedOpen]);
  const [restoring, setRestoring] = useState<string | null>(null);
  // Which domain's kebab (⋮) action menu is open (one at a time).
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest("[data-domain-menu]")) setMenuOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);
  // Which app row's kebab (⋮) menu is open. Keyed by app id (connected rows) or
  // `cat-<favKey>` (starred-but-not-connected catalog rows); mirrors the domain
  // kebab so the Apps section gets the same hover-revealed action menu.
  const [appMenuOpen, setAppMenuOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!appMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest("[data-app-menu]")) setAppMenuOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [appMenuOpen]);
  const refreshArchived = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await invoke<string[]>("engine_list_archived", { vault: vaultPath });
      // A null (older engine, empty JSON body) must not crash the whole shell.
      setArchived(Array.isArray(list) ? list : []);
    } catch {
      // Engine may not support archiving yet - keep the group hidden.
      setArchived([]);
    }
  }, [vaultPath]);
  // Refresh when the active domain set changes (e.g. after archive/restore).
  useEffect(() => { void refreshArchived(); }, [refreshArchived, domains.length]);

  // Apps section - peer to Domains in the sidebar. The home screen shows ONLY
  // the apps the user has STARRED (favorited) - in the Apps panel, in any mode
  // (Direct, Composio, Nango). The favorites set is the shared ./appfavorites
  // store, so starring anywhere updates this list live.
  const [sidebarApps, setSidebarApps] = useState<EngineApp[]>([]);
  // Brand logos for the app rows, loaded once and keyed by toolkit/id so the
  // row can show the real mark instead of a bare status dot.
  const [appLogos, setAppLogos] = useState<Record<string, BrandLogo>>({});
  useEffect(() => { invoke<Record<string, BrandLogo>>("ingestion_connector_logos").then(setAppLogos).catch(() => {}); }, []);
  // The connector catalog, so apps the user STARRED but has not connected yet
  // still pin to the rail (matching the Apps panel "My list" - a star pins,
  // period, whether or not the app is connected).
  const [appCatalog, setAppCatalog] = useState<CatalogApp[]>([]);
  useEffect(() => { invoke<ConnectorCatalog>("ingestion_connector_catalog").then((c) => setAppCatalog(c?.apps ?? [])).catch(() => {}); }, []);
  const [appsOpen, setAppsOpen] = useState<boolean>(() => lsGet("prevail.sidebar.appsOpen") !== "0");
  useEffect(() => { lsSet("prevail.sidebar.appsOpen", appsOpen ? "1" : "0"); }, [appsOpen]);
  // Pinned apps - the exact parallel of pinned domains, so a favorite app can be
  // promoted to a "Pinned" group at the top of the Apps section. Keyed by the
  // app's favorite key (favKeyOf of title/id, or the catalog name) so it lines up
  // with how the star (favorites) keys each row. Persisted as a comma-separated
  // list, mirroring PIN_KEY for domains.
  const PINNED_APPS_KEY = "prevail.desktop.pinnedApps";
  const [pinnedApps, setPinnedApps] = useState<Set<string>>(() => {
    try {
      const raw = lsGet(PINNED_APPS_KEY);
      return new Set(raw ? raw.split(",").filter(Boolean) : []);
    } catch { return new Set(); }
  });
  const toggleAppPin = (key: string) => {
    setPinnedApps((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      lsSet(PINNED_APPS_KEY, Array.from(next).join(","));
      return next;
    });
  };
  // Apps "Pinned" vs "All" group collapse - mirrors pinnedOpen/allOpen for
  // domains so the two sections behave identically. Persisted across restarts.
  const [appsPinnedOpen, setAppsPinnedOpen] = useState<boolean>(() => lsGet("prevail.sidebar.appsPinnedOpen") !== "0");
  const [appsAllOpen, setAppsAllOpen] = useState<boolean>(() => lsGet("prevail.sidebar.appsAllOpen") === "1");
  useEffect(() => { lsSet("prevail.sidebar.appsPinnedOpen", appsPinnedOpen ? "1" : "0"); }, [appsPinnedOpen]);
  useEffect(() => { lsSet("prevail.sidebar.appsAllOpen", appsAllOpen ? "1" : "0"); }, [appsAllOpen]);
  useEffect(() => {
    let alive = true;
    const pull = () => { invoke<EngineApp[]>("engine_apps_list", { vault: vaultPath }).then((a) => { if (alive) setSidebarApps((a ?? []).map((x) => ({ ...x, title: appName(x.title) }))); }).catch(() => {}); };
    pull();
    // Re-pull when an app is added/removed elsewhere (e.g. the Apps catalog).
    const onChanged = () => pull();
    window.addEventListener("prevail:apps-changed", onChanged);
    return () => { alive = false; window.removeEventListener("prevail:apps-changed", onChanged); };
  }, [vaultPath]);
  // The home screen list = starred apps, across every connection mode, sorted
  // by name. Matched by the same normalized key the star writes (title or id).
  const favs = useFavorites();
  const favoritedSidebarApps = useMemo(
    () => sidebarApps
      .filter((a) => favs.has(favKeyOf(a.title || a.id)) || favs.has(favKeyOf(a.id)))
      .sort((a, b) => a.title.localeCompare(b.title)),
    [sidebarApps, favs],
  );
  // Starred catalog apps the user has NOT connected yet. Matched by the same
  // normalized name key the Apps panel uses (favKeyOf(name)), deduped, and
  // excluding any already shown as a connected row above so nothing appears
  // twice. This is what makes a star pin to the rail immediately, before the
  // app is connected - the behavior the Apps panel "My list" already has.
  const favoritedCatalogApps = useMemo(() => {
    const connectedKeys = new Set<string>();
    for (const a of favoritedSidebarApps) { connectedKeys.add(favKeyOf(a.title || a.id)); connectedKeys.add(favKeyOf(a.id)); }
    const seen = new Set<string>();
    return appCatalog
      .filter((c) => {
        const k = favKeyOf(c.name);
        if (!favs.has(k) || connectedKeys.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [appCatalog, favs, favoritedSidebarApps]);
  const pinnedAppCount = favoritedSidebarApps.length + favoritedCatalogApps.length;
  // Split both favorited lists into pinned vs the rest so pinned apps - across
  // connected and not-yet-connected rows alike - rise to a "Pinned" group at the
  // top, exactly like pinned domains. The existing per-list name sort is kept
  // within each group.
  const appBuckets = useMemo(() => {
    const isPinnedApp = (key: string) => pinnedApps.has(key);
    const pinnedSidebar = favoritedSidebarApps.filter((a) => isPinnedApp(favKeyOf(a.title || a.id)));
    const restSidebar = favoritedSidebarApps.filter((a) => !isPinnedApp(favKeyOf(a.title || a.id)));
    const pinnedCatalog = favoritedCatalogApps.filter((c) => isPinnedApp(favKeyOf(c.name)));
    const restCatalog = favoritedCatalogApps.filter((c) => !isPinnedApp(favKeyOf(c.name)));
    return { pinnedSidebar, restSidebar, pinnedCatalog, restCatalog };
  }, [favoritedSidebarApps, favoritedCatalogApps, pinnedApps]);
  const hasPinnedApps = appBuckets.pinnedSidebar.length + appBuckets.pinnedCatalog.length > 0;
  // The same app can be connected via Direct creds, Composio, or Nango (e.g.
  // two "Notion" rows). Surface which one each row is so identical titles are
  // distinguishable. The gateway provider is derived from the id prefix
  // (composio-* / nango-*) since that's how gateway apps are namespaced.
  const appMethod = (app: EngineApp): { label: string; toolkit: string } => {
    const g = (app as EngineApp & { gateway?: { provider?: string; toolkit?: string } }).gateway;
    if (g?.provider === "composio" || app.id.startsWith("composio-")) {
      return { label: "Composio", toolkit: g?.toolkit ?? app.id.replace(/^composio-/, "") };
    }
    if (g?.provider === "nango" || app.id.startsWith("nango-")) {
      return { label: "Nango", toolkit: g?.toolkit ?? app.id.replace(/^nango-/, "") };
    }
    return { label: "Direct", toolkit: app.id };
  };
  // One app row, reused by the Favorites and All groups. Highlights when it's
  // the app currently open in the canvas so "which app am I in" is obvious.
  const renderAppRow = (app: EngineApp) => {
    const tint = STATUS_TINT[app.status] ?? "#9aa0a6";
    const active = activeAppId === app.id;
    // A disabled app (its skill/connector has enabled === false) won't be run by
    // the sync daemon. Surface that here so it reads as off at a glance: muted
    // styling, a grey status dot, and a small "Off" badge. Absent/true = enabled.
    const disabled = app.enabled === false;
    const method = appMethod(app);
    // Pin key matches the favorite key the star writes (title preferred, id
    // fallback) so pinning lines up with whichever key favorited the row.
    const appPinKey = favKeyOf(app.title || app.id);
    const isAppPinned = pinnedApps.has(appPinKey);
    return (
      <li key={app.id} className="group flex items-center gap-1 pl-6">
        <button
          onMouseDown={(e) => {
            // Manual drag (WKWebView's HTML5 DnD is unreliable): on mouseup
            // after moving, call the chat panel's global app-attach hook so the
            // app drops into the composer as a context chip. Mirror of the
            // domain-row drag below.
            if (e.button !== 0) return;
            const startX = e.clientX;
            const startY = e.clientY;
            let dragging = false;
            let pill: HTMLDivElement | null = null;
            const onMove = (ev: MouseEvent) => {
              if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
              if (!dragging) {
                dragging = true;
                pill = document.createElement("div");
                pill.textContent = `◆ ${app.title}`;
                pill.style.cssText =
                  "position:fixed;z-index:9999;pointer-events:none;padding:6px 10px;" +
                  "border-radius:9999px;background:var(--color-accent,#0d7a6e);color:#fff;" +
                  "font-family:ui-monospace,monospace;font-size:11px;" +
                  "box-shadow:0 6px 20px rgba(0,0,0,0.2);transform:translate(-50%,-50%);";
                document.body.appendChild(pill);
                document.body.style.userSelect = "none";
              }
              if (pill) { pill.style.left = ev.clientX + "px"; pill.style.top = ev.clientY + "px"; }
            };
            const onUp = (ev: MouseEvent) => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
              document.body.style.userSelect = "";
              if (pill) { pill.remove(); pill = null; }
              if (!dragging) return; // a click, not a drag - let onClick fire
              ev.preventDefault();
              ev.stopPropagation();
              const hook = (window as unknown as { __prevailAttachApp?: (id: string) => void }).__prevailAttachApp;
              if (hook) hook(app.id);
              else console.warn("[prevail/drag] no app-attach hook: drop fell outside chat panel");
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
          onClick={() => onOpenApp(app)}
          className={`flex flex-1 cursor-grab items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors active:cursor-grabbing ${
            active
              ? SEL_ROW
              : disabled
                ? "text-text-muted hover:bg-surface-warm"
                : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
          }`}
          title={`${disabled ? `${app.title} is turned off and won't sync · ` : ""}Click to open ${app.title} (${method.label}) · drag into chat to attach as context${app.domains.length ? " · refreshes " + app.domains.map(titleCase).join(", ") : ""}`}
        >
          {/* Brand mark + a tiny status dot anchored to it so connection state
              stays visible. Gateway apps key the logo off the toolkit so e.g.
              "composio-notion" still resolves the Notion mark. */}
          <span className={`relative shrink-0 ${disabled && !active ? "opacity-50" : ""}`}>
            <AppRowLogo app={{ title: app.title, id: method.toolkit }} logos={appLogos} size={18} fallback="letter" />
            <span
              className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-surface-strong"
              style={{ backgroundColor: disabled ? "#9aa0a6" : tint }}
            />
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm">{app.title}</span>
              {disabled && (
                <span
                  className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0 font-mono text-[10px] uppercase tracking-wider ${active ? "bg-background/20 text-background" : "bg-surface-warm text-text-muted"}`}
                  title="This app is turned off and won't be synced"
                >
                  <PowerOff className="h-2.5 w-2.5" /> Off
                </span>
              )}
            </span>
            <span className={`truncate text-[10px] ${active ? "text-background/80" : "text-text-muted"}`}>{disabled ? "Off · " + method.label : method.label}</span>
          </span>
        </button>
        {/* Row actions collapsed into a kebab (⋮), matching the domain rows: a
            hover-revealed menu with open / open-in-Finder / remove-from-sidebar
            (the app equivalent of unpinning a domain). */}
        <div className="relative shrink-0" data-app-menu>
          <button
            onClick={(e) => { e.stopPropagation(); setAppMenuOpen((cur) => (cur === app.id ? null : app.id)); }}
            className={`flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent ${
              active || appMenuOpen === app.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            title="App actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {appMenuOpen === app.id && (
            <div className="absolute right-0 top-7 z-50 w-44 rounded-md border border-border bg-surface p-0.5 shadow-xl">
              {/* Pin to top - the app equivalent of pinning a domain. Promotes
                  this row into the "Pinned" group above; does NOT unfavorite. */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleAppPin(appPinKey); setAppMenuOpen(null); }}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-text-primary hover:bg-surface-warm"
              >
                <Pin className={`h-3 w-3 shrink-0 ${isAppPinned ? "fill-accent text-accent" : ""}`} /> {isAppPinned ? "Unpin" : "Pin to top"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setAppMenuOpen(null); onOpenApp(app); }}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-text-primary hover:bg-surface-warm"
              >
                <ExternalLink className="h-3 w-3 shrink-0" /> Open
              </button>
              {app.path && (
                <button
                  onClick={(e) => { e.stopPropagation(); setAppMenuOpen(null); openInFinder(app.path ?? null); }}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-text-primary hover:bg-surface-warm"
                >
                  <Folder className="h-3 w-3 shrink-0" /> Open in Finder
                </button>
              )}
              <div className="my-0.5 h-px bg-border-subtle" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setAppMenuOpen(null);
                  // Remove whichever key(s) pinned this app - id-keyed (AppDetail
                  // star) or name-keyed (Direct list star). Only delete present
                  // keys so this never accidentally re-adds.
                  const idK = favKeyOf(app.id), titleK = favKeyOf(app.title);
                  if (favs.has(idK)) toggleFavorite(idK);
                  if (titleK !== idK && favs.has(titleK)) toggleFavorite(titleK);
                }}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-text-primary hover:bg-surface-warm"
              >
                <StarOff className="h-3 w-3 shrink-0" /> Remove from sidebar
              </button>
            </div>
          )}
        </div>
      </li>
    );
  };

  // "Pinned" / "All" group header inside the Apps section - the visual + collapse
  // twin of the domain group headers (renderGroupHeader above).
  const renderAppGroupHeader = (label: "Pinned" | "All", open: boolean, set: (v: boolean) => void, count: number) => (
    <li key={`app-${label}-header`} className="mt-1 first:mt-0">
      <button
        onClick={() => set(!open)}
        title={`${open ? "Collapse" : "Expand"} ${label}`}
        className="group/h flex w-full items-center gap-1.5 rounded-md py-1.5 pl-4 pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-text-secondary"
      >
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
        <span>{label}</span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted/70">{count}</span>
      </button>
    </li>
  );

  // A starred app the user has not connected yet. It still pins here (a star
  // pins), shown muted with a "Not connected" hint. Clicking opens the Apps
  // panel to finish connecting it; the star removes it from the rail.
  const renderCatalogFavRow = (c: CatalogApp) => {
    const k = favKeyOf(c.name);
    const isAppPinned = pinnedApps.has(k);
    return (
      <li key={`cat-${k}`} className="group flex items-center gap-1 pl-6">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" }))}
          className="flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary"
          title={`Open Apps to connect ${c.name}`}
        >
          <span className="relative shrink-0">
            <AppRowLogo app={{ title: c.name, id: c.iconSlug || k }} logos={appLogos} size={18} fallback="letter" />
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-text-muted/50 ring-2 ring-surface-strong" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm">{c.name}</span>
            <span className="truncate text-[10px] text-text-muted">Not connected</span>
          </span>
        </button>
        {/* Same kebab affordance as connected app rows: connect or remove. */}
        <div className="relative shrink-0" data-app-menu>
          <button
            onClick={(e) => { e.stopPropagation(); setAppMenuOpen((cur) => (cur === `cat-${k}` ? null : `cat-${k}`)); }}
            className={`flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent ${
              appMenuOpen === `cat-${k}` ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            title="App actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {appMenuOpen === `cat-${k}` && (
            <div className="absolute right-0 top-7 z-50 w-44 rounded-md border border-border bg-surface p-0.5 shadow-xl">
              {/* Pin to top - same affordance as connected app rows and domains. */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleAppPin(k); setAppMenuOpen(null); }}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-text-primary hover:bg-surface-warm"
              >
                <Pin className={`h-3 w-3 shrink-0 ${isAppPinned ? "fill-accent text-accent" : ""}`} /> {isAppPinned ? "Unpin" : "Pin to top"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setAppMenuOpen(null); window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" })); }}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-text-primary hover:bg-surface-warm"
              >
                <ExternalLink className="h-3 w-3 shrink-0" /> Connect
              </button>
              <div className="my-0.5 h-px bg-border-subtle" />
              <button
                onClick={(e) => { e.stopPropagation(); setAppMenuOpen(null); if (favs.has(k)) toggleFavorite(k); }}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-text-primary hover:bg-surface-warm"
              >
                <StarOff className="h-3 w-3 shrink-0" /> Remove from sidebar
              </button>
            </div>
          )}
        </div>
      </li>
    );
  };

  async function restoreDomain(name: string) {
    setRestoring(name);
    try {
      await invoke("engine_vault_restore", { vault: vaultPath, domain: name });
      await refreshArchived();
      onDomainsChanged();
    } catch (e) {
      console.error("restore domain", e);
    } finally {
      setRestoring(null);
    }
  }

  // Archive a domain straight from its sidebar row (the spot users look first).
  // Nothing is deleted - it moves to the collapsible "Archived" section below
  // and can be restored any time.
  async function archiveDomain(name: string) {
    try {
      const ok = await tauriConfirm(
        `Hide "${titleCase(name)}" from the active list? Nothing is deleted. Restore it any time from the Archived section.`,
        { title: "Archive domain", kind: "warning" },
      );
      if (!ok) return;
      await invoke("engine_vault_archive", { vault: vaultPath, domain: name });
      await refreshArchived();
      onDomainsChanged();
    } catch (e) {
      console.error("archive domain", e);
    }
  }

  // Mode-aware sidebar wash: Work mode gets a faint accent (teal) glow at the
  // top, Editor mode a warmer neutral wash, so the whole rail visibly reads as
  // one mode or the other beyond just the footer toggle.
  const editorMode = tab === "settings";
  const modeWash = editorMode
    ? "linear-gradient(180deg, color-mix(in srgb, var(--color-surface-warm) 70%, var(--color-surface-strong)) 0%, var(--color-surface-strong) 240px)"
    : "linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 9%, var(--color-surface-strong)) 0%, var(--color-surface-strong) 240px)";
  return (
    <aside
      className="flex shrink-0 flex-col border-r border-border-subtle bg-surface-strong"
      style={{ width: collapsed ? 56 : railWidth, backgroundImage: modeWash }}
    >
      {/* The Prevail mark on its own row, full width, with the sidebar toggle on
          the far right. The macOS traffic lights are handled by the full-width
          title bar above this whole layout, so the sidebar starts clean here. */}
      <div
        data-tauri-drag-region
        className={`flex shrink-0 items-center gap-2 px-3 py-2.5 ${
          collapsed ? "border-b border-border-subtle" : "border-b border-black/20 bg-[#141416]"
        }`}
      >
        {collapsed ? (
          <div className="mx-auto flex flex-col items-center gap-2">
            <span className="overflow-hidden rounded-lg ring-1 ring-white/20"><PrevailLogo size={30} animated={false} /></span>
            <button
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="flex h-7 w-7 items-center justify-center rounded-md bg-text-primary text-background shadow-sm transition-opacity hover:opacity-80"
            >
              <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          </div>
        ) : (
          <>
            <span className="shrink-0 overflow-hidden rounded-lg ring-1 ring-white/20"><PrevailLogo size={24} animated={false} /></span>
            <BrandMark fill className="min-w-0 flex-1 font-display text-2xl font-bold text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.5)]" />
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/12 text-white transition-colors hover:bg-white/25"
            >
              <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          </>
        )}
      </div>

      {/* Profile switcher - pinned at the top under the logo (workspace-context
          convention: Notion/Linear), keeping the bottom uncluttered. */}
      <ProfileSwitcher collapsed={collapsed} />

      {/* Domain list (icon rail when collapsed, full list when expanded) */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* EDITOR MODE: the single left bar becomes the configuration nav (no
            second column). Selecting an item drives the content panel via event. */}
        {tab === "settings" && (
          <div className={`pt-2 ${collapsed ? "px-1.5" : "px-2"}`}>
            {EDITOR_NAV.map((group) => (
              <div key={group.heading} className="mb-1.5">
                {!collapsed && (
                  <div className="mb-0.5 mt-2 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted/70">{group.heading}</div>
                )}
                {group.items.map((it) => {
                  const Icon = it.icon;
                  const active = editorActive === it.id;
                  return (
                    <button
                      key={it.id}
                      onClick={() => selectEditor(it.id)}
                      title={collapsed ? it.label : undefined}
                      className={`group flex w-full items-center rounded-md py-1.5 text-left text-sm transition-all ${collapsed ? "justify-center px-0" : "gap-3 px-3"} ${
                        active ? "bg-accent font-semibold text-background shadow-sm" : "text-text-secondary hover:bg-accent-soft hover:text-accent hover:shadow-sm active:scale-[0.99]"
                      } ${!active && !collapsed ? "hover:pl-4" : ""}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="flex-1">{it.label}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* WORK MODE (everything that isn't Editor): Today + Work surfaces +
            Domains + Apps, all in this one bar. */}
        {tab !== "settings" && (<>
        {/* General - the home for chats not tied to any domain. Selecting it
            unbinds the chat from domain context; its threads live in the vault
            root _threads/. New threads are created via the threads rail's +. */}
        <div className={collapsed ? "flex justify-center p-2" : "px-2 pt-2"}>
          <button
            onClick={() => {
              setSelectedDomain("");
              if (tab === "work") setTab("chat");
            }}
            title="General: chats not tied to any domain"
            className={
              collapsed
                ? `flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                    selectedDomain === "" && tab !== "work"
                      ? SEL_ICON
                      : "text-text-muted hover:bg-surface-warm hover:text-text-primary"
                  }`
                : `flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                    selectedDomain === "" && tab !== "work"
                      ? SEL_ROW
                      : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                  }`
            }
          >
            <MessagesSquare className="h-4 w-4" />
            {!collapsed && "General"}
          </button>
        </div>

        {/* Work surfaces - board, automations, calendar, notes - in the main bar
            (no second column). Collapsible + indented, mirroring Domains. */}
        {!collapsed && (
          <button
            onClick={() => setWorkOpen((v) => !v)}
            className="group/h mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted hover:text-text-secondary transition-colors"
          >
            <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${workOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
            <Briefcase className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span>Work</span>
          </button>
        )}
        {(collapsed || workOpen) && (
          <ul className={`space-y-0.5 ${collapsed ? "px-1.5 py-1" : "px-2"}`}>
            {WORK_NAV.flatMap((g) => g.items).map((it) => {
              const Icon = it.icon;
              const active = tab === "work" && workActive === it.id;
              return (
                <li key={it.id}>
                  <button
                    onClick={() => selectWork(it.id)}
                    title={collapsed ? it.label : undefined}
                    className={`group flex w-full items-center rounded-md py-1.5 text-left text-sm transition-all ${collapsed ? "justify-center px-0" : "gap-2.5 pl-6 pr-2"} ${
                      active ? SEL_ROW : "text-text-secondary hover:bg-accent-soft hover:text-accent hover:shadow-sm active:scale-[0.99]"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="flex-1 truncate">{it.label}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!collapsed && (
          <div data-tour="domains" className="group/h mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
            <button
              onClick={() => setDomainsOpen((v) => !v)}
              className="flex flex-1 items-center gap-1.5 text-left transition-colors hover:text-text-secondary"
            >
              <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${domainsOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
              <Layers className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span>Domains</span>
            </button>
            {/* Add affordance: revealed on hover so the rail stays clean. */}
            <button
              onClick={() => { setDomainsOpen(true); setAdding(true); }}
              title="New domain"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition hover:bg-surface-warm hover:text-accent focus:opacity-100 group-hover/h:opacity-100"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <span className="font-mono text-[10px] tabular-nums text-text-muted/70">{domains.length}</span>
          </div>
        )}
        {vaultError && !collapsed && domainsOpen && (
          <div className="mx-2 my-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">{vaultError}</div>
        )}
        {domains.length === 0 && !vaultError && !collapsed && domainsOpen && (
          <div className="px-3 py-3">
            <div className="mb-2 text-xs text-text-muted">
              no domains yet. let Prevail recommend a starter set, or create one manually below.
            </div>
            <button
              onClick={onOpenOnboarding}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              Set up domains
            </button>
          </div>
        )}
        {/* "Set up domains" moved to Settings → Vault to declutter the sidebar. */}
        <ul className={`space-y-0.5 ${collapsed ? "px-1.5 py-2" : "px-2"}`}>
          {sortedDomains.map((d, i) => {
            const active = d.name === selectedDomain && tab !== "work";
            const Icon = domainIcon(d.name);
            const isPinned = pinned.has(d.name);
            const isFirstPinned = !collapsed && isPinned && (i === 0 || !pinned.has(sortedDomains[i - 1].name));
            const isFirstAll = !collapsed && !isPinned && (i === 0 || pinned.has(sortedDomains[i - 1].name));
            // Hide entries when their group is collapsed.
            if (!collapsed && !domainsOpen) return null;
            if (!collapsed && isPinned && !pinnedOpen && !isFirstPinned) return null;
            if (!collapsed && !isPinned && !allOpen && !isFirstAll) return null;
            const renderGroupHeader = (label: "Pinned" | "All", open: boolean, set: (v: boolean) => void, count: number) => (
              <li key={`${label}-header`} className="mt-1 first:mt-0">
                <button
                  onClick={() => set(!open)}
                  title={`${open ? "Collapse" : "Expand"} ${label}`}
                  className="group/h flex w-full items-center gap-1.5 rounded-md py-1.5 pl-4 pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-text-secondary"
                >
                  <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
                  <span>{label}</span>
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted/70">{count}</span>
                </button>
              </li>
            );
            // Render a thin "Pinned / All" divider when transitioning.
            const showDivider = false;
            void showDivider;
            if (collapsed) {
              return (
                <li key={d.name}>
                  <button
                    onClick={() => {
                      setSelectedDomain(d.name);
                      if (tab === "work") setTab("chat");
                    }}
                    title={titleCase(d.name)}
                    className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                      active
                        ? SEL_ICON
                        : "text-text-muted hover:bg-surface-warm hover:text-text-primary"
                    }`}
                  >
                    {Icon ? <Icon className="h-4 w-4" /> : (
                      // NAV-1: no per-domain icon → a circular badge (not a bare
                      // glyph) so the collapsed rail signals "content behind here".
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                        active ? "bg-background/20 text-background" : "bg-surface-warm text-text-secondary ring-1 ring-border"
                      }`}>
                        {titleCase(d.name).charAt(0)}
                      </span>
                    )}
                  </button>
                </li>
              );
            }
            return (
              <Fragment key={d.name}>
                {isFirstPinned && renderGroupHeader("Pinned", pinnedOpen, setPinnedOpen, pinned.size)}
                {isFirstAll && renderGroupHeader("All", allOpen, setAllOpen, sortedDomains.length - pinned.size)}
                {((isPinned && pinnedOpen) || (!isPinned && allOpen)) && (
              <li
                className="group flex items-center gap-1 pl-6"
              >
                <button
                  onMouseDown={(e) => {
                    // Manual drag - WebKit's HTML5 DnD in WKWebView
                    // doesn't reliably fire dragstart. Track mouse
                    // movement; on mouseup, hit-test the chat composer
                    // / messages area and call its global attach hook.
                    if (e.button !== 0) return;
                    const startX = e.clientX;
                    const startY = e.clientY;
                    let dragging = false;
                    let pill: HTMLDivElement | null = null;
                    const onMove = (ev: MouseEvent) => {
                      const dx = ev.clientX - startX;
                      const dy = ev.clientY - startY;
                      if (!dragging && Math.hypot(dx, dy) < 6) return;
                      if (!dragging) {
                        dragging = true;
                        pill = document.createElement("div");
                        pill.textContent = `◆ ${titleCase(d.name)}`;
                        pill.style.cssText =
                          "position:fixed;z-index:9999;pointer-events:none;" +
                          "padding:6px 10px;border-radius:9999px;" +
                          "background:var(--color-accent,#0d7a6e);color:#fff;" +
                          "font-family:ui-monospace,monospace;font-size:11px;" +
                          "box-shadow:0 6px 20px rgba(0,0,0,0.2);" +
                          "transform:translate(-50%,-50%);";
                        document.body.appendChild(pill);
                        document.body.style.userSelect = "none";
                      }
                      if (pill) {
                        pill.style.left = ev.clientX + "px";
                        pill.style.top = ev.clientY + "px";
                      }
                    };
                    const onUp = (ev: MouseEvent) => {
                      window.removeEventListener("mousemove", onMove);
                      window.removeEventListener("mouseup", onUp);
                      document.body.style.userSelect = "";
                      if (pill) { pill.remove(); pill = null; }
                      if (!dragging) return; // treat as a click - let onClick fire
                      // Don't let onClick fire after a drag ended
                      ev.preventDefault();
                      ev.stopPropagation();
                      const hook = (window as unknown as { __prevailAttach?: (n: string, mode?: "light" | "full" | "folder") => void }).__prevailAttach;
                      if (hook) hook(d.name, ev.altKey ? "folder" : ev.shiftKey ? "full" : "light");
                      else console.warn("[prevail/drag] no attach hook registered: drop fell outside chat panel");
                    };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                  }}
                  onClick={() => {
                    setSelectedDomain(d.name);
                    if (tab === "work") setTab("chat");
                  }}
                  title="Click to enter · drag to chat as context (plain: state · ⇧ full · ⌥ entire folder)"
                  className={`flex flex-1 cursor-grab items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors active:cursor-grabbing ${
                    active
                      ? SEL_ROW
                      : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                  }`}
                >
                  {Icon ? (
                    <Icon className={`h-4 w-4 ${active ? "text-background" : "text-text-muted"}`} />
                  ) : (
                    <span className={active ? "text-background" : "text-text-muted"}>◆</span>
                  )}
                  <span className="flex-1 truncate">{titleCase(d.name)}</span>
                  {(domainStats[d.name] ?? 0) > 0 && (
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0 font-mono text-[10px] ${active ? "bg-background/20 text-background" : "bg-surface-warm text-text-muted"}`}
                      title={`${domainStats[d.name]} imports`}
                    >
                      {domainStats[d.name]}
                    </span>
                  )}
                  {runningDomains.has(d.name) ? (
                    <span className="pulse-soft inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="A reply is streaming in this domain" />
                  ) : finishedDomains.has(d.name) ? (
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background: "var(--color-ok, #2e9e5b)",
                        boxShadow: "0 0 0 3px color-mix(in srgb, var(--color-ok, #2e9e5b) 28%, transparent)",
                      }}
                      title="Just finished: open to view"
                    />
                  ) : null}
                </button>
                {/* Row actions collapsed into a kebab (⋮) so the list stays
                    clean: pin / open in Finder / archive live behind one click. */}
                <div className="relative shrink-0" data-domain-menu>
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpen((cur) => (cur === d.name ? null : d.name)); }}
                    className={`flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent ${
                      active || menuOpen === d.name ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                    title="Domain actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {menuOpen === d.name && (
                    <div className="absolute right-0 top-7 z-50 w-36 rounded-md border border-border bg-surface p-0.5 shadow-xl">
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(d.name); setMenuOpen(null); }}
                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-text-primary hover:bg-surface-warm"
                      >
                        <Pin className={`h-3 w-3 shrink-0 ${isPinned ? "fill-accent text-accent" : ""}`} /> {isPinned ? "Unpin" : "Pin to top"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openInFinder(d.path); setMenuOpen(null); }}
                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-text-primary hover:bg-surface-warm"
                      >
                        <Folder className="h-3 w-3 shrink-0" /> Open in Finder
                      </button>
                      <div className="my-0.5 h-px bg-border-subtle" />
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(null); void archiveDomain(d.name); }}
                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-warn hover:bg-warn/10"
                      >
                        <Archive className="h-3 w-3 shrink-0" /> Archive…
                      </button>
                    </div>
                  )}
                </div>
              </li>
                )}
              </Fragment>
            );
          })}
        </ul>

        {/* Add domain - triggered by the hover "+" on the Domains header above;
            only the inline create form renders here (no persistent button). */}
        {!collapsed && domainsOpen && adding && (
          <div className="mt-2 px-2">
            {(
              <div className="rounded-md border border-border bg-background p-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createDomain();
                    if (e.key === "Escape") { setAdding(false); setNewName(""); setAddError(null); }
                  }}
                  placeholder="e.g. travel"
                  className="w-full bg-transparent px-1 py-0.5 font-mono text-xs focus:outline-none"
                />
                {addError && <div className="mt-1 text-[10px] text-err">{addError}</div>}
                <div className="mt-1.5 flex gap-1">
                  <button
                    onClick={createDomain}
                    disabled={!newName.trim()}
                    className="rounded bg-accent px-2 py-0.5 font-mono text-[10px] text-background hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
                  >
                    create
                  </button>
                  <button
                    onClick={() => { setAdding(false); setNewName(""); setAddError(null); }}
                    className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-text-muted hover:bg-surface-warm"
                  >
                    cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {collapsed && (
          <div className="mt-2 flex justify-center">
            <button
              onClick={() => setCollapsed(false)}
              title="New domain (expand sidebar first)"
              className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border text-text-muted hover:border-accent-border hover:bg-surface-warm hover:text-accent"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Archived domains - collapsible, grouped right under Domains (it's a
            domains concept). Hidden from the active list; restore re-scans. */}
        {!collapsed && domainsOpen && archived.length > 0 && (
          <div className="mt-2 px-2">
            <button
              onClick={() => setArchivedOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded px-1 py-1 pl-4 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary"
            >
              {archivedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Archive className="h-3 w-3" />
              Archived
              <span className="ml-auto rounded-full bg-surface-strong px-1.5 text-[10px] text-text-muted">{archived.length}</span>
            </button>
            {archivedOpen && (
              <ul className="mt-1 space-y-0.5">
                {archived.map((name) => (
                  <li
                    key={name}
                    className="group flex items-center gap-2 rounded-md px-2 py-1 pl-6 text-text-muted"
                  >
                    <Archive className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate text-xs">{titleCase(name)}</span>
                    <button
                      onClick={() => restoreDomain(name)}
                      disabled={restoring === name}
                      title={`Restore ${titleCase(name)}`}
                      className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted opacity-0 hover:border-accent-border hover:text-accent group-hover:opacity-100 disabled:opacity-100"
                    >
                      {restoring === name ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Apps - peer to Domains. Always shown so it stays first-class even
            with nothing connected yet. Favorites expand by default; the full
            list stays collapsed so a long catalog never floods the rail. */}
        {!collapsed && (
          <div className="mt-3">
            <div className="group/h flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
              <button
                onClick={() => setAppsOpen((v) => !v)}
                className="flex flex-1 items-center gap-1.5 text-left transition-colors hover:text-text-secondary"
              >
                <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${appsOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
                <Plug className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span>Apps</span>
              </button>
              {/* Hover affordances: jump to the Apps configuration space, or add
                  an app. Revealed on hover so the rail stays clean. */}
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" }))}
                title="Open Apps configuration"
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition hover:bg-surface-warm hover:text-accent focus:opacity-100 group-hover/h:opacity-100"
              >
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" }))}
                title="Add an app"
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition hover:bg-surface-warm hover:text-accent focus:opacity-100 group-hover/h:opacity-100"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
              <span className="font-mono text-[10px] tabular-nums text-text-muted/70">{pinnedAppCount}</span>
            </div>
            {appsOpen && (pinnedAppCount > 0 ? (
              <ul className="mt-0.5 space-y-0.5 px-2">
                {/* The home screen = starred apps only (any mode). Connected apps
                    first, then starred-but-not-yet-connected catalog apps. The
                    star on a row removes it from home; the Apps panel adds new ones.
                    When any app is pinned, split into a "Pinned" group above an
                    "All" group - the exact parallel of the Domains section. */}
                {hasPinnedApps ? (
                  <>
                    {renderAppGroupHeader("Pinned", appsPinnedOpen, setAppsPinnedOpen, appBuckets.pinnedSidebar.length + appBuckets.pinnedCatalog.length)}
                    {appsPinnedOpen && appBuckets.pinnedSidebar.map(renderAppRow)}
                    {appsPinnedOpen && appBuckets.pinnedCatalog.map(renderCatalogFavRow)}
                    {renderAppGroupHeader("All", appsAllOpen, setAppsAllOpen, appBuckets.restSidebar.length + appBuckets.restCatalog.length)}
                    {appsAllOpen && appBuckets.restSidebar.map(renderAppRow)}
                    {appsAllOpen && appBuckets.restCatalog.map(renderCatalogFavRow)}
                  </>
                ) : (
                  <>
                    {favoritedSidebarApps.map(renderAppRow)}
                    {favoritedCatalogApps.map(renderCatalogFavRow)}
                  </>
                )}
              </ul>
            ) : (
              <div className="px-2">
                <p className="mt-0.5 px-4 py-1.5 text-[11px] leading-relaxed text-text-muted">Star an app in Apps to pin it here, or hover this header and hit +.</p>
              </div>
            ))}
          </div>
        )}

        </>)}
      </div>

      {/* App-wide readiness - the aggregate of every domain's score. */}
      {lifeScore && (
        <button
          onClick={() => setTab("settings")}
          title={`Life readiness: mean context score across ${lifeScore.count} domain${lifeScore.count === 1 ? "" : "s"}. Click for settings.`}
          className={`flex items-center border-t border-border-subtle transition-colors hover:bg-surface-warm ${
            collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2"
          }`}
        >
          <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center">
            <svg viewBox="0 0 36 36" className="h-7 w-7 -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--color-border, #2a2a2a)" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15" fill="none"
                stroke={scoreColor(lifeScore.value)} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${(lifeScore.value / 100) * 94.2} 94.2`}
              />
            </svg>
            <span className="absolute font-mono text-[10px] font-semibold" style={{ color: scoreColor(lifeScore.value) }}>
              {lifeScore.value}
            </span>
          </span>
          {!collapsed && (
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">Life readiness</span>
              <span className="text-xs text-text-secondary">{lifeScore.count} domain{lifeScore.count === 1 ? "" : "s"} scored</span>
            </span>
          )}
        </button>
      )}

      {/* Agent-operable summary - opens the Map. Score appears once the Map has
          been computed at least once (broadcast + cached). */}
      <button
        onClick={() => setTab("map")}
        title="Map: every domain's tool stack and how agent-operable it is"
        className={`flex items-center border-t border-border-subtle transition-colors hover:bg-surface-warm ${
          tab === "map" ? "bg-surface-warm" : ""
        } ${collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2"}`}
      >
        <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center">
          <Waypoints className="h-4 w-4 text-accent" />
        </span>
        {!collapsed && (
          <>
            <span className="text-xs text-text-secondary">Map</span>
            {mapScore !== null && (
              <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted/70">{mapScore}%</span>
            )}
          </>
        )}
      </button>

      {/* The live process / benchmark / backup / connectivity strips used to
          stack here and made the footer busy. They now live behind the single
          "Processes" icon in the footer line below (opens a modal on click). */}

      {/* Work / Editor + theme - a full-width ribbon pinned to the bottom. The
          2026 redesign splits the old single "Settings" button into the two
          modes (Cursor-style): Work (operational hub) and Editor (configuration).
          A solid edge-to-edge bar so it reads as the app's footer action. */}
      {collapsed ? (
        <div data-tour="settings" className="flex flex-col items-center gap-1 border-t border-border-subtle p-2">
          <button onClick={() => setTab("chat")} title="Work: your domains, board, automations, calendar & notes" aria-label="Work mode"
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${tab !== "settings" ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text-primary"}`}>
            <Briefcase className="h-4 w-4" />
          </button>
          <button onClick={() => setTab("settings")} title="Editor: models, connections & settings" aria-label="Editor mode"
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${tab === "settings" ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text-primary"}`}>
            <SettingsIcon className="h-4 w-4" />
          </button>
          <button onClick={() => { const cycle: Mode[] = ["light", "dark", "system"]; const i = cycle.indexOf(appearance.mode); appearance.setMode(cycle[(i + 1) % cycle.length]); }}
            title={`Theme: ${appearance.mode}: click to cycle`} className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:text-text-secondary">
            {appearance.mode === "dark" ? <Moon className="h-4 w-4" /> : appearance.mode === "system" ? <Monitor className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
          <FooterProcesses collapsed setTab={setTab} />
        </div>
      ) : (
        // Full-width, edge-to-edge mode switch. Two equal halves span the whole
        // rail; the active mode is filled (accent for Work, warm for Editor)
        // with a bold top indicator bar, so the current mode is unmistakable.
        <div data-tour="settings" className="grid shrink-0 grid-cols-2 border-t border-border">
          <button
            onClick={() => setTab("chat")}
            title="Work: your domains, board, automations, calendar & notes"
            className={`relative flex items-center justify-center gap-2 py-3 text-[13px] font-semibold transition-colors ${
              tab !== "settings"
                ? "bg-accent text-background shadow-sm"
                : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
            }`}
          >
            <Briefcase className="h-4 w-4 shrink-0" />
            Work
          </button>
          <button
            onClick={() => setTab("settings")}
            title="Editor: models, connections & settings"
            className={`relative flex items-center justify-center gap-2 py-3 text-[13px] font-semibold transition-colors ${
              tab === "settings"
                ? "bg-accent text-background shadow-sm"
                : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
            }`}
          >
            <SettingsIcon className="h-4 w-4 shrink-0" />
            Editor
          </button>
        </div>
      )}
      {!collapsed && (
        // Slim one-line footer. The Beta badge IS the feedback link (the tooltip
        // carries the use-at-your-own-risk notice), and the theme toggle +
        // Processes icon are kept tiny on the
        // right so this corner stays minimal rather than a stack of status cards.
        <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-3 py-2">
          <a
            href="https://github.com/fru-dev3/prevail-desktop/issues/new"
            target="_blank"
            rel="noreferrer"
            title="Beta: Prevail is a beta release, provided as-is with no warranty: use at your own risk. Click to send feedback or report a bug."
            className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-background"
          >
            <span className="text-[10px] leading-none">◆</span> Beta
          </a>
          <div className="flex-1" />
          <button
            onClick={() => { const cycle: Mode[] = ["light", "dark", "system"]; const i = cycle.indexOf(appearance.mode); appearance.setMode(cycle[(i + 1) % cycle.length]); }}
            title={`Theme: ${appearance.mode}, click to cycle (light · dark · system)`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
          >
            {appearance.mode === "dark" ? <Moon className="h-3.5 w-3.5" /> : appearance.mode === "system" ? <Monitor className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
          </button>
          <FooterProcesses collapsed={false} setTab={setTab} />
        </div>
      )}
    </aside>
  );
}

// Footer "Processes" control: one small icon (with a live count badge) that
// replaces the old stack of always-visible status strips. Clicking it opens a
// modal listing everything happening in the background, so the sidebar corner
// stays minimal until the user actually wants the detail.
function FooterProcesses({ collapsed, setTab }: { collapsed: boolean; setTab: (t: TabId) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const procs = useProcesses();
  const runningBench = useBenchBatches().filter((b) => b.running);
  const count = procs.length + runningBench.length;
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title={count > 0
          ? `${count} background process${count === 1 ? "" : "es"} running (click for details)`
          : "Background processes: scheduled benchmarks, backups & live activity"}
        className={`relative flex ${collapsed ? "h-8 w-8" : "h-6 w-6"} shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-warm hover:text-accent ${open ? "bg-surface-warm text-accent" : ""}`}
      >
        <Activity className={collapsed ? "h-4 w-4" : "h-3.5 w-3.5"} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold leading-none text-background">
            {count}
          </span>
        )}
      </button>
      {open && <ProcessesPopover anchorRef={btnRef} onClose={() => setOpen(false)} setTab={setTab} />}
    </>
  );
}

// The consolidated background-activity popover. Anchored to the footer
// Activity icon (bottom-left of the sidebar) and rises upward from it, so it
// appears where the user clicked rather than centered on screen. Reuses the
// existing strip components (they self-hide when inactive) so nothing about how
// a process, benchmark, backup, or connection renders had to be reimplemented.
function ProcessesPopover(
  { anchorRef, onClose, setTab }:
  { anchorRef: RefObject<HTMLButtonElement | null>; onClose: () => void; setTab: (t: TabId) => void },
) {
  const procs = useProcesses();
  const runningBench = useBenchBatches().filter((b) => b.running);
  const benchSched = lsGet(BENCH_SCHED.enabled, "0") === "1";
  const backupOn = lsGet(BACKUP_CFG.enabled, "0") === "1";
  const empty = procs.length === 0 && runningBench.length === 0 && !benchSched && !backupOn;
  // A small live count of the actively running work (processes + benchmark
  // runs) for the header badge. Scheduled/armed items are not counted here since
  // they are waiting, not running.
  const runningCount = procs.length + runningBench.length;

  // Anchor to the trigger: fixed positioning (so sidebar overflow never clips
  // it), left-aligned to the icon, bottom sitting just above it so the card
  // grows upward from the bottom-left footer corner.
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, r.left);
      const bottom = Math.max(8, window.innerHeight - r.top + 8);
      setPos({ left, bottom });
    };
    place();
    // Entrance feel: mount slightly offset/faded, then settle on next frame.
    const raf = requestAnimationFrame(() => setShown(true));
    window.addEventListener("resize", place);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

  return (
    // Transparent click-away backdrop.
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Background processes"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left: pos?.left ?? 8,
          bottom: pos?.bottom ?? 8,
          width: 320,
          visibility: pos ? "visible" : "hidden",
          transformOrigin: "bottom left",
          transform: shown ? "translateY(0) scale(1)" : "translateY(6px) scale(0.98)",
          opacity: shown ? 1 : 0,
          transition: "opacity 140ms ease-out, transform 140ms ease-out",
        }}
        className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ring-1 ring-black/5"
      >
        <div className="flex items-center justify-between border-b border-border-subtle/70 px-4 pb-3 pt-3.5">
          <span className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Activity className="h-4 w-4" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[13px] font-semibold text-text-primary">Background work</span>
              <span className="text-[10px] text-text-muted">Live and scheduled activity</span>
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {runningCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                {runningCount} live
              </span>
            )}
            <button
              onClick={onClose}
              title="Close"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-warm hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        </div>
        <div className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
          {empty ? (
            <div className="flex flex-col items-center gap-2.5 px-4 py-9 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-warm text-text-muted">
                <Activity className="h-5 w-5" />
              </span>
              <span className="text-[13px] font-medium text-text-secondary">All quiet</span>
              <span className="max-w-[220px] text-[11px] leading-relaxed text-text-muted">
                Scheduled benchmarks, automatic backups, and live activity like chats, council, and loops will show up here.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <SidebarProcesses collapsed={false} setTab={setTab} />
              <SidebarBenchmarkRuns collapsed={false} />
              <SidebarBenchScheduled collapsed={false} />
              <SidebarBackupActive collapsed={false} />
              <SidebarGatewayLive collapsed={false} />
              <SidebarMcpLive collapsed={false} setTab={setTab} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// One floating life-domain chip: parallaxes with the cursor (via shared
// springs) and gently bobs. Icons only - never emojis.
