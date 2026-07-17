// Map panel: a cross-domain report of every domain's tool stack and how
// agent-operable it is. Read-only report (Phase 2) + organize actions (Phase 3):
// accept best-practice suggestions into a domain, add a whole recommended stack,
// and move or remove tools across domains. Activate (connect in place) is Phase 4.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Waypoints, TriangleAlert, Plus, MoreHorizontal, X } from "lucide-react";
import { loadMapModel } from "./maploader";
import { acceptTool, acceptStack, moveTool, removeToolFromDomain } from "./mapactions";
import { STATUS_LABEL, type MapModel, type MapDomain, type MapTool } from "./map";
import type { ToolStatus } from "./mapseed";

const CHIP: Record<ToolStatus, string> = {
  connected: "bg-accent text-background border-transparent",
  cli: "bg-ai text-white border-transparent",
  mcp: "border-accent text-accent",
  api: "bg-surface-warm text-text-secondary border-border-subtle",
  research: "bg-accent-soft text-accent border-accent-border",
  browser: "text-text-muted border-border-subtle",
  hardware: "text-text-muted border-dashed border-border-subtle",
  gap: "bg-warn/15 text-warn border-warn/40 font-semibold",
  broken: "bg-err/15 text-err border-err/40",
};

const LEGEND: ToolStatus[] = ["connected", "cli", "mcp", "api", "research", "browser", "gap", "broken", "hardware"];

function meterTone(score: number): string {
  if (score >= 75) return "bg-accent";
  if (score >= 40) return "bg-ai";
  return "bg-warn";
}

