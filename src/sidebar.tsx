// The domain/navigation Sidebar, extracted from App.tsx. Prop-driven (collapse
// state, domains, active selection, and a set of callbacks); renders the live
// gateway/MCP/benchmark status strips from shared modules.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { Archive, ChevronDown, ChevronLeft, ChevronRight, Folder, Layers, Loader2, MessageSquare, MessagesSquare, Monitor, Moon, MoreVertical, Pin, Plug, Plus, RotateCcw, Settings as SettingsIcon, Sparkles, Star, Sun } from "lucide-react";
import { PrevailLogo } from "./PrevailLogo";
import { invoke } from "./bridge";
import { STATUS_TINT } from "./constants";
import { appName, scoreColor, titleCase } from "./format";
import { lsGet, lsSet } from "./storage";
import { favKeyOf, toggleFavorite, useFavorites } from "./appfavorites";
import { SidebarGatewayLive, SidebarMcpLive } from "./panels";
import { domainIcon } from "./icons";
import { useAppearance } from "./hooks";
import { SidebarBackupActive, SidebarBenchmarkRuns, SidebarBenchScheduled, SidebarProcesses } from "./cards";
import { BrandMark } from "./brandmark";
import { AppRowLogo } from "./panels3";
import type { BrandLogo, Domain, EngineApp, LifeReadiness, Mode, TabId } from "./types";

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
  const [allOpen, setAllOpen] = useState<boolean>(() => lsGet("prevail.sidebar.allOpen") !== "0");
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
  const refreshArchived = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await invoke<string[]>("engine_list_archived", { vault: vaultPath });
      setArchived(list);
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
  const [appsOpen, setAppsOpen] = useState<boolean>(() => lsGet("prevail.sidebar.appsOpen") !== "0");
  useEffect(() => { lsSet("prevail.sidebar.appsOpen", appsOpen ? "1" : "0"); }, [appsOpen]);
  useEffect(() => {
    let alive = true;
    const pull = () => { invoke<EngineApp[]>("engine_apps_list").then((a) => { if (alive) setSidebarApps((a ?? []).map((x) => ({ ...x, title: appName(x.title) }))); }).catch(() => {}); };
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
    const method = appMethod(app);
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
              ? "bg-accent-soft font-semibold text-accent ring-1 ring-inset ring-accent-border/60"
              : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
          }`}
          title={`Click to open ${app.title} (${method.label}) · drag into chat to attach as context${app.domains.length ? " · refreshes " + app.domains.map(titleCase).join(", ") : ""}`}
        >
          {/* Brand mark + a tiny status dot anchored to it so connection state
              stays visible. Gateway apps key the logo off the toolkit so e.g.
              "composio-notion" still resolves the Notion mark. */}
          <span className="relative shrink-0">
            <AppRowLogo app={{ title: app.title, id: method.toolkit }} logos={appLogos} size={18} fallback="letter" />
            <span
              className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-surface-strong"
              style={{ backgroundColor: tint }}
            />
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm">{app.title}</span>
            <span className="truncate text-[10px] text-text-muted">{method.label}</span>
          </span>
        </button>
        <button
          onClick={() => {
            // Remove whichever key(s) pinned this app - id-keyed (AppDetail star)
            // or name-keyed (Direct list star). Only delete present keys so this
            // never accidentally re-adds.
            const idK = favKeyOf(app.id), titleK = favKeyOf(app.title);
            if (favs.has(idK)) toggleFavorite(idK);
            if (titleK !== idK && favs.has(titleK)) toggleFavorite(titleK);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-accent opacity-0 hover:bg-surface-warm group-hover:opacity-100"
          title="Remove from home screen"
        >
          <Star className="h-3 w-3 fill-accent" />
        </button>
        {app.path && (
          <button
            onClick={() => openInFinder(app.path ?? null)}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            title={`Open ${app.title} folder in Finder`}
          >
            <Folder className="h-3.5 w-3.5" />
          </button>
        )}
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
  // Nothing is deleted — it moves to the collapsible "Archived" section below
  // and can be restored any time.
  async function archiveDomain(name: string) {
    try {
      const ok = await tauriConfirm(
        `Hide "${titleCase(name)}" from the active list? Nothing is deleted — restore it any time from the Archived section.`,
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

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-border-subtle bg-surface-strong"
      style={{ width: collapsed ? 56 : railWidth }}
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
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/12 text-white transition-colors hover:bg-white/25"
            >
              <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          </>
        )}
      </div>

      {/* Domain list (icon rail when collapsed, full list when expanded) */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* General - the home for chats not tied to any domain. Selecting it
            unbinds the chat from domain context; its threads live in the vault
            root _threads/. New threads are created via the threads rail's +. */}
        <div className={collapsed ? "flex justify-center p-2" : "px-2 pt-2"}>
          <button
            onClick={() => {
              setSelectedDomain("");
              if (tab === "settings") setTab("chat");
            }}
            title="General: chats not tied to any domain"
            className={
              collapsed
                ? `flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                    selectedDomain === "" && tab !== "settings"
                      ? "bg-accent-soft text-accent"
                      : "text-text-muted hover:bg-surface-warm hover:text-text-primary"
                  }`
                : `flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                    selectedDomain === "" && tab !== "settings"
                      ? "bg-accent-soft text-accent"
                      : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                  }`
            }
          >
            <MessagesSquare className="h-4 w-4" />
            {!collapsed && "General"}
          </button>
        </div>
        {!collapsed && (
          <button
            data-tour="domains"
            onClick={() => setDomainsOpen((v) => !v)}
            className="group/h mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted hover:text-text-secondary transition-colors"
          >
            <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${domainsOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
            <Layers className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span>Domains</span>
            <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted/70">{domains.length}</span>
          </button>
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
            const active = d.name === selectedDomain && tab !== "settings";
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
                      if (tab === "settings") setTab("chat");
                    }}
                    title={titleCase(d.name)}
                    className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                      active
                        ? "bg-accent-soft text-accent"
                        : "text-text-muted hover:bg-surface-warm hover:text-text-primary"
                    }`}
                  >
                    {Icon ? <Icon className="h-4 w-4" /> : (
                      // NAV-1: no per-domain icon → a circular badge (not a bare
                      // glyph) so the collapsed rail signals "content behind here".
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                        active ? "bg-accent text-background" : "bg-surface-warm text-text-secondary ring-1 ring-border"
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
                    if (tab === "settings") setTab("chat");
                  }}
                  title="Click to enter · drag to chat as context (plain: state · ⇧ full · ⌥ entire folder)"
                  className={`flex flex-1 cursor-grab items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors active:cursor-grabbing ${
                    active
                      ? "bg-accent-soft text-accent font-semibold ring-1 ring-inset ring-accent-border/60"
                      : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                  }`}
                >
                  {Icon ? (
                    <Icon className={`h-4 w-4 ${active ? "text-accent" : "text-text-muted"}`} />
                  ) : (
                    <span className={active ? "text-accent" : "text-text-muted"}>◆</span>
                  )}
                  <span className="flex-1 truncate">{titleCase(d.name)}</span>
                  {(domainStats[d.name] ?? 0) > 0 && (
                    <span
                      className="shrink-0 rounded-full bg-surface-warm px-1.5 py-0 font-mono text-[9px] text-text-muted"
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

        {/* Add domain */}
        {!collapsed && domainsOpen && (
          <div className="mt-2 px-2">
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-left text-xs text-text-muted hover:border-accent-border hover:bg-surface-warm hover:text-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                new domain
              </button>
            )}
            {adding && (
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

        {/* Apps - peer to Domains. Always shown so it stays first-class even
            with nothing connected yet. Favorites expand by default; the full
            list stays collapsed so a long catalog never floods the rail. */}
        {!collapsed && (
          <div className="mt-3">
            <button
              onClick={() => setAppsOpen((v) => !v)}
              className="group/h flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-text-secondary"
            >
              <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${appsOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
              <Plug className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span>Apps</span>
              <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted/70">{favoritedSidebarApps.length}</span>
            </button>
            {appsOpen && (favoritedSidebarApps.length > 0 ? (
              <ul className="mt-0.5 space-y-0.5 px-2">
                {/* The home screen = starred apps only (any mode). The star on a
                    row removes it from home; the Apps panel adds new ones. */}
                {favoritedSidebarApps.map(renderAppRow)}
                {/* Add another app. */}
                <li className="mt-0.5">
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" }))}
                    className="flex w-full items-center gap-2 rounded-md py-1.5 pl-6 pr-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
                    title="Browse and connect apps"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    add an app
                  </button>
                </li>
              </ul>
            ) : (
              <div className="px-2">
                <p className="mt-0.5 px-4 py-1.5 text-[11px] leading-relaxed text-text-muted">Star an app in Apps to pin it here.</p>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" }))}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-md py-1.5 pl-4 pr-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
                  title="Browse and connect apps"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  add an app
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Archived domains - collapsible. Hidden from the active list;
            restore brings them back into the vault scan. */}
        {!collapsed && domainsOpen && archived.length > 0 && (
          <div className="mt-3 px-2">
            <button
              onClick={() => setArchivedOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded px-1 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary"
            >
              {archivedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Archive className="h-3 w-3" />
              Archived
              <span className="ml-auto rounded-full bg-surface-strong px-1.5 text-[9px] text-text-muted">{archived.length}</span>
            </button>
            {archivedOpen && (
              <ul className="mt-1 space-y-0.5">
                {archived.map((name) => (
                  <li
                    key={name}
                    className="group flex items-center gap-2 rounded-md px-2 py-1 text-text-muted"
                  >
                    <Archive className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate text-xs">{titleCase(name)}</span>
                    <button
                      onClick={() => restoreDomain(name)}
                      disabled={restoring === name}
                      title={`Restore ${titleCase(name)}`}
                      className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted opacity-0 hover:border-accent-border hover:text-accent group-hover:opacity-100 disabled:opacity-100"
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
            <span className="absolute font-mono text-[9px] font-semibold" style={{ color: scoreColor(lifeScore.value) }}>
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

      {/* P2: live process indicator (chat / council / benchmark / loop). */}
      <SidebarProcesses collapsed={collapsed} setTab={setTab} />

      {/* External connectivity indicators */}
      <SidebarGatewayLive collapsed={collapsed} />
      <SidebarMcpLive collapsed={collapsed} setTab={setTab} />
      <SidebarBenchmarkRuns collapsed={collapsed} />
      <SidebarBenchScheduled collapsed={collapsed} />
      <SidebarBackupActive collapsed={collapsed} />

      {/* Settings + theme - a full-width ribbon pinned to the bottom: a solid
          edge-to-edge bar so it reads as the app's footer action, distinct from the
          muted status lines (MCP / Backups) above. */}
      {collapsed ? (
        <div data-tour="settings" className="flex flex-col items-center gap-1 border-t border-border-subtle p-2">
          <button onClick={() => setTab("settings")} title="Settings"
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${tab === "settings" ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text-primary"}`}>
            <SettingsIcon className="h-4 w-4" />
          </button>
          <button onClick={() => { const cycle: Mode[] = ["light", "dark", "system"]; const i = cycle.indexOf(appearance.mode); appearance.setMode(cycle[(i + 1) % cycle.length]); }}
            title={`Theme: ${appearance.mode}: click to cycle`} className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:text-text-secondary">
            {appearance.mode === "dark" ? <Moon className="h-4 w-4" /> : appearance.mode === "system" ? <Monitor className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>
      ) : (
        <div data-tour="settings" className="flex items-stretch border-t border-border">
          <button
            onClick={() => setTab("settings")}
            title="Settings"
            className={`flex flex-1 items-center gap-2.5 px-4 py-3 text-left text-[13px] font-semibold tracking-wide transition-colors ${
              tab === "settings"
                ? "bg-accent text-background"
                : "bg-surface-warm text-text-secondary hover:bg-accent-soft hover:text-accent"
            }`}
          >
            <SettingsIcon className="h-4 w-4 shrink-0" />
            Settings
          </button>
          <button
            onClick={() => { const cycle: Mode[] = ["light", "dark", "system"]; const i = cycle.indexOf(appearance.mode); appearance.setMode(cycle[(i + 1) % cycle.length]); }}
            className={`flex w-12 shrink-0 items-center justify-center border-l border-border transition-colors ${tab === "settings" ? "bg-accent text-background hover:bg-accent-hover" : "bg-surface-warm text-text-muted hover:bg-accent-soft hover:text-accent"}`}
            title={`Theme: ${appearance.mode}: click to cycle`}
          >
            {appearance.mode === "dark" ? <Moon className="h-4 w-4" /> : appearance.mode === "system" ? <Monitor className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>
      )}
      {!collapsed && (
        // Slim one-line footer: alpha badge + feedback link. The warranty detail
        // lives in the badge tooltip so the corner stays clean, not a busy card.
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border-subtle px-3 py-2">
          <span
            title="Experimental alpha build. Provided as-is, no warranty: use at your own risk."
            className="inline-flex cursor-help items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-accent"
          >
            <span className="text-[7px] leading-none">◆</span> Alpha
          </span>
          <a
            href="https://github.com/fru-dev3/prevail-desktop/issues/new"
            target="_blank"
            rel="noreferrer"
            title="Report a bug or share feedback"
            className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-text-muted transition-colors hover:text-accent"
          >
            <MessageSquare className="h-3 w-3" /> Feedback
          </a>
        </div>
      )}
    </aside>
  );
}


// One floating life-domain chip: parallaxes with the cursor (via shared
// springs) and gently bobs. Icons only - never emojis.
