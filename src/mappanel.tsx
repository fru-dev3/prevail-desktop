// Map panel: a cross-domain report of every domain's tool stack and how
// agent-operable it is, plus organize + activate in place. Read as: every
// domain, its recommended stack, what is wired vs not, so you can move things
// around, add the best-practice apps, and connect them.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Waypoints, TriangleAlert, Plus, MoreHorizontal, X, Plug, ListPlus, ChevronDown, ChevronRight, Circle, MousePointerClick, ArrowUpRight } from "lucide-react";
import { invoke } from "./bridge";
import { ObsidianImportModal, ObsidianLogo } from "./obsidianmodal";
import { loadMapModel } from "./maploader";
import { acceptTool, acceptStack, suggestableCount, moveTool, removeToolFromDomain, fileGapTask, fileIdentityTask } from "./mapactions";
import { resolveAppLogo } from "./panels3";
import { domainIcon } from "./icons";
import { STATUS_LABEL, type MapModel, type MapDomain, type MapTool } from "./map";
import type { ToolStatus } from "./mapseed";
import type { EngineApp, BrandLogo } from "./types";

const LEGEND: ToolStatus[] = ["connected", "cli", "mcp", "api", "research", "browser", "gap", "broken", "hardware"];

// Short, uniform labels for the filter row (the long STATUS_LABEL text made the
// row read as a cluttered rainbow). One word each, paired with a small color dot.
const STATUS_SHORT: Record<ToolStatus, string> = {
  connected: "Connected",
  cli: "CLI",
  mcp: "MCP",
  api: "API",
  research: "Research",
  browser: "Browser",
  hardware: "Hardware",
  gap: "Gap",
  broken: "Attention",
};

// A single status color as a dot, so the filter chips stay neutral (professional)
// and only the dot carries the color cue.
const DOT: Record<ToolStatus, string> = {
  connected: "bg-accent",
  cli: "bg-ai",
  mcp: "bg-accent/60",
  api: "bg-text-muted/40",
  research: "bg-accent/30",
  browser: "bg-text-muted/25",
  hardware: "bg-border",
  gap: "bg-warn",
  broken: "bg-err",
};

function meterTone(score: number): string {
  if (score >= 75) return "bg-accent";
  if (score >= 40) return "bg-ai";
  return "bg-warn";
}

const COLLAPSE_KEY = "prevail:map-collapsed";
function loadCollapsed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")); } catch { return new Set(); }
}