export function MapPanel({ vaultPath }: { vaultPath: string }) {
  const [model, setModel] = useState<MapModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<ToolStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setModel(await loadMapModel(vaultPath, { includeSuggestions: true }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [vaultPath]);

  useEffect(() => { void load(); }, [load]);

  // Run an organize action, then reload the model. Serialized via `busy`.
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [load]);

  const allDomains = useMemo(() => (model?.domains ?? []).map((d) => ({ slug: d.slug, label: d.label })), [model]);

  const asOf = useMemo(() => {
    if (!model) return "";
    try { return new Date(model.asOf).toLocaleString(); } catch { return model.asOf; }
  }, [model]);

  if (loading && !model) {
    return <div className="p-8 text-sm text-text-muted">Reading your domains and connections...</div>;
  }
  if (err && !model) {
    return (
      <div className="p-8 text-sm text-err">
        Could not build the map: {err}
        <button onClick={() => void load()} className="ml-3 rounded border border-border px-2 py-0.5 text-text-secondary hover:text-accent">Retry</button>
      </div>
    );
  }
  if (!model) return null;

  const s = model.stats;

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-6 pb-24">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-text-primary">
            <Waypoints className="h-5 w-5 text-accent" /> Map
          </h1>
          <span className="text-sm text-text-muted">every tool, in its domain, by how far an agent can act without you</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-mono text-lg font-semibold tabular-nums text-text-primary">{model.overallScore}%</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">agent-operable</div>
          </div>
          <button
            onClick={() => void load()}
            title="Re-probe connections on this machine"
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading || busy ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {err && <div className="mt-3 rounded border border-err/40 bg-err/10 px-3 py-1.5 text-[12px] text-err">{err}</div>}

      <div className="mt-4 flex flex-wrap gap-2.5">
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
            className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition-all ${CHIP[st]} ${
              filter === st ? "ring-2 ring-accent ring-offset-1 ring-offset-background" : filter ? "opacity-50" : ""
            }`}
          >
            {STATUS_LABEL[st]}
          </button>
        ))}
      </div>

      <div className="mt-3 text-[11px] text-text-muted">
        Auth is machine-local. This reflects <span className="font-mono">{model.host}</span> as of {asOf}. Another machine may differ.
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
        {model.domains.map((d) => (
          <DomainTile
            key={d.slug}
            domain={d}
            filter={filter}
            busy={busy}
            allDomains={allDomains}
            onAccept={(t) => void act(() => acceptTool(vaultPath, d.slug, t))}
            onAcceptStack={() => void act(() => acceptStack(vaultPath, d.slug, d.tools))}
            onRemove={(t) => t.appId && void act(() => removeToolFromDomain(vaultPath, t.appId!, t.domains ?? [], d.slug))}
            onMove={(t, to) => t.appId && void act(() => moveTool(vaultPath, t.appId!, t.domains ?? [], d.slug, to))}
          />
        ))}
      </div>

      <p className="mt-8 max-w-[72ch] border-t border-border pt-4 text-[13px] leading-relaxed text-text-muted">
        Agency score per domain: connected and CLI count full, MCP-available three quarters, API and research adds half,
        manual and browser zero; hardware is excluded and each gap counts against you. It answers one question: if an agent
        had to act in this domain right now, how far could it get without you? Suggested tools (dimmed) are best-practice
        picks you have not added yet and do not count until you add them.
      </p>
    </div>
  );
}

function Stat({ n, label, alarm }: { n: number; label: string; alarm?: boolean }) {
  return (
    <div className="min-w-[118px] rounded-md border border-border bg-surface px-4 py-2.5">
      <div className={`text-2xl font-semibold tabular-nums ${alarm ? "text-warn" : "text-text-primary"}`}>{n}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-text-muted">{label}</div>
    </div>
  );
}

interface TileProps {
  domain: MapDomain;
  filter: ToolStatus | null;
  busy: boolean;
  allDomains: { slug: string; label: string }[];
  onAccept: (t: MapTool) => void;
  onAcceptStack: () => void;
  onRemove: (t: MapTool) => void;
  onMove: (t: MapTool, to: string) => void;
}

function DomainTile({ domain, filter, busy, allDomains, onAccept, onAcceptStack, onRemove, onMove }: TileProps) {
  const suggestable = domain.tools.filter((t) => t.suggested && t.status !== "gap" && t.status !== "hardware").length;
  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-text-primary">{domain.label}</h2>
        <span className="whitespace-nowrap font-mono text-xs tabular-nums text-text-muted">{domain.score}% operable</span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full bg-surface-warm">
        <span className={`block h-full rounded-full ${meterTone(domain.score)}`} style={{ width: `${domain.score}%` }} />
      </div>
      {domain.missingIdentities.length > 0 && (
        <div className="flex items-center gap-1 text-[11px] text-warn">
          <TriangleAlert className="h-3 w-3 shrink-0" />
          needs identity: {domain.missingIdentities.join(", ")}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {domain.tools.map((t, i) => (
          <Chip
            key={`${t.name}-${i}`}
            tool={t}
            dimmed={!!filter && t.status !== filter}
            busy={busy}
            domainSlug={domain.slug}
            allDomains={allDomains}
            onAccept={() => onAccept(t)}
            onRemove={() => onRemove(t)}
            onMove={(to) => onMove(t, to)}
          />
        ))}
      </div>
      {suggestable > 0 && (
        <button
          disabled={busy}
          onClick={onAcceptStack}
          className="mt-1 flex w-fit items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2.5 py-0.5 text-[11px] text-accent transition-colors hover:bg-accent hover:text-background disabled:opacity-50"
        >
          <Plus className="h-3 w-3" /> Add recommended ({suggestable})
        </button>
      )}
    </section>
  );
}

interface ChipProps {
  tool: MapTool;
  dimmed: boolean;
  busy: boolean;
  domainSlug: string;
  allDomains: { slug: string; label: string }[];
  onAccept: () => void;
  onRemove: () => void;
  onMove: (to: string) => void;
}

function Chip({ tool, dimmed, busy, domainSlug, allDomains, onAccept, onRemove, onMove }: ChipProps) {
  const [menu, setMenu] = useState(false);
  const title = [tool.note, tool.identity ? `identity: ${tool.identity}` : "", tool.suggested ? "suggested - not added yet" : ""]
    .filter(Boolean)
    .join(" · ");

  // A suggested tool is a one-click add (gaps/hardware are not addable).
  const addable = tool.suggested && tool.status !== "gap" && tool.status !== "hardware";
  const owned = !tool.suggested && !!tool.appId;
  const moveTargets = allDomains.filter((d) => d.slug !== domainSlug);

  return (
    <span
      className={`relative inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs transition-opacity ${CHIP[tool.status]} ${
        tool.suggested ? "opacity-60" : ""
      } ${dimmed ? "opacity-15" : ""}`}
      title={title || undefined}
    >
      {tool.name}
      {tool.identity && !tool.suggested ? <span className="ml-1 opacity-70">· {tool.identity}</span> : null}
      {addable && (
        <button
          disabled={busy}
          onClick={onAccept}
          title={`Add ${tool.name} to this domain`}
          className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-accent hover:text-background disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      {owned && (
        <button
          disabled={busy}
          onClick={() => setMenu((m) => !m)}
          title="Move or remove"
          className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-70 hover:opacity-100 disabled:opacity-50"
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
      )}
      {menu && owned && (
        <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-md border border-border bg-surface p-1 shadow-lg">
          <button
            onClick={() => { setMenu(false); onRemove(); }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] text-text-secondary hover:bg-surface-warm hover:text-err"
          >
            <X className="h-3 w-3" /> Remove from {domainSlug}
          </button>
          {moveTargets.length > 0 && (
            <>
              <div className="mt-1 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Move to</div>
              <div className="max-h-40 overflow-y-auto">
                {moveTargets.map((d) => (
                  <button
                    key={d.slug}
                    onClick={() => { setMenu(false); onMove(d.slug); }}
                    className="block w-full truncate rounded px-2 py-1 text-left text-[12px] text-text-secondary hover:bg-surface-warm hover:text-accent"
                  >
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
