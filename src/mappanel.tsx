// Map panel: a cross-domain report of every domain's tool stack and how
// agent-operable it is. Phase 2 is the read-only view (tiles, chips, meters,
// stat row, click-to-isolate legend). Organize + Activate land in later phases.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Waypoints, TriangleAlert } from "lucide-react";
import { loadMapModel } from "./maploader";
import { STATUS_LABEL, type MapModel, type MapDomain, type MapTool } from "./map";
import type { ToolStatus } from "./mapseed";

// Per-status chip styling, mapped onto the app's semantic Tailwind tokens.
// Weight reads left (wired, solid) to right (missing, alarmed).
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

// The legend order (also the filter buttons). hardware last; excluded from score.
const LEGEND: ToolStatus[] = ["connected", "cli", "mcp", "api", "research", "browser", "gap", "broken", "hardware"];

function meterTone(score: number): string {
  if (score >= 75) return "bg-accent";
  if (score >= 40) return "bg-ai";
  return "bg-warn";
}

export function MapPanel({ vaultPath }: { vaultPath: string }) {
  const [model, setModel] = useState<MapModel | null>(null);
  const [loading, setLoading] = useState(true);
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

  const asOf = useMemo(() => {
    if (!model) return "";
    try { return new Date(model.asOf).toLocaleString(); } catch { return model.asOf; }
  }, [model]);

  if (loading && !model) {
    return <div className="p-8 text-sm text-text-muted">Reading your domains and connections...</div>;
  }
  if (err) {
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
      {/* Header */}
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
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Stat row */}
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Stat n={s.tools} label="tools tracked" />
        <Stat n={s.wired} label="agent-wired now" />
        <Stat n={s.scriptable} label="scriptable next" />
        <Stat n={s.manual} label="manual only" />
        <Stat n={s.gaps} label="gaps" alarm={s.gaps > 0} />
      </div>

      {/* Legend / filter */}
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

      {/* Machine-local stamp */}
      <div className="mt-3 text-[11px] text-text-muted">
        Auth is machine-local. This reflects <span className="font-mono">{model.host}</span> as of {asOf}. Another machine may differ.
      </div>

      {/* Domain grid */}
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-4">
        {model.domains.map((d) => (
          <DomainTile key={d.slug} domain={d} filter={filter} />
        ))}
      </div>

      <p className="mt-8 max-w-[72ch] border-t border-border pt-4 text-[13px] leading-relaxed text-text-muted">
        Agency score per domain: connected and CLI count full, MCP-available three quarters, API and research adds half,
        manual and browser zero; hardware is excluded and each gap counts against you. It answers one question: if an agent
        had to act in this domain right now, how far could it get without you? Suggested tools (dimmed) are best-practice
        picks you have not added yet and do not count until you do.
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

function DomainTile({ domain, filter }: { domain: MapDomain; filter: ToolStatus | null }) {
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
          <Chip key={`${t.name}-${i}`} tool={t} dimmed={!!filter && t.status !== filter} />
        ))}
      </div>
    </section>
  );
}

function Chip({ tool, dimmed }: { tool: MapTool; dimmed: boolean }) {
  const title = [tool.note, tool.identity ? `identity: ${tool.identity}` : "", tool.suggested ? "suggested - not added yet" : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={title || undefined}
      className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs transition-opacity ${CHIP[tool.status]} ${
        tool.suggested ? "opacity-45" : ""
      } ${dimmed ? "opacity-15" : ""}`}
    >
      {tool.name}
      {tool.identity && !tool.suggested ? <span className="ml-1 opacity-70">· {tool.identity}</span> : null}
    </span>
  );
}