export function MapPanel({ vaultPath }: { vaultPath: string }) {
  const [model, setModel] = useState<MapModel | null>(null);
  const [appsById, setAppsById] = useState<Record<string, EngineApp>>({});
  const [logos, setLogos] = useState<Record<string, BrandLogo>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ slug: string; done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<ToolStatus | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [obOpen, setObOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await loadMapModel(vaultPath, { includeSuggestions: true });
      setModel(r.model);
      setAppsById(r.appsById);
      try {
        localStorage.setItem("prevail:map-score", String(r.model.overallScore));
        window.dispatchEvent(new CustomEvent("prevail:map-score", { detail: r.model.overallScore }));
      } catch { /* non-fatal */ }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [vaultPath]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { invoke<Record<string, BrandLogo>>("ingestion_connector_logos").then(setLogos).catch(() => {}); }, []);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setProgress(null); }
  }, [load]);

  const openApp = useCallback((appId: string) => {
    const app = appsById[appId];
    if (app) window.dispatchEvent(new CustomEvent("prevail:open-app", { detail: app }));
  }, [appsById]);

  const toggleCollapse = useCallback((slug: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const allDomains = useMemo(() => (model?.domains ?? []).map((d) => ({ slug: d.slug, label: d.label })), [model]);
  const asOf = useMemo(() => {
    if (!model) return "";
    try { return new Date(model.asOf).toLocaleString(); } catch { return model.asOf; }
  }, [model]);

  // Cross-domain filter: when a status is isolated, show only domains that have
  // a matching tool, and only their matching chips.
  const visibleDomains = useMemo(() => {
    if (!model) return [];
    if (!filter) return model.domains;
    return model.domains
      .map((d) => ({ ...d, tools: d.tools.filter((t) => t.status === filter) }))
      .filter((d) => d.tools.length > 0);
  }, [model, filter]);

  if (loading && !model) {
    return <div className="p-8 text-sm text-text-muted">Reading your domains and connections...</div>;
  }
  if (err && !model) {
    return (
      <div className="p-8 text-sm text-err">
        Could not build the map: {err}
        <button onClick={() => void load()} className="ml-3 rounded-md border border-border px-2 py-0.5 text-text-secondary hover:text-accent">Retry</button>
      </div>
    );
  }
  if (!model) return null;

  const s = model.stats;

  return (
    <div>
      {/* Sticky header - always tells you where you are while scrolling. */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <Waypoints className="h-5 w-5 text-accent" />
            <h1 className="text-lg font-semibold text-text-primary">Source</h1>
            <span className="hidden text-xs text-text-muted sm:inline">every app and tool feeding your domains, and how far an agent can act on each</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-mono text-lg font-semibold tabular-nums text-text-primary">{model.overallScore}%</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">agent-operable</div>
            </div>
            <button
              onClick={() => setObOpen(true)}
              title="Bring an existing Obsidian vault into Prevail"
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
            >
              <ObsidianLogo className="h-3.5 w-3.5" /> Import Obsidian
            </button>
            <button
              onClick={() => void load()}
              title="Re-probe connections on this machine"
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading || busy ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-5 py-5 pb-24">
        {err && <div className="mb-3 rounded-md border border-err/40 bg-err/10 px-3 py-1.5 text-[12px] text-err">{err}</div>}

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          <Stat n={s.tools} label="tools tracked" />
          <Stat n={s.wired} label="agent-wired now" />
          <Stat n={s.scriptable} label="scriptable next" />
          <Stat n={s.manual} label="manual only" />
          <Stat n={s.gaps} label="gaps" alarm={s.gaps > 0} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">Filter</span>
          {LEGEND.map((st) => {
            const active = filter === st;
            return (
              <button
                key={st}
                onClick={() => setFilter(active ? null : st)}
                title={STATUS_LABEL[st]}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-all ${
                  active
                    ? "border-accent bg-accent-soft text-accent"
                    : `border-border-subtle bg-surface text-text-secondary hover:border-border ${filter ? "opacity-45" : ""}`
                }`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${DOT[st]}`} />
                {STATUS_SHORT[st]}
              </button>
            );
          })}
          {filter && (
            <button onClick={() => setFilter(null)} className="ml-1 text-[11px] text-text-muted underline hover:text-accent">
              clear
            </button>
          )}
        </div>

        {filter && (
          <div className="mt-2 text-[11px] text-text-muted">
            Showing only <span className="text-text-secondary">{STATUS_SHORT[filter]}</span> across {visibleDomains.length} domain{visibleDomains.length === 1 ? "" : "s"}.
          </div>
        )}

        <div className="mt-2 text-[11px] text-text-muted/80">
          Machine-local · <span className="font-mono">{model.host}</span> · {asOf}
        </div>

        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] items-start gap-4">
          {visibleDomains.map((d) => (
            <DomainTile
              key={d.slug}
              domain={d}
              logos={logos}
              filtering={!!filter}
              collapsed={collapsed.has(d.slug) && !filter}
              busy={busy}
              progress={progress && progress.slug === d.slug ? progress : null}
              allDomains={allDomains}
              onToggle={() => toggleCollapse(d.slug)}
              onAccept={(t) => void act(() => acceptTool(vaultPath, d.slug, t))}
              onAcceptStack={() => { setProgress({ slug: d.slug, done: 0, total: suggestableCount(d.tools) }); void act(() => acceptStack(vaultPath, d.slug, d.tools, (done, total) => setProgress({ slug: d.slug, done, total }))); }}
              onRemove={(t) => t.appId && void act(() => removeToolFromDomain(vaultPath, t.appId!, t.domains ?? [], d.slug))}
              onMove={(t, to) => t.appId && void act(() => moveTool(vaultPath, t.appId!, t.domains ?? [], d.slug, to))}
              onConnect={(t) => t.appId && openApp(t.appId)}
              onOpen={(t) => t.appId && openApp(t.appId)}
              onFileGap={(t) => void act(() => fileGapTask(vaultPath, d.slug, t.name))}
              onFileIdentity={(id) => void act(() => fileIdentityTask(vaultPath, d.slug, id))}
              onAddApp={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" }))}
              onOpenDomain={() => window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: d.slug }))}
            />
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-[11px]">
          <span className="font-mono uppercase tracking-[0.12em] text-text-muted">Weight</span>
          <WeightKey tone="bg-accent" weight="1" note="connected · CLI" />
          <WeightKey tone="bg-accent/60" weight="¾" note="MCP" />
          <WeightKey tone="bg-accent/30" weight="½" note="API · research" />
          <WeightKey tone="bg-surface-warm" weight="0" note="manual · browser · gap" />
          <span className="inline-flex items-center gap-1 text-text-muted"><Circle className="h-2.5 w-2.5 fill-transparent" /> hardware excluded</span>
          <span className="ml-auto inline-flex items-center gap-1 text-text-muted"><MousePointerClick className="h-3.5 w-3.5" /> tap a tool to open it</span>
        </div>
      </div>

      {obOpen && (
        <ObsidianImportModal
          vaultPath={vaultPath}
          domains={allDomains}
          onClose={() => setObOpen(false)}
          onDone={() => { setObOpen(false); void load(); }}
        />
      )}
    </div>
  );
}

function Stat({ n, label, alarm }: { n: number; label: string; alarm?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-2.5">
      <div className={`text-2xl font-semibold tabular-nums ${alarm ? "text-warn" : "text-text-primary"}`}>{n}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-text-muted">{label}</div>
    </div>
  );
}

// Compact score-weight key: a swatch scaled to the weight + a tiny label. Keeps
// the footer visual, not a paragraph.
function WeightKey({ tone, weight, note }: { tone: string; weight: string; note: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`${note} count ${weight}`}>
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${tone}`} />
      <span className="font-mono tabular-nums text-text-secondary">{weight}</span>
      <span className="text-text-muted">{note}</span>
    </span>
  );
}

interface TileProps {
  domain: MapDomain;
  logos: Record<string, BrandLogo>;
  filtering: boolean;
  collapsed: boolean;
  busy: boolean;
  progress: { done: number; total: number } | null;
  allDomains: { slug: string; label: string }[];
  onToggle: () => void;
  onAccept: (t: MapTool) => void;
  onAcceptStack: () => void;
  onRemove: (t: MapTool) => void;
  onMove: (t: MapTool, to: string) => void;
  onConnect: (t: MapTool) => void;
  onOpen: (t: MapTool) => void;
  onFileGap: (t: MapTool) => void;
  onFileIdentity: (id: string) => void;
  onAddApp: () => void;
  onOpenDomain: () => void;
}

// Above this many tools a tile would tower over its neighbors; cap the visible
// set so the grid rows stay even, with a "Show more" to reveal the rest.
const TILE_CAP = 8;

function DomainTile(p: TileProps) {
  const { domain, logos, filtering, collapsed, busy, progress } = p;
  const Icon = domainIcon(domain.slug) ?? Circle;
  const suggestable = suggestableCount(domain.tools);
  const [showAll, setShowAll] = useState(false);

  // Split the two things the user is comparing: what's IN the domain now vs what
  // we RECOMMEND adding. Keeping them in separate labeled groups is what makes
  // "Add recommended" self-explanatory.
  const owned = domain.tools.filter((t) => !t.suggested);
  const recommended = domain.tools.filter((t) => t.suggested);
  const ownedOverCap = !filtering && owned.length > TILE_CAP;
  const ownedShown = ownedOverCap && !showAll ? owned.slice(0, TILE_CAP) : owned;

  const chipFor = (t: MapTool, i: number) => (
    <Chip
      key={`${t.name}-${i}`}
      tool={t}
      logos={logos}
      busy={busy}
      domainSlug={domain.slug}
      allDomains={p.allDomains}
      onAccept={() => p.onAccept(t)}
      onRemove={() => p.onRemove(t)}
      onMove={(to) => p.onMove(t, to)}
      onConnect={() => p.onConnect(t)}
      onOpen={() => p.onOpen(t)}
      onFileGap={() => p.onFileGap(t)}
    />
  );

  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        {filtering ? (
          <span className="w-4" />
        ) : (
          <button onClick={p.onToggle} title={collapsed ? "Expand" : "Collapse"} className="shrink-0 text-text-muted transition-colors hover:text-accent">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
        <Icon className="h-4 w-4 shrink-0 text-accent" />
        <button onClick={p.onOpenDomain} title={`Open the ${domain.label} domain`} className="group flex min-w-0 flex-1 items-center gap-1 text-left">
          <h2 className="truncate text-base font-semibold text-text-primary transition-colors group-hover:text-accent group-hover:underline">{domain.label}</h2>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
        <span className="whitespace-nowrap font-mono text-xs tabular-nums text-text-muted">{domain.score}%</span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full bg-surface-warm">
        <span className={`block h-full rounded-full ${meterTone(domain.score)}`} style={{ width: `${domain.score}%` }} />
      </div>

      {!collapsed && (
        <>
          {domain.missingIdentities.map((id) => (
            <button
              key={id}
              disabled={busy}
              onClick={() => p.onFileIdentity(id)}
              title={`File a task to connect ${id}`}
              className="flex w-fit items-center gap-1 text-[11px] text-warn hover:underline disabled:opacity-50"
            >
              <TriangleAlert className="h-3 w-3 shrink-0" /> needs identity: {id} - file a task
            </button>
          ))}

          {/* In this domain now. */}
          {ownedShown.length > 0 && <div className="flex flex-wrap gap-1.5">{ownedShown.map(chipFor)}</div>}
          {ownedOverCap && (
            <button onClick={() => setShowAll((v) => !v)} className="flex w-fit items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-accent">
              {showAll ? <><ChevronDown className="h-3 w-3" /> Show less</> : <><ChevronRight className="h-3 w-3" /> Show {owned.length - TILE_CAP} more</>}
            </button>
          )}
          {owned.length === 0 && recommended.length > 0 && !filtering && (
            <p className="text-[11px] text-text-muted">Nothing connected here yet. Start with the recommended stack below.</p>
          )}

          {/* Recommended to add - clearly separated so "Add recommended" is obvious. */}
          {recommended.length > 0 && (
            <div className="space-y-1.5">
              {!filtering && (
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Recommended</span>
                  <span className="h-px flex-1 bg-border-subtle" />
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">{recommended.map(chipFor)}</div>
            </div>
          )}

          {/* Actions. */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {suggestable > 0 && (
              <button
                disabled={busy}
                onClick={p.onAcceptStack}
                title={`Add all ${suggestable} recommended: ${recommended.filter((t) => t.status !== "gap" && t.status !== "hardware").map((t) => t.name).join(", ")}`}
                className="flex w-fit items-center gap-1 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1 text-[11px] text-accent transition-colors hover:bg-accent hover:text-background disabled:opacity-60"
              >
                {progress ? (
                  <><RefreshCw className="h-3 w-3 animate-spin" /> Adding {progress.done}/{progress.total}...</>
                ) : (
                  <><Plus className="h-3 w-3" /> Add all recommended ({suggestable})</>
                )}
              </button>
            )}
            <button
              onClick={p.onAddApp}
              title="Connect another app to this domain"
              className="flex w-fit items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
            >
              <Plus className="h-3 w-3" /> Add app
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// Owned tools not yet authenticated on this machine can be connected in place.
const CONNECTABLE = new Set<ToolStatus>(["browser", "api", "mcp", "research", "broken"]);

interface ChipProps {
  tool: MapTool;
  logos: Record<string, BrandLogo>;
  busy: boolean;
  domainSlug: string;
  allDomains: { slug: string; label: string }[];
  onAccept: () => void;
  onRemove: () => void;
  onMove: (to: string) => void;
  onConnect: () => void;
  onOpen: () => void;
  onFileGap: () => void;
}

function Chip({ tool, logos, busy, domainSlug, allDomains, onAccept, onRemove, onMove, onConnect, onOpen, onFileGap }: ChipProps) {
  const [menu, setMenu] = useState(false);
  const title = [STATUS_LABEL[tool.status], tool.note, tool.identity ? `identity: ${tool.identity}` : "", tool.suggested ? "recommended - click to add" : "click to open its detail page"]
    .filter(Boolean)
    .join(" · ");

  const addable = tool.suggested && tool.status !== "gap" && tool.status !== "hardware";
  const owned = !tool.suggested && !!tool.appId;
  const connectable = owned && CONNECTABLE.has(tool.status);
  const isGap = tool.status === "gap";
  const moveTargets = allDomains.filter((d) => d.slug !== domainSlug);
  const logo = resolveAppLogo({ title: tool.name, id: tool.appId }, logos);
  const canOpen = owned;

  // One concise visual language: every chip is a neutral rounded rectangle.
  // SHAPE carries membership - solid = in this domain, dashed = recommended.
  // A single status DOT carries color, matching the filter legend. No per-status
  // fills, so the row reads clean instead of as a rainbow.
  return (
    <span
      className={`relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-xs ${
        tool.suggested
          ? "border-dashed border-border-subtle bg-transparent text-text-muted"
          : `border-border-subtle bg-surface text-text-secondary ${canOpen ? "cursor-pointer hover:border-border" : ""}`
      }`}
      title={title || undefined}
    >
      {/* Status dot (color = status, same key as the filter). */}
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[tool.status]}`} />
      {/* Real brand logo where we have it. */}
      {logo ? (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-white">
          <svg width={11} height={11} viewBox="0 0 24 24" fill={`#${logo.hex}`} aria-hidden><path d={logo.path} /></svg>
        </span>
      ) : null}
      <button
        onClick={canOpen ? onOpen : addable ? onAccept : undefined}
        disabled={busy && !!addable}
        className={`bg-transparent p-0 ${canOpen || addable ? "hover:underline" : "cursor-default"}`}
      >
        {tool.name}
        {tool.identity && !tool.suggested ? <span className="ml-1 opacity-70">· {tool.identity}</span> : null}
      </button>

      {addable && (
        <button disabled={busy} onClick={onAccept} title={`Add ${tool.name} to this domain`} className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-accent hover:bg-accent hover:text-background disabled:opacity-50">
          <Plus className="h-3 w-3" />
        </button>
      )}
      {isGap && !tool.suggested && (
        <button disabled={busy} onClick={onFileGap} title={`File a task to set up ${tool.name}`} className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-warn hover:text-background disabled:opacity-50">
          <ListPlus className="h-3 w-3" />
        </button>
      )}
      {connectable && (
        <button disabled={busy} onClick={onConnect} title={tool.status === "broken" ? `Reconnect ${tool.name}` : `Connect ${tool.name}`} className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-accent hover:text-background disabled:opacity-50">
          <Plug className="h-3 w-3" />
        </button>
      )}
      {owned && (
        <button disabled={busy} onClick={() => setMenu((m) => !m)} title="Move or remove" className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-70 hover:opacity-100 disabled:opacity-50">
          <MoreHorizontal className="h-3 w-3" />
        </button>
      )}
      {menu && owned && (
        <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-md border border-border bg-surface p-1 shadow-lg">
          <button onClick={() => { setMenu(false); onOpen(); }} className="block w-full rounded px-2 py-1 text-left text-[12px] text-text-secondary hover:bg-surface-warm hover:text-accent">
            Open detail page
          </button>
          <button onClick={() => { setMenu(false); onRemove(); }} className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] text-text-secondary hover:bg-surface-warm hover:text-err">
            <X className="h-3 w-3" /> Remove from {domainSlug}
          </button>
          {moveTargets.length > 0 && (
            <>
              <div className="mt-1 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Move to</div>
              <div className="max-h-40 overflow-y-auto">
                {moveTargets.map((d) => (
                  <button key={d.slug} onClick={() => { setMenu(false); onMove(d.slug); }} className="block w-full truncate rounded px-2 py-1 text-left text-[12px] text-text-secondary hover:bg-surface-warm hover:text-accent">
                    {d.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
