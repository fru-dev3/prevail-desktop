// Map panel: a cross-domain report of every domain's tool stack and how
// agent-operable it is, plus organize + activate in place. Read as: every
// domain, its recommended stack, what is wired vs not, so you can move things
// around, add the best-practice apps, and connect them.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Waypoints, TriangleAlert, Plus, MoreHorizontal, X, Plug, ListPlus, ChevronDown, ChevronRight, Circle, MousePointerClick, FolderInput } from "lucide-react";
import { invoke } from "./bridge";
import { ObsidianImportModal } from "./obsidianmodal";
import { loadMapModel } from "./maploader";
import { acceptTool, acceptStack, suggestableCount, moveTool, removeToolFromDomain, fileGapTask, fileIdentityTask } from "./mapactions";
import { resolveAppLogo } from "./panels3";
import { domainIcon } from "./icons";
import { STATUS_LABEL, type MapModel, type MapDomain, type MapTool } from "./map";
import type { ToolStatus } from "./mapseed";
import type { EngineApp, BrandLogo } from "./types";

// Per-status chip styling on the app's semantic tokens. Slightly-rounded
// rectangles (rounded-md), not pills.
const CHIP: Record<ToolStatus, string> = {
  connected: "bg-accent text-background border-transparent",
  cli: "bg-ai text-white border-transparent",
  mcp: "border-accent text-accent bg-transparent",
  api: "bg-surface-warm text-text-secondary border-border-subtle",
  research: "bg-accent-soft text-accent border-accent-border",
  browser: "text-text-muted border-border-subtle bg-transparent",
  hardware: "text-text-muted border-dashed border-border-subtle bg-transparent",
  gap: "bg-warn/15 text-warn border-warn/40 font-semibold",
  broken: "bg-err/15 text-err border-err/40",
};

const LEGEND: ToolStatus[] = ["connected", "cli", "mcp", "api", "research", "browser", "gap", "broken", "hardware"];

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
            <h1 className="text-lg font-semibold text-text-primary">Map</h1>
            <span className="hidden text-xs text-text-muted sm:inline">every tool, in its domain, by how far an agent can act without you</span>
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
              <FolderInput className="h-3.5 w-3.5" /> Import Obsidian
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
          <span className="mr-1 text-xs text-text-muted">Isolate a status:</span>
          {LEGEND.map((st) => (
            <button
              key={st}
              onClick={() => setFilter(filter === st ? null : st)}
              className={`rounded-md border px-2.5 py-0.5 font-mono text-[11px] transition-all ${CHIP[st]} ${
                filter === st ? "ring-2 ring-accent ring-offset-1 ring-offset-background" : filter ? "opacity-50" : ""
              }`}
            >
              {STATUS_LABEL[st]}
            </button>
          ))}
          {filter && (
            <button onClick={() => setFilter(null)} className="ml-1 rounded-md px-2 py-0.5 text-[11px] text-text-muted underline hover:text-accent">
              clear filter
            </button>
          )}
        </div>

        {filter && (
          <div className="mt-2 text-[11px] text-text-muted">
            Showing only <span className="text-text-secondary">{STATUS_LABEL[filter]}</span> tools across {visibleDomains.length} domain{visibleDomains.length === 1 ? "" : "s"}.
          </div>
        )}

        <div className="mt-3 text-[11px] text-text-muted">
          Auth is machine-local. This reflects <span className="font-mono">{model.host}</span> as of {asOf}. Another machine may differ.
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
}

function DomainTile(p: TileProps) {
  const { domain, logos, filtering, collapsed, busy, progress } = p;
  const Icon = domainIcon(domain.slug) ?? Circle;
  const suggestable = suggestableCount(domain.tools);
  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <button onClick={p.onToggle} disabled={filtering} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
          {filtering ? <span className="w-4" /> : collapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" /> : <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />}
          <Icon className="h-4 w-4 shrink-0 text-accent" />
          <h2 className="truncate text-base font-semibold text-text-primary">{domain.label}</h2>
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
          <div className="flex flex-wrap gap-1.5">
            {domain.tools.map((t, i) => (
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
            ))}
          </div>
          {suggestable > 0 && (
            <button
              disabled={busy}
              onClick={p.onAcceptStack}
              className="mt-1 flex w-fit items-center gap-1 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1 text-[11px] text-accent transition-colors hover:bg-accent hover:text-background disabled:opacity-60"
            >
              {progress ? (
                <><RefreshCw className="h-3 w-3 animate-spin" /> Adding {progress.done}/{progress.total}...</>
              ) : (
                <><Plus className="h-3 w-3" /> Add recommended ({suggestable})</>
              )}
            </button>
          )}
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
  const title = [tool.note, tool.identity ? `identity: ${tool.identity}` : "", tool.suggested ? "suggested - not added yet" : "click to open its detail page"]
    .filter(Boolean)
    .join(" · ");

  const addable = tool.suggested && tool.status !== "gap" && tool.status !== "hardware";
  const owned = !tool.suggested && !!tool.appId;
  const connectable = owned && CONNECTABLE.has(tool.status);
  const isGap = tool.status === "gap";
  const moveTargets = allDomains.filter((d) => d.slug !== domainSlug);
  const logo = resolveAppLogo({ title: tool.name, id: tool.appId }, logos);
  const canOpen = owned;

  return (
    <span
      className={`relative inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs ${CHIP[tool.status]} ${
        tool.suggested ? "opacity-60" : ""
      } ${canOpen ? "cursor-pointer" : ""}`}
      title={title || undefined}
    >
      {/* Real brand logo where we have it, else a small status dot. */}
      {logo ? (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-white">
          <svg width={11} height={11} viewBox="0 0 24 24" fill={`#${logo.hex}`} aria-hidden><path d={logo.path} /></svg>
        </span>
      ) : null}
      <button
        onClick={canOpen ? onOpen : undefined}
        disabled={!canOpen}
        className={`bg-transparent p-0 ${canOpen ? "hover:underline" : "cursor-default"}`}
      >
        {tool.name}
        {tool.identity && !tool.suggested ? <span className="ml-1 opacity-70">· {tool.identity}</span> : null}
      </button>

      {addable && (
        <button disabled={busy} onClick={onAccept} title={`Add ${tool.name} to this domain`} className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-accent hover:text-background disabled:opacity-50">
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
