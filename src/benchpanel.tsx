// The Benchmark UI cluster extracted from App.tsx: BenchmarkPanel (the page) and
// its BenchRunConfig / BenchResults / BenchMatrix / BenchQuestions children. The
// run registry + executor live in ./bench; this is the presentation layer.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm as tauriConfirm, open, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Activity, AlertTriangle, Archive, Award, Bookmark, BrainCircuit, CalendarClock, Check, ChevronLeft, ChevronRight, Circle, Coins, Crown, DollarSign, Download, ExternalLink, FileText, Gauge, Layers, LineChart, Loader2, MessagesSquare, Pencil, Play, Plus, RotateCw, Scale, ShieldCheck, Sparkles, Target, Trash2, TrendingUp, Upload, X, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, listen } from "./bridge";
import { MODELS, MODEL_SEP } from "./constants";
import { scoreColor, titleCase } from "./format";
import { isLocalCli } from "./helpers";
import { curatedFor, modelLabel, modelsFor, parseRunLabel } from "./helpers2";
import { BenchScheduleCard } from "./cards";
import { PREF, getPref, isBunkerOn, lsGet, lsSet } from "./storage";
import { BenchCrumbs, Field, ScoreBar } from "./panels";
import { Sparkline } from "./ui";
import { ArenaBars, ArenaHeader, ArenaInsight, ArenaMetric, ArenaRightRail, ArenaStatCard, heatBg } from "./arena/arenaui";
import { domainIcon } from "./icons";
import { BENCH_CLI_OPTIONS, BENCH_SCHED, benchBatches, benchFreqLabel, benchNotify, cancelBenchBatch, executeBenchBatch, startQuestionSuggest, useBenchBatches, useQuestionSuggest } from "./bench";
import { canonicalPresets, deleteSuite, saveSuite, useSuites } from "./bench-presets";
import type { AvailablePresetModel, BenchSuite, CanonicalPreset } from "./bench-presets";
import { ProviderMark } from "./marks";
import { autoVerifyClis, useCliVerifyLive } from "./verify";
import type { BenchBatch, BenchJob, BenchJobStatus, BenchQuestion, BenchmarkRun, CliInfo, Domain, EngineApp, MatrixRow, RunDetail } from "./types";
import type { UnlistenFn } from "./bridge";

// --- Model Scout suggestions ---------------------------------------------------
// The General domain's daily Model Scout loop web-searches for AI models worth
// adding to the benchmark (open-weight + frontier) and writes them to
// build/_meta/model_suggestions.json. This panel surfaces that list in the Arena
// and lets the user force a fresh scan. Models in the benchmark are defined in
// the MODELS catalog, so this RECOMMENDS - the user folds the ones they want in.
interface ScoutItem { name: string; provider: string; kind: "open" | "frontier"; reason: string; url?: string; source?: string }
interface ScoutFile { generated?: number; model?: string; items?: ScoutItem[] }

function ModelScoutSuggestions({ vaultPath }: { vaultPath: string }) {
  const [doc, setDoc] = useState<ScoutFile | null>(null);
  const [scanning, setScanning] = useState(false);
  const load = useCallback(() => {
    invoke<ScoutFile>("model_suggestions_read", { vault: vaultPath })
      .then((d) => setDoc(d && typeof d === "object" ? d : null)).catch(() => {});
  }, [vaultPath]);
  useEffect(() => { load(); }, [load]);
  const known = useMemo(() => Object.values(MODELS).flat().map((m) => m.label).join(","), []);
  const rescan = async () => {
    setScanning(true);
    try { await invoke("model_scout_run", { vault: vaultPath, known }); load(); }
    catch { /* surfaced as no change */ }
    finally { setScanning(false); }
  };
  const items = doc?.items ?? [];
  // Without a source URL from the scan, give every suggestion a useful link:
  // a web search for the exact model so you can read about it and decide.
  const linkFor = (it: ScoutItem) => it.url || `https://www.google.com/search?q=${encodeURIComponent(`${it.provider} ${it.name} AI model`)}`;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BrainCircuit className="h-4 w-4 text-accent" />
        <span className="text-sm font-semibold text-text-primary">Model Scout</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-text-muted">{items.length ? `${items.length} suggested${doc?.generated ? ` · scanned ${new Date(doc.generated).toLocaleDateString()}` : ""}` : "daily web scan"}</span>
      </div>
      {/* Why this page matters — new models ship constantly; Scout keeps the
          Arena's roster current so you don't have to track releases yourself. */}
      <div className="rounded-lg border border-accent-border/40 bg-accent-soft/30 px-3 py-2.5">
        <p className="text-[12px] leading-relaxed text-text-secondary">
          <span className="font-semibold text-text-primary">New models ship every week.</span> Scout's daily web scan flags freshly-released models (open-weight and frontier) worth adding to your Arena, so your benchmarks stay current without you tracking announcements. Each suggestion links to its source; pick the ones you care about and add them as Arena models to run.
        </p>
      </div>
      <div className="space-y-2 px-1">
        <div className="flex items-center justify-end gap-2 text-[11px] text-text-muted">
          <button
            onClick={rescan}
            disabled={scanning}
            title="Scan the web for models now"
            className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-warm hover:text-accent disabled:opacity-40"
          >
            <RotateCw className={`h-3 w-3 ${scanning ? "animate-spin" : ""}`} /> {scanning ? "Scanning…" : "Scan now"}
          </button>
        </div>
        {items.length === 0 ? (
          <p className="text-[11px] text-text-muted">No suggestions yet. Run a scan, or open General → Loops to activate the daily Model Scout.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((it, i) => (
              <li key={`${it.name}-${i}`} className="flex items-start gap-2 rounded-md border border-border-subtle bg-surface-warm/40 px-2 py-1.5">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${it.kind === "open" ? "bg-accent/15 text-accent" : "bg-warn/15 text-warn"}`}>{it.kind}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-text-primary">{it.name}</span>
                  <span className="ml-1 text-[11px] text-text-muted">({it.provider})</span>
                  {it.reason && <span className="block text-[11px] leading-snug text-text-muted">{it.reason}</span>}
                </span>
                <button
                  onClick={() => void openUrl(linkFor(it))}
                  title={it.url ? `Open source: ${it.url}` : `Search the web for ${it.name}`}
                  className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-border-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-muted hover:border-accent-border hover:text-accent"
                >
                  {it.url ? "source" : "look up"} <ExternalLink className="h-2.5 w-2.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --- 3D Arena formatting (intelligence · speed · cost) --------------------
// Latency: show ms under a second, else seconds.
export function fmtLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}
// Throughput tokens/sec.
export function fmtThroughput(tps: number | null | undefined): string {
  if (tps === null || tps === undefined) return "-";
  return `${tps >= 100 ? Math.round(tps) : tps.toFixed(1)} tok/s`;
}
// Cost: local runs are free; priced runs show $ to a sensible precision.
export function fmtCost(usd: number | null | undefined, basis?: string | null): string {
  if (basis === "local") return "free";
  if (usd === null || usd === undefined) return "-";
  if (usd === 0) return "free";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

// The three dimensions as a compact inline strip: intelligence (judge /10),
// speed (avg latency), and cost (estimated $ or "free" for local). Always
// shows all three so every run is comparable on all axes.
export function RunDims({ run, judge }: { run: BenchmarkRun; judge?: number | null }) {
  const j = judge !== undefined ? judge : run.judge_avg;
  return (
    <span className="flex shrink-0 items-center gap-2.5 font-mono text-[11px]">
      <span className="inline-flex items-center gap-1 text-accent" title="Intelligence: judge score /10">
        <BrainCircuit className="h-3 w-3" />
        <span className="font-semibold">{j !== null && j !== undefined ? j.toFixed(1) : "-"}</span>
      </span>
      <span className="inline-flex items-center gap-1 text-text-muted" title="Speed: average latency per question">
        <Zap className="h-3 w-3" />
        {fmtLatency(run.ms_avg)}
      </span>
      <span
        className={`inline-flex items-center gap-1 ${run.cost_basis === "local" || run.cost_usd_est === 0 ? "text-ok" : "text-text-muted"}`}
        title={`Cost: estimated ${run.cost_basis === "local" ? "(local model, free to run)" : "from token usage"}`}
      >
        <DollarSign className="h-3 w-3" />
        {fmtCost(run.cost_usd_est, run.cost_basis)}
      </span>
    </span>
  );
}

export function BenchMatrix({
  matrix, allDomains, onPick, currentDomain, runs = [],
}: {
  matrix: MatrixRow[];
  allDomains: string[];
  onPick: (runDir: string) => void;
  // When the Arena is opened inside a domain, that column leads and is
  // highlighted so it stands out against the others.
  currentDomain?: string | null;
  // Real runs, joined by run_dir so the matrix can show each model's cost +
  // speed alongside its per-domain scores (the mockup's rightmost columns).
  runs?: BenchmarkRun[];
}) {
  const runByDir = useMemo(() => {
    const m = new Map<string, BenchmarkRun>();
    for (const r of runs) m.set(r.run_dir, r);
    return m;
  }, [runs]);
  const bestPerDomain = useMemo(() => {
    const best: Record<string, number> = {};
    for (const d of allDomains) {
      let b = -1;
      for (const m of matrix) {
        const v = m.per_domain[d]?.judge_avg;
        if (v != null && v > b) b = v;
      }
      best[d] = b;
    }
    return best;
  }, [matrix, allDomains]);

  const cur = currentDomain?.toLowerCase() ?? null;
  // Column order: the current domain first (if any), then every domain that has
  // benchmark data, then the empty ones pushed all the way to the right.
  const orderedDomains = useMemo(() => {
    const hasData = (d: string) => (bestPerDomain[d] ?? -1) >= 0;
    const withData = allDomains.filter((d) => hasData(d) && d !== cur);
    const without = allDomains.filter((d) => !hasData(d) && d !== cur);
    const lead = cur && allDomains.includes(cur) ? [cur] : [];
    return [...lead, ...withData, ...without];
  }, [allDomains, bestPerDomain, cur]);

  const rows = useMemo(
    () => [...matrix].sort((a, b) => (b.judge_avg ?? -1) - (a.judge_avg ?? -1)),
    [matrix],
  );

  // Declutter: always show the top N models by overall score; the rest are
  // opt-in via a multi-select filter (persisted). Keeps the matrix readable
  // without losing access to every benchmarked model.
  const TOP_N = 6;
  const [extra, setExtra] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("prevail.bench.extraModels") || "[]")); } catch { return new Set(); }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const setExtraPersist = (next: Set<string>) => {
    setExtra(next);
    try { localStorage.setItem("prevail.bench.extraModels", JSON.stringify([...next])); } catch { /* ignore */ }
  };
  const toggleExtra = (rd: string) => { const n = new Set(extra); if (n.has(rd)) n.delete(rd); else n.add(rd); setExtraPersist(n); };
  const topDirs = useMemo(() => new Set(rows.slice(0, TOP_N).map((m) => m.run_dir)), [rows]);
  const extraModels = useMemo(() => rows.slice(TOP_N), [rows]);
  const visibleRows = useMemo(() => rows.filter((m) => topDirs.has(m.run_dir) || extra.has(m.run_dir)), [rows, topDirs, extra]);

  // Same declutter for COLUMNS: show the top N dimensions (current domain +
  // those with the most data) by default, and let the user choose exactly which
  // dimensions to show so a vault with many domains doesn't force a sideways
  // scroll. null selection = the default top-N; otherwise the explicit picks.
  const TOP_DIMS = 5;
  const defaultDims = useMemo(() => {
    // Default to dimensions that actually have data (so empty columns like a
    // never-tested Career/Homestead don't take space), capped at the top N;
    // keep the current domain visible if we're scoped to one.
    const withData = orderedDomains.filter((d) => (bestPerDomain[d] ?? -1) >= 0);
    const base = (withData.length ? withData : orderedDomains).slice(0, TOP_DIMS);
    return cur && orderedDomains.includes(cur) && !base.includes(cur) ? [cur, ...base].slice(0, TOP_DIMS) : base;
  }, [orderedDomains, bestPerDomain, cur]);
  const [dimSel, setDimSel] = useState<string[] | null>(() => {
    try { const v = localStorage.getItem("prevail.bench.matrixDims"); return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const setDimSelPersist = (next: string[] | null) => {
    setDimSel(next);
    try { if (next && next.length) localStorage.setItem("prevail.bench.matrixDims", JSON.stringify(next)); else localStorage.removeItem("prevail.bench.matrixDims"); } catch { /* ignore */ }
  };
  const visibleDomains = useMemo(() => {
    const sel = new Set(dimSel ?? defaultDims);
    const v = orderedDomains.filter((d) => sel.has(d));
    return v.length ? v : defaultDims; // never collapse to zero columns
  }, [orderedDomains, dimSel, defaultDims]);
  const [dimPickerOpen, setDimPickerOpen] = useState(false);
  const toggleDim = (d: string) => {
    const cur2 = new Set(visibleDomains);
    if (cur2.has(d)) cur2.delete(d); else cur2.add(d);
    setDimSelPersist(orderedDomains.filter((x) => cur2.has(x)));
  };

  if (allDomains.length === 0) return <div className="text-sm text-text-muted">No domain data yet.</div>;

  return (
    <div>
      {/* Filter bar: top models + top dimensions shown; multi-select to refine. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {visibleRows.length}/{rows.length} models · {visibleDomains.length}/{orderedDomains.length} dimensions
        </span>
        <div className="flex flex-wrap items-center gap-2">
        {orderedDomains.length > 1 && (
          <div className="relative">
            <button
              onClick={() => setDimPickerOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-border hover:text-accent"
            >
              <Layers className="h-3.5 w-3.5" /> Dimensions · {visibleDomains.length}
              <ChevronRight className={`h-3 w-3 transition-transform ${dimPickerOpen ? "rotate-90" : ""}`} />
            </button>
            {dimPickerOpen && (
              <div className="absolute right-0 z-20 mt-1 max-h-72 w-60 overflow-auto rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                <div className="flex items-center justify-between px-1.5 py-1">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">Show dimensions</span>
                  <button onClick={() => setDimSelPersist(null)} className="text-[10px] text-text-muted hover:text-accent">Top {TOP_DIMS}</button>
                </div>
                {orderedDomains.map((d) => {
                  const on = visibleDomains.includes(d);
                  return (
                    <button key={d} onClick={() => toggleDim(d)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-surface-warm">
                      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-background" : "border-border"}`}>{on && <Check className="h-2.5 w-2.5" />}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-text-primary">{titleCase(d)}</span>
                      <span className="shrink-0 font-mono text-[10px] text-text-muted">{(bestPerDomain[d] ?? -1) >= 0 ? (bestPerDomain[d]).toFixed(1) : "·"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {extraModels.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-border hover:text-accent"
            >
              <Layers className="h-3.5 w-3.5" /> Filter models{extra.size > 0 ? ` · ${extra.size} added` : ""}
              <ChevronRight className={`h-3 w-3 transition-transform ${pickerOpen ? "rotate-90" : ""}`} />
            </button>
            {pickerOpen && (
              <div className="absolute right-0 z-20 mt-1 max-h-72 w-72 overflow-auto rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                <div className="flex items-center justify-between px-1.5 py-1">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">Add more models</span>
                  {extra.size > 0 && <button onClick={() => setExtraPersist(new Set())} className="text-[10px] text-text-muted hover:text-accent">Clear</button>}
                </div>
                {extraModels.map((m) => {
                  const p = parseRunLabel(m.label);
                  const on = extra.has(m.run_dir);
                  return (
                    <button
                      key={m.run_dir}
                      onClick={() => toggleExtra(m.run_dir)}
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-surface-warm"
                    >
                      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-background" : "border-border"}`}>{on && <Check className="h-2.5 w-2.5" />}</span>
                      <ProviderMark vendor={p.vendor} size={14} />
                      <span className="min-w-0 flex-1 truncate font-mono text-text-primary" title={p.model || m.label}>{p.model || m.label}</span>
                      <span className="shrink-0 font-mono text-[10px] text-text-muted">{m.judge_avg?.toFixed(1) ?? "-"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="sticky left-0 bg-surface px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-text-muted">Model</th>
            {visibleDomains.map((d) => (
              <th key={d} className={`px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider ${d === cur ? "bg-accent font-bold text-background" : "text-text-muted"}`}>{titleCase(d)}</th>
            ))}
            <th className="border-l border-border px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-accent">Avg score</th>
            <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-text-muted">Cost</th>
            <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-text-muted">Speed</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((m) => {
            const parsed = parseRunLabel(m.label);
            return (
              <tr key={m.run_dir} className="border-b border-border-subtle last:border-0 hover:bg-surface-warm">
                <td className="sticky left-0 bg-background px-3 py-2">
                  <button onClick={() => onPick(m.run_dir)} className="inline-flex max-w-[200px] items-center gap-1.5 hover:text-accent">
                    <ProviderMark vendor={parsed.vendor} size={16} />
                    <span className="truncate whitespace-nowrap font-mono text-xs text-text-primary" title={parsed.model || m.label}>{parsed.model || m.label}</span>
                  </button>
                </td>
                {visibleDomains.map((d) => {
                  const cell = m.per_domain[d];
                  const v = cell?.judge_avg ?? null;
                  const isBest = v != null && v === bestPerDomain[d] && v >= 0;
                  // Every scored cell gets a heatmap tint (green high -> red low),
                  // and the best model per domain gets a ring so it still pops.
                  return (
                    <td
                      key={d}
                      className={`px-3 py-2 text-center font-mono text-xs ${isBest ? "font-bold" : ""}`}
                      style={{ background: v == null ? undefined : heatBg(v), boxShadow: isBest ? "inset 0 0 0 1.5px var(--color-accent)" : undefined }}
                    >
                      {v == null ? <span className="text-text-muted/40">-</span> : <span className="text-text-primary">{v.toFixed(1)}</span>}
                    </td>
                  );
                })}
                <td className="border-l border-border px-3 py-2 text-center font-mono text-xs font-semibold text-accent">{m.judge_avg?.toFixed(1) ?? "-"}</td>
                <td className="px-3 py-2 text-center font-mono text-[11px] text-text-muted">{(() => { const r = runByDir.get(m.run_dir); return r ? fmtCost(r.cost_usd_est, r.cost_basis) : "-"; })()}</td>
                <td className="px-3 py-2 text-center font-mono text-[11px] text-text-muted">{(() => { const r = runByDir.get(m.run_dir); return r ? fmtLatency(r.ms_avg) : "-"; })()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// Right-rail insights for the Model x domain matrix: the strongest model
// overall, the strongest per domain, and the biggest top-vs-bottom gaps. All
// computed from the real matrix data (judge averages); no invented numbers.
function MatrixInsights({ matrix, allDomains }: { matrix: MatrixRow[]; allDomains: string[] }) {
  const insights = useMemo(() => {
    const ranked = [...matrix].filter((m) => m.judge_avg != null).sort((a, b) => (b.judge_avg ?? -1) - (a.judge_avg ?? -1));
    const overall = ranked[0] ?? null;
    const perDomain = allDomains.map((d) => {
      const scored = matrix
        .map((m) => ({ model: parseRunLabel(m.label).model || m.label, v: m.per_domain[d]?.judge_avg ?? null }))
        .filter((x): x is { model: string; v: number } => x.v != null);
      if (scored.length === 0) return null;
      const sorted = [...scored].sort((a, b) => b.v - a.v);
      const top = sorted[0];
      const bottom = sorted[sorted.length - 1];
      return { domain: d, top, gap: scored.length > 1 ? top.v - bottom.v : 0, n: scored.length };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
    const byGap = [...perDomain].sort((a, b) => b.gap - a.gap).slice(0, 5);
    return { overall, perDomain, byGap };
  }, [matrix, allDomains]);

  if (!insights.overall) return null;
  const maxGap = Math.max(0.0001, ...insights.byGap.map((g) => g.gap));
  return (
    <ArenaRightRail>
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Strongest overall</div>
        <div className="mt-1.5 flex items-center gap-2">
          <Award className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate font-display text-base font-bold tracking-tight text-text-primary">{parseRunLabel(insights.overall.label).model || insights.overall.label}</span>
          <span className="font-mono text-lg font-bold text-accent">{insights.overall.judge_avg?.toFixed(1)}</span>
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-text-muted">avg judge score across {insights.perDomain.length} domain{insights.perDomain.length === 1 ? "" : "s"}</div>
      </div>
      {insights.perDomain.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">Strongest by domain</div>
          <div className="space-y-1.5">
            {insights.perDomain.map((p) => {
              const Icon = domainIcon(p.domain) ?? Circle;
              return (
                <div key={p.domain} className="flex items-center gap-2 text-[12px]">
                  <Icon className="h-3 w-3 shrink-0 text-text-muted" />
                  <span className="w-20 shrink-0 truncate text-text-secondary">{titleCase(p.domain)}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-text-primary">{p.top.model}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold" style={{ background: heatBg(p.top.v), color: "var(--color-text-primary)" }}>{p.top.v.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {insights.byGap.length > 0 && insights.byGap[0].gap > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">Biggest gaps (top vs bottom)</div>
          <div className="space-y-2">
            {insights.byGap.filter((g) => g.gap > 0).map((g) => {
              const Icon = domainIcon(g.domain) ?? Circle;
              return (
                <div key={g.domain} className="flex items-center gap-2">
                  <Icon className="h-3 w-3 shrink-0 text-text-muted" />
                  <span className="w-20 shrink-0 truncate text-[12px] text-text-secondary">{titleCase(g.domain)}</span>
                  <span className="font-mono text-[11px] tabular-nums text-text-primary">{g.gap.toFixed(2)}</span>
                  <div className="min-w-0 flex-1"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${(g.gap / maxGap) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">A wide gap means model choice matters a lot in that domain; a narrow gap means most models perform similarly.</p>
        </div>
      )}
    </ArenaRightRail>
  );
}

export function BenchQuestions({
  vaultPath, questions, allDomains, initialDomain, onChanged,
}: {
  vaultPath: string;
  questions: BenchQuestion[];
  allDomains: string[];
  initialDomain?: string | null;
  onChanged: () => void;
}) {
  // Domain-scoped panel: show that domain's questions, not the whole suite.
  const [filter, setFilter] = useState<string>(initialDomain ? initialDomain.toLowerCase() : "all");
  const [editing, setEditing] = useState<BenchQuestion | "new" | null>(null);
  const blank: BenchQuestion = { id: "", domain: "", prompt: "", context: "", notes: "", council: false, expected_decision: "", expected_verdict_keywords: [], path: "" };
  const [draft, setDraft] = useState<BenchQuestion>(blank);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  // AI question suggestion runs in a MODULE-SCOPE registry (see startQuestionSuggest
  // in ./bench) so it survives navigation away from Arena and back, and panel
  // remounts. We only subscribe here; the job state is the source of truth.
  const qJobs = useQuestionSuggest();
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestDomain, setSuggestDomain] = useState<string>(initialDomain?.toLowerCase() ?? "");
  const [suggestCount, setSuggestCount] = useState(3);
  const [suggestModel, setSuggestModel] = useState(() => {
    if (!isBunkerOn()) return `claude${MODEL_SEP}opus`;
    // Bunker Mode: default to the first local provider's first model.
    const [cli, models] = Object.entries(MODELS).find(([c, ms]) => isLocalCli(c) && ms.length > 0) ?? [];
    return cli && models ? `${cli}${MODEL_SEP}${models[0].id}` : `claude${MODEL_SEP}opus`;
  });

  // Which domains the current suggest selection targets (for job matching).
  const suggestTargets = useMemo(() => {
    const d = suggestDomain.trim().toLowerCase();
    if (!d) return [] as string[];
    return d === "all" ? allDomains.map((x) => x.toLowerCase()) : [d];
  }, [suggestDomain, allDomains]);
  // Derive the button/label state from the module-scope jobs, so "Drafting…"
  // stays correct even after the panel remounts mid-run.
  const relevantJobs = qJobs.filter((j) => j.vault === vaultPath && suggestTargets.includes(j.domain));
  const suggesting = relevantJobs.some((j) => j.status === "running");
  // Any running suggest job for this vault (across domains) - shown as a small
  // "still running in the background" note independent of the current selection.
  const runningJobs = qJobs.filter((j) => j.vault === vaultPath && j.status === "running");

  // When a background suggest finishes, reload the question list so completed
  // drafts appear whether or not the user was on this page while it ran.
  useEffect(() => {
    const onChangedEvt = () => onChanged();
    window.addEventListener("prevail:questions-changed", onChangedEvt);
    return () => window.removeEventListener("prevail:questions-changed", onChangedEvt);
  }, [onChanged]);

  const inFilter = filter === "all" ? questions : questions.filter((q) => q.domain === filter);
  // AI drafts float to the top so a fresh "Suggest with AI" run is immediately
  // visible (and obviously needs your review) instead of sorting into the middle
  // of the list where you'd never notice it landed.
  const shown = inFilter
    .filter((q) => !q.archived)
    .slice()
    .sort((a, b) => (a.source === "ai" ? 0 : 1) - (b.source === "ai" ? 0 : 1));
  const archivedShown = inFilter.filter((q) => q.archived);
  async function setArchived(q: BenchQuestion, archived: boolean) {
    try {
      await invoke("benchmark_set_question_archived", { path: q.path, archived });
      onChanged();
    } catch (e) { setInfo(`Archive failed: ${e}`); }
  }

  // Export the whole suite as one portable prevail.bench/v1 JSON file.
  async function exportQuestions() {
    try {
      const dest = await saveFileDialog({
        defaultPath: "prevail-bench-questions.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!dest) return;
      await invoke("benchmark_export_questions", { vault: vaultPath, dest });
      setInfo(`Exported ${questions.length} question${questions.length === 1 ? "" : "s"} to ${dest.split("/").pop()}`);
    } catch (e) {
      setInfo(`Export failed: ${e}`);
    }
  }

  // Import a prevail.bench/v1 file; existing ids are skipped, never overwritten.
  async function importQuestions() {
    try {
      const picked = await open({ filters: [{ name: "JSON", extensions: ["json"] }], multiple: false });
      const path = typeof picked === "string" ? picked : null;
      if (!path) return;
      const json = await invoke<string>("read_file", { path });
      const report = await invoke<{ created: string[]; skipped: string[] }>("benchmark_import_questions", { vault: vaultPath, json });
      setInfo(`Imported ${report.created.length} question${report.created.length === 1 ? "" : "s"}${report.skipped.length ? `, skipped ${report.skipped.length} (already exist or malformed)` : ""}`);
      onChanged();
    } catch (e) {
      setInfo(`Import failed: ${e}`);
    }
  }

  // AI-draft questions from each domain's own context, via the engine's
  // `bench suggest`. Fire-and-forget into the MODULE-SCOPE registry so the run
  // survives navigation away and back; startQuestionSuggest streams, recounts,
  // and dispatches prevail:questions-changed on completion (which reloads the
  // list here). We do NOT await it - the button label follows the job status.
  function suggestWithAi() {
    const domain = suggestDomain.trim().toLowerCase();
    if (!domain) return;
    const [cli, model] = suggestModel.split(MODEL_SEP);
    setInfo(null);
    // "all domains" must hit EVERY domain with its own request for `count`, not a
    // single call the engine spreads thin - that left some domains empty. Loop
    // per domain (the path that works for a single domain), one job each.
    const targets = domain === "all" ? allDomains.map((d) => d.toLowerCase()) : [domain];
    for (const t of targets) {
      void startQuestionSuggest({ vault: vaultPath, domain: t, count: suggestCount, cli, model });
    }
    setInfo(
      domain === "all"
        ? `Drafting ${suggestCount} question${suggestCount === 1 ? "" : "s"} for each of ${targets.length} domains in the background. You can navigate away; results appear here when ready.`
        : `Drafting ${suggestCount} question${suggestCount === 1 ? "" : "s"} for ${titleCase(domain)} in the background. You can navigate away; results appear here when ready.`,
    );
    setSuggestOpen(false);
  }

  const openEditor = (q: BenchQuestion | "new") => {
    setEditing(q);
    setDraft(q === "new" ? blank : { ...q });
  };

  async function save() {
    // K4 (Monday feedback): a NEW question can target multiple domains at once
    // (comma-separated, no dropdown/checkboxes) - saved once per domain. Editing
    // an existing question keeps a single domain.
    const domains = draft.domain.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (domains.length === 0 || !draft.prompt.trim()) return;
    const targets = editing === "new" ? domains : [domains[0]];
    setSaving(true);
    try {
      for (const dom of targets) {
        await invoke("benchmark_save_question", {
          vault: vaultPath,
          q: {
            id: editing === "new" ? null : (draft.id || null),
            domain: dom,
            prompt: draft.prompt,
            context: draft.context,
            notes: draft.notes,
            council: draft.council,
            expected_decision: draft.expected_decision,
            expected_verdict_keywords: draft.expected_verdict_keywords,
          },
        });
      }
      setEditing(null);
      onChanged();
    } finally {
      setSaving(false);
    }
  }
  async function remove(q: BenchQuestion) {
    const ok = await tauriConfirm(`Delete benchmark question "${q.id}"?`, { title: "Delete question", kind: "warning" });
    if (!ok) return;
    await invoke("benchmark_delete_question", { path: q.path });
    if (editing !== "new" && editing && editing.id === q.id) setEditing(null);
    onChanged();
  }

  if (editing) {
    return (
      <div className="w-full px-8 py-5">
        <BenchCrumbs
          items={[
            { label: "Arena" },
            { label: "Questions", onClick: () => setEditing(null) },
            { label: editing === "new" ? "New question" : draft.id },
          ]}
        />
        <div className="max-w-3xl space-y-4">
        <h2 className="font-display text-xl font-bold tracking-tight">{editing === "new" ? "New question" : draft.id}</h2>
        <Field label={editing === "new" ? "Domain(s): comma-separated to add to several at once" : "Domain"}>
          <input value={draft.domain} onChange={(e) => setDraft({ ...draft, domain: e.target.value })} list="bench-domains" placeholder={editing === "new" ? "wealth, health, career" : "wealth"} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <datalist id="bench-domains">{allDomains.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field label="Prompt: the question as you'd ask it">
          <textarea value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Context: facts the model needs (numbers, dates)">
          <textarea value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Expected decision: your real ground-truth answer">
          <input value={draft.expected_decision} onChange={(e) => setDraft({ ...draft, expected_decision: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Expected keywords: comma-separated, for the mechanical floor">
          <input
            value={draft.expected_verdict_keywords.join(", ")}
            onChange={(e) => setDraft({ ...draft, expected_verdict_keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="liquidity, 6 month floor, diversify"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Notes: what you actually decided, and why">
          <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={draft.council} onChange={(e) => setDraft({ ...draft, council: e.target.checked })} />
          Run via council (multi-model panel) by default
        </label>
        <div className="flex items-center gap-2 pt-2">
          <button onClick={save} disabled={saving || !draft.domain.trim() || !draft.prompt.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
          {editing !== "new" && (
            <button onClick={() => remove(draft)} className="inline-flex items-center gap-1.5 rounded-lg border border-err/40 px-3 py-2 text-sm text-err hover:bg-err/10">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
        </div>
      </div>
    );
  }

  // The Questions title + breadcrumb now live in the Arena page header.
  return (
    <div className="w-full px-8 pb-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary">
          <option value="all">all domains</option>
          {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={importQuestions} title="Import a prevail.bench/v1 JSON file (existing ids are skipped)" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent">
          <Download className="h-3 w-3" /> Import
        </button>
        <button onClick={exportQuestions} disabled={questions.length === 0} title="Export every question as one portable JSON file" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-40">
          <Upload className="h-3 w-3" /> Export
        </button>
        <button onClick={() => { setSuggestOpen((v) => !v); if (!suggestDomain && filter !== "all") setSuggestDomain(filter); }} title="AI-draft questions from a domain's recorded context" className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] ${suggestOpen ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-secondary hover:border-accent-border hover:text-accent"}`}>
          <Sparkles className="h-3 w-3" /> Suggest with AI
        </button>
        <button onClick={() => openEditor("new")} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] text-background hover:bg-accent-hover">
          <Plus className="h-3 w-3" /> New question
        </button>
      </div>
      {suggestOpen && (
        <div className="mb-4 rounded-xl border border-accent-border bg-accent-soft/25 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-text-primary">Draft questions with AI</span>
          </div>
          {/* Labeled controls, not a cramped row of bare selects. */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">Domain</span>
              <select value={suggestDomain} onChange={(e) => setSuggestDomain(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-text-secondary focus:border-accent-border focus:outline-none">
                <option value="">pick a domain…</option>
                <option value="all">All domains</option>
                {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">How many{suggestDomain === "all" ? " per domain" : ""}</span>
              <select value={suggestCount} onChange={(e) => setSuggestCount(Number(e.target.value))} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-text-secondary focus:border-accent-border focus:outline-none">
                {[1, 2, 3, 5, 8].map((n) => <option key={n} value={n}>{n} question{n === 1 ? "" : "s"}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">Drafting model</span>
              <select value={suggestModel} onChange={(e) => setSuggestModel(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-text-secondary focus:border-accent-border focus:outline-none">
                {Object.entries(MODELS)
                  .filter(([cli]) => !isBunkerOn() || isLocalCli(cli))
                  .flatMap(([cli, models]) =>
                    models.map((m) => (
                      <option key={`${cli}${MODEL_SEP}${m.id}`} value={`${cli}${MODEL_SEP}${m.id}`}>{titleCase(cli)} · {m.label}</option>
                    )),
                  )}
              </select>
            </label>
            <button onClick={suggestWithAi} disabled={suggesting || !suggestDomain} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
              {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {suggesting ? "Drafting…" : "Draft"}
            </button>
          </div>
          <p className="mt-3 text-xs text-text-muted">
            Reads each domain's state, goals, and decisions (fresh domains use goals/config). Every domain you target gets the full count; drafts are marked for your review before they affect scores.
          </p>
        </div>
      )}
      {info && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/50 px-3 py-2 text-xs text-text-primary">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" /> {info}
        </div>
      )}
      {/* Background suggest jobs: surface running + finished state from the
          module-scope registry, so it's visible on return even after remount. */}
      {runningJobs.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/30 px-3 py-2 text-xs text-text-secondary">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
          Drafting in the background: {runningJobs.map((j) => titleCase(j.domain)).join(", ")}. You can leave this page; results appear here when ready.
        </div>
      )}
      {qJobs
        .filter((j) => j.vault === vaultPath && j.status === "error")
        .map((j) => (
          <div key={j.id} className="mb-4 flex items-center gap-2 rounded-lg border border-warn/40 bg-surface px-3 py-2 text-xs text-text-secondary">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />
            Couldn't draft {titleCase(j.domain)}: {j.error}. Fix that, then re-run.
          </div>
        ))}
      {(() => {
        const doneJobs = qJobs.filter((j) => j.vault === vaultPath && j.status === "done" && (j.added ?? 0) > 0);
        if (doneJobs.length === 0) return null;
        return (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-ok/40 bg-surface px-3 py-2 text-xs text-text-secondary">
            <Check className="h-3.5 w-3.5 shrink-0 text-ok" />
            Drafted {doneJobs.map((j) => `${j.added} for ${titleCase(j.domain)}`).join(", ")}. Review the ground truth before trusting scores.
          </div>
        );
      })()}
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          No questions{filter !== "all" ? ` in ${titleCase(filter)}` : ""} yet. Hit <span className="text-accent">New question</span>, <span className="text-accent">Suggest with AI</span>, or <span className="text-accent">Import</span> to add some.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          {shown.map((q) => (
            <div key={q.id} className="flex w-full items-start gap-3 border-b border-border-subtle px-4 py-3 text-left last:border-0 hover:bg-surface-warm">
              <button onClick={() => openEditor(q)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                <span className="mt-0.5 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{q.domain}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {q.source === "ai" && (
                      <span className="shrink-0 rounded-full border border-accent-border bg-accent-soft px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-accent">Draft · review</span>
                    )}
                    <span className="truncate text-sm text-text-primary">{q.prompt || <span className="text-text-muted">(empty prompt)</span>}</span>
                  </div>
                  {q.expected_decision && <div className="mt-0.5 truncate text-[11px] text-ok">→ {q.expected_decision}</div>}
                  <div className="mt-0.5 font-mono text-[9px] text-text-muted">
                    {q.source === "ai" ? "AI-drafted - click to review and confirm the ground truth" : "written by you"}{q.created ? ` · added ${q.created}` : ""}{q.edited ? ` · edited ${q.edited} (prior version kept)` : ""}
                  </div>
                </div>
                {/* K3 (Monday feedback): tooltip on the per-question icon. */}
                {q.council && <span title="Council question: asked to the whole panel" className="mt-0.5 shrink-0"><Scale className="h-3.5 w-3.5 text-text-muted" /></span>}
              </button>
              <button
                onClick={() => void setArchived(q, true)}
                title="Archive: kept for past runs, excluded from new ones"
                className="mt-0.5 shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
              >
                <Archive className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {archivedShown.length > 0 && (
        <details className="mt-3 rounded-xl border border-border-subtle bg-surface px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            Archived · {archivedShown.length}: kept so past benchmark runs stay interpretable
          </summary>
          <div className="mt-2 flex flex-col">
            {archivedShown.map((q) => (
              <div key={q.id} className="flex items-start gap-3 border-b border-border-subtle px-1 py-2 last:border-0">
                <span className="mt-0.5 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{q.domain}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text-muted">{q.prompt}</div>
                  <div className="mt-0.5 font-mono text-[9px] text-text-muted">
                    {q.source === "ai" ? "AI-suggested" : "written by you"}{q.created ? ` · added ${q.created}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => void setArchived(q, false)}
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                >
                  Restore
                </button>
                <button
                  onClick={async () => { try { await invoke("benchmark_delete_question", { path: q.path }); onChanged(); } catch (e) { setInfo(`Delete failed: ${e}`); } }}
                  title="Delete permanently (past runs lose this question's text)"
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-warn hover:text-warn"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}


// ── AI preset suggestion: a module-scope job so a curation run survives leaving
// the Presets tab (or the Arena) and coming back. The invoke keeps running even
// if the component unmounts; the result lands here and any mounted view syncs
// via the event. Never blocks the UI thread.
type PresetSuggestState = { busy: boolean; presets: CanonicalPreset[] | null; error: string | null };
let presetSuggest: PresetSuggestState = { busy: false, presets: null, error: null };
const PRESET_SUGGEST_EVENT = "prevail:preset-suggest";
function setPresetSuggest(next: Partial<PresetSuggestState>) {
  presetSuggest = { ...presetSuggest, ...next };
  window.dispatchEvent(new Event(PRESET_SUGGEST_EVENT));
}
function usePresetSuggest(): PresetSuggestState {
  const [s, setS] = useState(presetSuggest);
  useEffect(() => {
    const sync = () => setS(presetSuggest);
    window.addEventListener(PRESET_SUGGEST_EVENT, sync);
    return () => window.removeEventListener(PRESET_SUGGEST_EVENT, sync);
  }, []);
  return s;
}
// Fire-and-forget curation. Guarded so a second click while busy is a no-op.
// `known` grounds the returned keys against the live model universe.
async function startPresetSuggest(modelsJson: string, known: Set<string>, provider: string, model: string) {
  if (presetSuggest.busy) return;
  setPresetSuggest({ busy: true, error: null });
  try {
    const res = await invoke<{ ok: boolean; presets?: CanonicalPreset[]; error?: string }>(
      "engine_bench_preset_suggest",
      { modelsJson, provider, model },
    );
    if (res?.ok) {
      const cleaned = (res.presets ?? [])
        .map((p) => ({ ...p, models: (p.models ?? []).filter((k) => known.has(k)) }))
        .filter((p) => p.models.length >= 2);
      setPresetSuggest({ busy: false, presets: cleaned, error: cleaned.length ? null : "The model did not return any usable presets. Try again." });
    } else {
      setPresetSuggest({ busy: false, error: res?.error || "Could not suggest presets right now." });
    }
  } catch (e) {
    setPresetSuggest({ busy: false, error: String(e) });
  }
}

// ─────────────────────────────────────────────────────────────────────
// SETTINGS PANEL - vault, theme, defaults, about

export function BenchRunConfig({
  mode, setMode, selModels, toggleModel, allDomains, scope, toggleScope, scoped,
  applyModels, applyScope, onRunSuite,
  questionCounts, questionCount, running, jobs, log, logRef, activeBatch, onRun, onViewResults, onReset, onCancel, onCrumbHome,
}: {
  mode: "single" | "council";
  setMode: (m: "single" | "council") => void;
  selModels: Set<string>;
  toggleModel: (cli: string, model: string) => void;
  allDomains: string[];
  scope: Set<string>;
  toggleScope: (d: string) => void;
  // True when the Arena is opened from inside a domain: the run is already
  // scoped to that domain, so the Domains picker is hidden (it only shows in
  // the global/Settings Arena where you choose which domains to benchmark).
  scoped: boolean;
  // Saved-preset plumbing: apply a bundle's models / a suite's domains to the
  // live selection, and run a suite as a unit.
  applyModels: (keys: string[]) => void;
  applyScope: (domains: string[]) => void;
  onRunSuite: (s: { mode: "single" | "council"; models: string[]; domains: string[] }) => void;
  questionCounts: Record<string, number>;
  questionCount: number;
  running: boolean;
  jobs: BenchJob[];
  log: string;
  logRef: React.RefObject<HTMLPreElement | null>;
  activeBatch?: { label: string; scope: string; domains: string[] } | null;
  onRun: () => void;
  onViewResults: () => void;
  onCancel?: () => void;
  onReset: () => void;
  onCrumbHome?: () => void;
}) {
  // Council is retired from this page: the run is always the multi-model
  // head-to-head, so the selection count is simply the chosen models. The
  // `mode`/`setMode` props are still wired (saved-suite loading + executeRun keep
  // the mode type), we just never surface the Council branch in this UI.
  const selCount = selModels.size;
  // Collapsible provider groups - ALL collapsed by default so the page never
  // opens as a wall of models. Each provider row still shows its selected
  // count, so what's on the panel stays visible while collapsed.
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(() =>
    new Set(BENCH_CLI_OPTIONS.map((c) => c.id)),
  );
  // Per-provider search over the full catalog (OpenRouter is 300+ models), so any
  // model is runnable without pinning. Empty = show the curated defaults.
  const [providerSearch, setProviderSearch] = useState<Record<string, string>>({});

  // Up-front runtime validity: which providers will actually run BEFORE the
  // user starts a test. detect_clis is the binary probe (installed?); the live
  // verify map is the end-to-end check (auth + model reachable). autoVerifyClis
  // kicks off a real verification for every detected runtime once loaded.
  const [clis, setClis] = useState<CliInfo[]>([]);
  const verify = useCliVerifyLive();
  useEffect(() => {
    let alive = true;
    void invoke<CliInfo[]>("detect_clis")
      .then((list) => { if (alive) { setClis(list); autoVerifyClis(list); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  // Per-provider runnability. The established rule (settings5.tsx): a runtime is
  // runnable when detected AND its verify did not fail. Not detected OR verify
  // failed => not runnable. We surface four visible states so the header can
  // show ok / checking / failed / not-installed honestly.
  type ProviderStatus = "ok" | "verifying" | "failed" | "unavailable";
  const providerStatus = (id: string): { status: ProviderStatus; runnable: boolean; reason?: string } => {
    const ci = clis.find((c) => c.id === id);
    const v = verify.get(id);
    if (!ci || !ci.available) {
      return { status: "unavailable", runnable: false, reason: ci?.error || undefined };
    }
    if (v?.status === "failed") {
      return { status: "failed", runnable: false, reason: v.error || undefined };
    }
    // Detected and not failed => runnable. Still "verifying" until the live
    // end-to-end check reports ok (no verify yet is treated as in-progress).
    if (v?.status === "ok") return { status: "ok", runnable: true };
    return { status: "verifying", runnable: true };
  };

  const toggleProvider = (id: string) =>
    setCollapsedProviders((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Which job card is expanded to its question-by-question detail.
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  // Domain scope list expanded by default (still collapsible), so the domains are
  // visible without a click.
  const [domScopeOpen, setDomScopeOpen] = useState(true);

  // ── Saved Benchmark Suites (models + domains + mode), the one reusable unit ──
  const suites = useSuites();
  const [suiteName, setSuiteName] = useState("");
  const [savingSuite, setSavingSuite] = useState(false);
  const [scheduledSuiteId, setScheduledSuiteId] = useState<string | null>(null);
  const selModelArr = Array.from(selModels);

  // ── The AVAILABLE MODEL UNIVERSE (shared by canonical + AI presets) ──────────
  // Enumerate every runnable model the Arena knows about right now, shaped for
  // the preset engines: cli::model key, human label, provider, local-vs-cloud,
  // and whether the runtime verified. We list each provider's CURATED set (the
  // flagship-first defaults), not the full 300+ catalog, so a preset draws from
  // sensible, nameable models. Under Bunker Mode only local providers appear, so
  // both canonical and AI presets stay offline-valid. This resolves live off
  // `clis` + `verify`, so the library re-derives as runtimes come and go.
  const availableModels = useMemo<AvailablePresetModel[]>(() => {
    const rows: AvailablePresetModel[] = [];
    for (const c of BENCH_CLI_OPTIONS) {
      if (isBunkerOn() && !isLocalCli(c.id)) continue;
      const ps = providerStatus(c.id);
      // Skip providers that are not installed at all: a preset over a model that
      // cannot possibly run is noise. Verifying / ok both count as present.
      if (ps.status === "unavailable") continue;
      const curated = curatedFor(c.id);
      const models = (curated.length ? curated : modelsFor(c.id)).slice(0, 8);
      for (const m of models) {
        rows.push({
          key: `${c.id}${MODEL_SEP}${m.id}`,
          provider: c.id,
          local: isLocalCli(c.id),
          validated: ps.status === "ok",
        });
      }
    }
    return rows;
    // providerStatus closes over clis + verify; re-run when either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clis, verify]);

  // A richer per-model view the AI prompt uses (adds the human label + a coarse
  // tier hint drawn from curated ordering: the first curated model per provider
  // is treated as that provider's flagship). Kept separate from the canonical
  // shape so canonicalPresets stays lean.
  const availableModelsForAi = useMemo(() => {
    const flagshipByProvider = new Set<string>();
    return availableModels.map((m) => {
      const [cli, modelId] = m.key.split(MODEL_SEP);
      const isFirstOfProvider = !flagshipByProvider.has(cli!);
      if (isFirstOfProvider) flagshipByProvider.add(cli!);
      return {
        key: m.key,
        label: modelLabel(cli!, modelId!) || modelId,
        provider: m.provider,
        validated: m.validated,
        local: m.local,
        tier: isFirstOfProvider ? "flagship" : undefined,
      };
    });
  }, [availableModels]);

  // Canonical local presets — resolve live, always work offline, AI-free.
  const canonPresets = useMemo(() => canonicalPresets(availableModels), [availableModels]);

  // ── AI presets — an AI-maintained library over the live model list. The run
  // itself lives in a module-scope job (above) so it keeps going and its result
  // survives if you leave the Presets tab / Arena while it thinks. ─────────────
  const { busy: aiBusy, presets: aiPresetsRaw, error: aiErr } = usePresetSuggest();
  const suggestAiPresets = useCallback(() => {
    if (availableModelsForAi.length === 0) { setPresetSuggest({ error: "No runnable models to build presets from. Install or authorize a runtime first." }); return; }
    const provider = getPref(PREF.memoryProvider, "claude");
    const model = getPref(PREF.distillModel, "claude-haiku-4-5");
    void startPresetSuggest(JSON.stringify(availableModelsForAi), new Set(availableModels.map((m) => m.key)), provider, model);
  }, [availableModels, availableModelsForAi]);
  // Dedupe the AI suggestions so nothing repeats: drop any AI preset that matches
  // a canonical one (by name or exact model set) or an earlier AI one. Keeps the
  // library thorough without showing the same combination twice.
  const aiPresets = useMemo(() => {
    if (!aiPresetsRaw) return null;
    const sig = (models: string[]) => [...models].map((m) => m.toLowerCase()).sort().join("|");
    const takenSigs = new Set(canonPresets.map((c) => sig(c.models)));
    const takenNames = new Set(canonPresets.map((c) => c.name.trim().toLowerCase()));
    const out: CanonicalPreset[] = [];
    for (const p of aiPresetsRaw) {
      const s = sig(p.models);
      const n = p.name.trim().toLowerCase();
      if (takenSigs.has(s) || takenNames.has(n)) continue;
      takenSigs.add(s); takenNames.add(n);
      out.push(p);
    }
    return out;
  }, [aiPresetsRaw, canonPresets]);

  // Load a suite into the editor (apply its selection) WITHOUT running - so the
  // user can tweak then run or re-save. Distinct from the Run button.
  const loadSuite = (s: BenchSuite) => { setMode(s.mode); applyModels(s.models); applyScope(s.domains); };
  const commitSuite = () => {
    // A Preset is a named group of MODELS (reusable across Arena runs),
    // so we save models only - the domain scope is chosen per-run.
    if (saveSuite({ name: suiteName, mode, models: selModelArr, domains: [] })) {
      setSuiteName(""); setSavingSuite(false);
    }
  };
  // ── Actions shared by canonical + AI preset cards ────────────────────────────
  // A preset here is any { name, rationale, models } (canonical or AI): Apply
  // drops its models onto the live Run selection; Run fires it as a single-mode
  // benchmark over all domains; Save persists it into the saved-suites library so
  // it becomes a durable user snapshot alongside the manual ones.
  const applyPreset = (p: CanonicalPreset) => { setMode("single"); applyModels(p.models); };
  const runPreset = (p: CanonicalPreset) => onRunSuite({ mode: "single", models: p.models, domains: [] });
  const savePreset = (p: CanonicalPreset) => saveSuite({ name: p.name, mode: "single", models: p.models, domains: [] });

  // Put a suite on the existing background scheduler by writing the "custom" scope
  // it already understands (models + domains). No new scheduler needed.
  const scheduleSuite = (s: BenchSuite) => {
    lsSet(BENCH_SCHED.scopeMode, "custom");
    lsSet(BENCH_SCHED.scopeModels, s.models.join(","));
    lsSet(BENCH_SCHED.scopeDomains, s.domains.join(","));
    lsSet(BENCH_SCHED.enabled, "1");
    if (!lsGet(BENCH_SCHED.freq, "")) lsSet(BENCH_SCHED.freq, "weekly");
    setScheduledSuiteId(s.id);
    // The sidebar / home schedule indicators sync on this event.
    window.dispatchEvent(new Event("prevail:bench-sched"));
  };
  const suiteScopeLabel = (s: BenchSuite) =>
    s.domains.length === 0 ? "all domains"
    : s.domains.length <= 2 ? s.domains.map(titleCase).join(", ")
    : `${s.domains.length} domains`;
  const schedFreq = benchFreqLabel(lsGet(BENCH_SCHED.freq, "weekly") || "weekly");
  // Reflect an already-scheduled suite across remounts: if the custom schedule's
  // models+domains match a saved suite, mark it scheduled.
  useEffect(() => {
    if (lsGet(BENCH_SCHED.enabled, "0") !== "1" || lsGet(BENCH_SCHED.scopeMode, "latest") !== "custom") { setScheduledSuiteId(null); return; }
    const m = lsGet(BENCH_SCHED.scopeModels, "").split(",").filter(Boolean).sort().join(",");
    const d = lsGet(BENCH_SCHED.scopeDomains, "").split(",").filter(Boolean).sort().join(",");
    const hit = suites.find((s) => [...s.models].sort().join(",") === m && [...s.domains].sort().join(",") === d);
    setScheduledSuiteId(hit ? hit.id : null);
  }, [suites]);

  // While a benchmark is in flight (or just finished with errors), the page
  // IS the progress: the config disappears and each model gets a live
  // question-by-question progress bar. No clutter, no guessing.
  if (running || jobs.length > 0) {
    const allDone = !running;
    const doneCount = jobs.filter((j) => j.status === "done").length;
    const errCount = jobs.filter((j) => j.status === "error").length;
    // Phase: once every model has answered (nothing queued/running), the batch
    // moves to the judge-scoring pass. The progress bar hits 100% at the END of
    // the answering phase, so without this it reads as "done" while scoring is
    // still underway.
    const answersDone = jobs.length > 0 && jobs.every((j) => j.status !== "queued" && j.status !== "running");
    const scoringPhase = running && answersDone;
    return (
      <div className="w-full space-y-4 px-8 py-5">
        <BenchCrumbs
          items={[
            { label: "Arena", onClick: onCrumbHome },
            { label: "Run", onClick: allDone ? onReset : undefined },
            { label: activeBatch?.label ?? (running ? "Running…" : "Finished") },
          ]}
          meta={`${jobs.length} model${jobs.length === 1 ? "" : "s"} · ${jobs[0]?.total ?? 0} questions each`}
        />
        {/* Progress card: one contained block with a clear status, a single quiet
            meta line, the answer-progress bar, and a distinct scoring phase so a
            full bar never reads as "done" while the judge is still scoring. */}
        <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-surface px-8 py-6 shadow-sm">
          <div className="flex items-center justify-center gap-2.5">
            {running
              ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" />
              : jobs.some((j) => j.status === "cancelled") ? <X className="h-5 w-5 shrink-0 text-text-muted" />
              : errCount > 0 ? <AlertTriangle className="h-5 w-5 shrink-0 text-warn" />
              : <Check className="h-5 w-5 shrink-0 text-ok" strokeWidth={3} />}
            <h2 className="font-display text-xl font-semibold tracking-tight text-text-primary">
              {scoringPhase ? "Scoring answers…"
                : running ? "Benchmarking…"
                : jobs.some((j) => j.status === "cancelled") ? "Run cancelled"
                : errCount > 0 ? "Finished with errors"
                : "Benchmark complete"}
            </h2>
          </div>
          <div className="mt-2 text-center font-mono text-[11px] text-text-muted">
            {(activeBatch?.domains?.length
              ? activeBatch.domains.slice(0, 3).map(titleCase).join(", ") + (activeBatch.domains.length > 3 ? ` +${activeBatch.domains.length - 3}` : "")
              : "All domains")}
            {" · "}{jobs.length} model{jobs.length === 1 ? "" : "s"}{" · "}{jobs[0]?.total ?? 0} q each{" · auto-scored"}
          </div>
          {(() => {
            const overallTotal = jobs.reduce((a, j) => a + j.total, 0);
            const overallDone = jobs.reduce((a, j) => a + (j.status === "done" || j.status === "scoring" ? j.total : j.done), 0);
            const pct = overallTotal > 0 ? Math.round((overallDone / overallTotal) * 100) : 0;
            return (
              <div className="mt-6">
                <div className="mb-1.5 flex items-baseline justify-between font-mono text-[11px]">
                  <span className="text-text-muted">{scoringPhase || allDone ? "answers" : "answering"}</span>
                  <span className="tabular-nums text-text-secondary">{overallDone}/{overallTotal} · <span className="font-semibold text-text-primary">{pct}%</span></span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-warm">
                  <div className={`h-full rounded-full transition-all duration-500 ${scoringPhase ? "bg-text-primary/70" : "bg-accent"}`} style={{ width: `${pct}%` }} />
                </div>
                {scoringPhase && (
                  <div className="mt-3 flex items-center justify-center gap-1.5 font-mono text-[11px] text-accent">
                    <Loader2 className="h-3 w-3 animate-spin" /> answers in · scoring with the judge, almost done
                  </div>
                )}
              </div>
            );
          })()}
          {running && onCancel && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={onCancel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-1.5 font-mono text-[11px] text-text-secondary transition-colors hover:border-err hover:text-err"
              >
                <X className="h-3.5 w-3.5" /> Cancel run
              </button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          {jobs.map((j) => {
            const pct = j.total > 0 ? Math.round((j.done / j.total) * 100) : 0;
            const expanded = expandedJob === j.key;
            return (
              <div key={j.key} className="overflow-hidden rounded-xl border border-border bg-surface">
                <button
                  onClick={() => setExpandedJob(expanded ? null : j.key)}
                  className="w-full px-4 py-3 text-left hover:bg-surface-warm/60"
                  title="Click for question-by-question detail"
                >
                  <div className="flex items-center gap-3">
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
                    {j.cli ? <ProviderMark vendor={j.cli} size={20} /> : <Scale className="h-5 w-5 text-accent" />}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{j.label}</span>
                    {j.status === "running" && j.qcur && (
                      <span className="hidden min-w-0 max-w-[220px] truncate font-mono text-[10px] text-text-muted md:inline">{j.qcur}…</span>
                    )}
                    <span className="font-mono text-[11px] tabular-nums text-text-muted">
                      {j.status === "queued" ? "queued" : `${j.done}/${j.total}`}
                    </span>
                    <span className={`w-16 text-right font-mono text-[10px] uppercase tracking-wider ${
                      j.status === "error" ? "text-err" : j.status === "cancelled" ? "text-text-muted" : j.status === "done" ? "text-ok" : "text-accent"
                    }`}>
                      {j.status === "error" ? "error" : j.status === "cancelled" ? "cancelled" : j.status === "done" ? "done" : j.status === "scoring" ? "scoring" : j.status === "running" ? `${pct}%` : "queued"}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-warm">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        j.status === "error" ? "bg-err/60" : j.status === "cancelled" ? "bg-surface-strong" : j.status === "scoring" || j.status === "done" ? "bg-ok" : "bg-accent"
                      } ${j.status === "scoring" ? "animate-pulse" : ""}`}
                      style={{ width: `${j.status === "done" || j.status === "scoring" ? 100 : pct}%` }}
                    />
                  </div>
                  {j.note && <div className="mt-1.5 font-mono text-[10px] text-err">{j.note}</div>}
                </button>
                {expanded && j.qids.length > 0 && (
                  <div className="max-h-64 overflow-y-auto border-t border-border-subtle bg-background/40 px-4 py-2">
                    {j.qids.map((q) => {
                      const info = j.qdone[q];
                      const isCur = !info && j.qcur === q;
                      const failed = info?.startsWith("✗");
                      return (
                        <div key={q} className="flex items-center gap-2.5 py-1">
                          <span className="w-4 shrink-0 text-center">
                            {info ? (
                              failed
                                ? <AlertTriangle className="h-3 w-3 text-err" />
                                : <Check className="h-3 w-3 text-ok" strokeWidth={3} />
                            ) : isCur ? (
                              <Loader2 className="h-3 w-3 animate-spin text-accent" />
                            ) : (
                              <Circle className="h-2.5 w-2.5 text-text-muted/40" />
                            )}
                          </span>
                          <span className={`min-w-0 flex-1 truncate font-mono text-[11px] ${info ? "text-text-primary" : isCur ? "text-accent" : "text-text-muted/60"}`}>
                            {q}
                          </span>
                          {info && !failed && <span className="max-w-[200px] truncate font-mono text-[9px] text-text-muted">{info}</span>}
                          {failed && <span className="max-w-[260px] truncate font-mono text-[9px] text-err" title={info}>{info}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {allDone && (
          <div className="flex items-center justify-center gap-2 pt-1">
            <button onClick={onViewResults} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover">
              <TrendingUp className="h-4 w-4" /> View results
            </button>
            <button onClick={onReset} className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-warm">
              New run
            </button>
          </div>
        )}
        {allDone && doneCount > 0 && errCount > 0 && (
          <p className="text-center font-mono text-[10px] text-text-muted">Failed jobs can be rerun individually from a new run.</p>
        )}
        {log && (
          <details className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-text-muted">engine log</summary>
            <pre ref={logRef} className="mt-2 max-h-48 overflow-y-auto font-mono text-[10px] leading-relaxed text-text-muted">{log}</pre>
          </details>
        )}
      </div>
    );
  }

  // The Run title + breadcrumb now live in the Arena page header. The primary
  // "Run" action moved into the final "Review & Run" step of the wizard below.
  // Council is retired from this page, so the selection is always the multi-model
  // head-to-head list.
  const selModelLabels = Array.from(selModels).map((k) => { const [cli, model] = k.split(MODEL_SEP); const ml = MODELS[cli]?.find((m) => m.id === model)?.label ?? model; return `${titleCase(cli)} · ${ml}`; });

  // ── The Run page as a left-to-right STEP WIZARD ────────────────────────────
  // Instead of a wall of stacked collapsibles, the run is a 3-step flow you move
  // through: Models -> Domains -> Review & Run. A Presets tab sits alongside as a
  // place to set up / apply reusable model groups (also reachable inline from the
  // Models step). Each step reports "done" once its selection is valid, and the
  // stepper draws a progress bar across the completed steps so the user always
  // knows how far along they are. When the Arena is opened scoped to one domain
  // the Domains step is dropped exactly as the old picker was hidden.
  type StepId = "models" | "domains" | "review" | "presets";
  const domainsStepShown = !scoped;
  const modelsDone = selModels.size > 0;
  const domainsDone = true; // empty scope = all domains, always satisfiable
  const reviewReady = modelsDone && questionCount > 0;
  // The ordered flow steps (Presets is a side tab, not part of the linear flow).
  const flowSteps: { id: StepId; label: string; icon: LucideIcon; done: boolean; n: number }[] = [
    { id: "models", label: "Models", icon: Layers, done: modelsDone, n: 1 },
    ...(domainsStepShown ? [{ id: "domains" as StepId, label: "Domains", icon: Target, done: domainsDone, n: 2 }] : []),
    { id: "review", label: "Review & Run", icon: Play, done: reviewReady, n: domainsStepShown ? 3 : 2 },
  ];
  const [activeStep, setActiveStep] = useState<StepId>("models");
  // Keep a live step even if scoped drops the Domains tab out from under us.
  const activeIsValid = activeStep === "presets" || flowSteps.some((s) => s.id === activeStep);
  const effectiveStep: StepId = activeIsValid ? activeStep : "models";
  const flowIndex = flowSteps.findIndex((s) => s.id === effectiveStep);
  const nextStep = flowIndex >= 0 && flowIndex < flowSteps.length - 1 ? flowSteps[flowIndex + 1] : null;
  // Progress bar: fraction of the linear flow steps that are "done".
  const doneCount = flowSteps.filter((s) => s.done).length;
  const progressPct = Math.round((doneCount / flowSteps.length) * 100);
  const progressNote = !modelsDone
    ? "Start by picking the models to compare."
    : domainsStepShown && effectiveStep === "models"
      ? "Models selected. Next: choose the domains."
      : !reviewReady
        ? (questionCount === 0 ? "No questions in scope yet. Add some in the Questions tab." : "Almost there. Review and run.")
        : "Ready to run.";

  // A compact preset-apply strip reused inside the Models step so a canonical /
  // AI / saved preset can fill the selection without leaving the step.
  return (
    <div className="w-full px-8 pb-6">
      {/* STEPPER: clickable tabs left-to-right with a progress bar. Steps read as
          "done" once valid; the active step's detail renders below. */}
      <div className="mb-6 rounded-2xl border border-border bg-surface px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          {flowSteps.map((s, i) => {
            const active = s.id === effectiveStep;
            const Icon = s.done ? Check : s.icon;
            return (
              <div key={s.id} className="flex min-w-0 flex-1 items-center gap-1.5">
                <button
                  onClick={() => setActiveStep(s.id)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent-soft"
                      : "border-border-subtle bg-surface hover:border-accent-border hover:bg-surface-warm"
                  }`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    s.done ? "bg-ok text-background" : active ? "bg-accent text-background" : "border border-border text-text-muted"
                  }`}>
                    {s.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : s.n}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={`truncate text-[13px] font-semibold ${active ? "text-accent" : "text-text-primary"}`}>{s.label}</span>
                    <span className="truncate font-mono text-[9px] uppercase tracking-wider text-text-muted">
                      {s.id === "models" ? `${selModels.size} selected` : s.id === "domains" ? (scope.size === 0 ? "all domains" : `${scope.size} chosen`) : `${questionCount} question${questionCount === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <Icon className={`ml-auto hidden h-3.5 w-3.5 shrink-0 sm:block ${active ? "text-accent" : "text-text-muted"}`} />
                </button>
                {i < flowSteps.length - 1 && (
                  <ChevronRight className={`h-4 w-4 shrink-0 ${flowSteps[i].done ? "text-ok" : "text-text-muted/50"}`} />
                )}
              </div>
            );
          })}
          {/* Presets: a side tab, always reachable, for setting up / applying presets. */}
          <div className="ml-1 flex shrink-0 items-center gap-1.5 border-l border-border-subtle pl-2">
            <button
              onClick={() => setActiveStep("presets")}
              title="Set up and apply reusable model presets"
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-semibold transition-colors ${
                effectiveStep === "presets"
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border-subtle bg-surface text-text-secondary hover:border-accent-border hover:text-accent"
              }`}
            >
              <Bookmark className="h-3.5 w-3.5" /> Presets
            </button>
          </div>
        </div>
        {/* Progress bar + plain-language status. */}
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between font-mono text-[10px]">
            <span className="text-text-secondary">{progressNote}</span>
            <span className="tabular-nums text-text-muted">{doneCount}/{flowSteps.length} steps</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-warm">
            <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </div>

      {/* ── STEP DETAIL renders below the stepper ── */}

      {/* STEP 1 · MODELS - the provider groups + per-provider validity + search,
          with an inline shortcut into the Presets tab. */}
      {effectiveStep === "models" && (
        <div className="space-y-5">
          {/* Inline preset access: apply a preset here, or jump to the Presets tab. */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface-warm/50 px-4 py-2.5">
            <Bookmark className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="text-[12px] text-text-secondary">Select models directly below, or apply a preset to fill the selection.</span>
            <button onClick={() => setActiveStep("presets")} className="ml-auto inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1 font-mono text-[11px] text-accent hover:bg-accent-soft/70">
              Browse presets <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          {isBunkerOn() && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface-warm/60 px-3 py-2">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="font-mono text-[11px] text-text-secondary">Bunker Mode is on: only local models (Ollama, LM Studio, oMLX) can run.</span>
            </div>
          )}
          <div className="space-y-3">
            {BENCH_CLI_OPTIONS.map((c) => {
              const models = modelsFor(c.id);
              const selectedHere = models.filter((m) => selModels.has(`${c.id}${MODEL_SEP}${m.id}`)).length;
              const collapsed = collapsedProviders.has(c.id);
              const bunkerBlocked = isBunkerOn() && !isLocalCli(c.id);
              const ps = providerStatus(c.id);
              const psTitle =
                ps.status === "ok" ? `${c.label} is ready to run`
                : ps.status === "verifying" ? `Checking ${c.label} runtime…`
                : ps.status === "failed" ? `${c.label} failed verification${ps.reason ? `: ${ps.reason}` : ""}`
                : `${c.label} is not installed${ps.reason ? `: ${ps.reason}` : ""}`;
              return (
                <div key={c.id}>
                  <button
                    onClick={() => toggleProvider(c.id)}
                    className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-accent-border hover:bg-surface-warm"
                  >
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${collapsed ? "" : "rotate-90"}`} strokeWidth={2.5} />
                    <ProviderMark vendor={c.id} size={16} />
                    <span className="text-[13px] font-medium text-text-primary">{c.label}</span>
                    <span className="shrink-0" title={psTitle} aria-label={psTitle}>
                      {ps.status === "ok" ? <Check className="h-3.5 w-3.5 text-ok" strokeWidth={2.5} />
                        : ps.status === "verifying" ? <Loader2 className="h-3 w-3 animate-spin text-text-muted" />
                        : ps.status === "failed" ? <AlertTriangle className="h-3.5 w-3.5 text-err" />
                        : <AlertTriangle className="h-3.5 w-3.5 text-warn" />}
                    </span>
                    {selectedHere > 0 && (
                      <span className="rounded-full bg-accent px-1.5 py-px font-mono text-[9px] font-semibold text-background">{selectedHere}</span>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-text-muted">{models.length}</span>
                  </button>
                  {!collapsed && (() => {
                    const q = (providerSearch[c.id] ?? "").trim().toLowerCase();
                    const curated = curatedFor(c.id);
                    const searchable = models.length > curated.length; // a live catalog beyond the defaults
                    const shown = q
                      ? models.filter((m) => `${m.id} ${m.label ?? ""}`.toLowerCase().includes(q)).slice(0, 60)
                      : (searchable ? curated : models);
                    return (
                    <div className="ml-[7px] grid grid-cols-1 gap-1.5 border-l border-border-subtle/70 pl-4">
                      {searchable && (
                        <input
                          value={providerSearch[c.id] ?? ""}
                          onChange={(e) => setProviderSearch((s) => ({ ...s, [c.id]: e.target.value }))}
                          placeholder={`Search all ${models.length} ${c.label} models…`}
                          className="mb-0.5 w-full rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] focus:border-accent-border focus:outline-none"
                        />
                      )}
                      {shown.length === 0 && <div className="px-1 py-1 font-mono text-[11px] text-text-muted">No models match "{q}".</div>}
                      {shown.map((m) => {
                        const on = selModels.has(`${c.id}${MODEL_SEP}${m.id}`);
                        // Validity here reflects the PROVIDER runtime (installed +
                        // authorized + verified), which is what's checkable up front.
                        // Not-runnable rows are de-emphasized but still selectable, so
                        // the user can queue them - they just won't run as-is.
                        const notRunnable = !ps.runnable;
                        const runTitle = ps.status === "unavailable"
                          ? "Runtime not available - install/authorize it in Settings > Runtimes"
                          : ps.status === "failed"
                            ? `Runtime failed verification${ps.reason ? `: ${ps.reason}` : ""} - re-check in Settings > Runtimes`
                            : undefined;
                        return (
                          <button
                            key={m.id}
                            onClick={() => toggleModel(c.id, m.id)}
                            disabled={bunkerBlocked}
                            title={bunkerBlocked ? "Blocked by Bunker Mode" : (runTitle ?? m.blurb)}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-accent bg-accent-soft" : "border-border-subtle bg-surface hover:border-accent-border"} ${notRunnable && !on ? "opacity-55" : ""}`}
                          >
                            <span className={`min-w-0 flex-1 truncate font-mono text-xs ${on ? "font-semibold text-accent" : "text-text-primary"}`}>{m.label}</span>
                            {/* Runtime validity dot - distinct from the selection circle. */}
                            {ps.runnable
                              ? <Check className="h-2.5 w-2.5 shrink-0 text-ok" strokeWidth={3} aria-hidden />
                              : <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ps.status === "failed" ? "bg-err" : "bg-warn"}`} title={runTitle} aria-label={runTitle} />}
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${on ? "bg-accent text-background" : "border border-border"}`}>
                              {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                            </span>
                          </button>
                        );
                      })}
                      {!q && searchable && (
                        <div className="px-1 pt-0.5 font-mono text-[10px] text-text-muted">+{models.length - shown.length} more · search to run any model</div>
                      )}
                    </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
          {/* Advance affordance: once a model is selected, move right. */}
          {nextStep && (
            <div className="flex items-center justify-between border-t border-border-subtle pt-4">
              <span className="font-mono text-[11px] text-text-muted">{selModels.size} model{selModels.size === 1 ? "" : "s"} selected</span>
              <button
                onClick={() => setActiveStep(nextStep.id)}
                disabled={!modelsDone}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                Next: {nextStep.label} <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 2 · DOMAINS - which domains' questions this run covers. Hidden when
          the Arena is opened scoped to a single domain. Sorted by question count;
          empty ones sit behind a disclosure so 20+ domains don't become noise. */}
      {effectiveStep === "domains" && domainsStepShown && (
        <div className="space-y-5">
        {allDomains.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-xs leading-relaxed text-text-muted">
            No domains to scope yet. The Arena runs your saved questions across domains, so a domain shows up here once it has questions. Add questions in the <span className="text-accent">Questions</span> tab (write them, or AI-draft from your data). By default a run uses <span className="text-text-secondary">All domains</span>, so once you have questions you can run without choosing anything here.
          </div>
        ) : (() => {
          const withQ = allDomains.filter((d) => (questionCounts[d] ?? 0) > 0).sort((a, b) => (questionCounts[b] ?? 0) - (questionCounts[a] ?? 0));
          const withoutQ = allDomains.filter((d) => (questionCounts[d] ?? 0) === 0);
          const pill = (d: string) => {
            const on = scope.has(d);
            const Icon = domainIcon(d);
            const count = questionCounts[d] ?? 0;
            return (
              <button
                key={d}
                onClick={() => toggleScope(d)}
                title={count === 0 ? "No questions yet: add or AI-suggest some in Questions" : `${count} question${count === 1 ? "" : "s"}`}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-all ${
                  on
                    ? "border-accent bg-accent font-semibold text-background shadow-sm"
                    : count === 0
                      ? "border-border-subtle bg-background text-text-muted/60 hover:border-accent-border/60 hover:bg-accent-soft/50 hover:text-accent"
                      : "border-border bg-background text-text-secondary hover:-translate-y-0.5 hover:border-accent-border hover:bg-accent-soft hover:text-accent hover:shadow-sm"
                }`}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {titleCase(d)}
                {count > 0 && (
                  <span className={`ml-0.5 rounded-full px-1 text-[9px] ${on ? "bg-background/25 text-background" : "bg-surface-warm text-text-muted"}`}>{count}</span>
                )}
              </button>
            );
          };
          const selectedLabel = scope.size === 0
            ? "All domains"
            : (withQ.filter((d) => scope.has(d)).map(titleCase).join(", ") || `${scope.size} selected`);
          return (
            // Collapsible list, expanded by default so the domains are visible up
            // front; the user can still collapse it to a single quiet line.
            <details className="group" open={domScopeOpen} onToggle={(e) => setDomScopeOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-0.5 font-mono text-[11px] text-text-secondary transition-colors hover:text-accent">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-open:rotate-90" />
                <span className="truncate">{selectedLabel}</span>
              </summary>
              <div className="ml-[7px] mt-2 space-y-2 border-l border-border-subtle/70 pl-4">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => scope.forEach((d) => toggleScope(d))}
                    className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-all ${scope.size === 0 ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-muted hover:-translate-y-0.5 hover:border-accent-border hover:bg-accent-soft hover:text-accent hover:shadow-sm"}`}
                  >
                    All
                  </button>
                  {withQ.map(pill)}
                </div>
                {withoutQ.length > 0 && (
                  <details className="group/sub">
                    <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary">
                      <ChevronRight className="mr-1 inline h-3 w-3 transition-transform group-open/sub:rotate-90" />
                      {withoutQ.length} domain{withoutQ.length === 1 ? "" : "s"} without questions
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">{withoutQ.map(pill)}</div>
                  </details>
                )}
              </div>
            </details>
          );
        })()}
        {nextStep && (
          <div className="flex items-center justify-between border-t border-border-subtle pt-4">
            <span className="font-mono text-[11px] text-text-muted">{scope.size === 0 ? "All domains" : `${scope.size} domain${scope.size === 1 ? "" : "s"}`} · {questionCount} question{questionCount === 1 ? "" : "s"}</span>
            <button
              onClick={() => setActiveStep(nextStep.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-accent-hover"
            >
              Next: {nextStep.label} <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
        </div>
      )}

      {/* PRESETS TAB - set up and apply reusable model presets. In the Models step
          you can either select models directly OR apply a preset from here.
          A preset is a first-class Arena object: a named model group you test in
            one tap. Three tiers, top to bottom: always-on CANONICAL presets that
            resolve live over the model universe; an AI-maintained LIBRARY the model
            re-derives on demand; and your own SAVED snapshots. Apply drops a preset
            onto the Run panel, Run fires it now, Save persists it. */}
      {effectiveStep === "presets" && (
        <div className="space-y-1">
        {(() => {
          // Compact model chips with a runtime validity tick, reused by every
          // preset card. modelLabel gives the human name; providerStatus gives the
          // live runnability of that model's provider.
          const PresetChips = ({ models }: { models: string[] }) => (
            <div className="flex flex-wrap gap-1">
              {models.map((k) => {
                const [cli, modelId] = k.split(MODEL_SEP);
                const ps = providerStatus(cli!);
                const label = modelLabel(cli!, modelId!) || modelId;
                return (
                  <span key={k} title={ps.runnable ? `${label} is ready to run` : `${label} runtime is not ready`} className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                    {ps.runnable
                      ? <Check className="h-2.5 w-2.5 text-ok" strokeWidth={3} aria-hidden />
                      : <span className={`h-1.5 w-1.5 rounded-full ${ps.status === "failed" ? "bg-err" : "bg-warn"}`} aria-hidden />}
                    {label}
                  </span>
                );
              })}
            </div>
          );
          const PresetCard = ({ p, tone }: { p: CanonicalPreset; tone: "canonical" | "ai" }) => {
            // Reflect whether this preset is already in the saved library, so the
            // Save button actually changes state when you click it.
            const saved = suites.some((s) => s.name.trim().toLowerCase() === p.name.trim().toLowerCase());
            return (
            <div className={`rounded-lg border px-3 py-2 ${tone === "ai" ? "border-accent-border/60 bg-accent-soft/20" : "border-border-subtle bg-surface"}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {tone === "ai" && <Sparkles className="h-3 w-3 shrink-0 text-accent" aria-hidden />}
                    <span className="truncate text-[13px] font-medium text-text-primary">{p.name}</span>
                    {saved && <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-1.5 py-px font-mono text-[9px] text-accent"><Check className="h-2.5 w-2.5" strokeWidth={3} /> saved</span>}
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-text-muted">{p.models.length} model{p.models.length === 1 ? "" : "s"}</span>
                  </div>
                  {p.rationale && <div className="mt-0.5 text-[11px] leading-snug text-text-muted">{p.rationale}</div>}
                  <div className="mt-1.5"><PresetChips models={p.models} /></div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <button onClick={() => runPreset(p)} disabled={running} title="Run this preset now" className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
                  <Play className="h-3 w-3" /> Run
                </button>
                <button onClick={() => applyPreset(p)} title="Drop these models onto the Run panel to tweak" className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent">
                  Apply
                </button>
                <button
                  onClick={() => savePreset(p)}
                  title={saved ? "Already in your library. Click to update it with the current models." : "Save this preset into your library"}
                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${saved ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-secondary hover:border-accent-border hover:text-accent"}`}
                >
                  {saved ? <><Check className="h-3 w-3" strokeWidth={3} /> Saved</> : <><Bookmark className="h-3 w-3" /> Save</>}
                </button>
              </div>
            </div>
            );
          };
          return (
            <div className="space-y-4">
              {/* Canonical, always-present. */}
              {canonPresets.length > 0 && (
                <div className="space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Canonical · resolves live</div>
                  {canonPresets.map((p) => <PresetCard key={`canon-${p.name}`} p={p} tone="canonical" />)}
                </div>
              )}

              {/* AI-maintained library. */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">AI presets · maintained by AI</div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button onClick={suggestAiPresets} disabled={aiBusy || availableModelsForAi.length === 0} title="Ask AI to curate a library of presets over your current models" className="inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1 font-mono text-[11px] text-accent hover:bg-accent-soft/70 disabled:opacity-40">
                      {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {aiPresets ? "Refresh" : "Suggest presets"}
                    </button>
                  </div>
                </div>
                {aiBusy && <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 font-mono text-[11px] text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> Curating presets over {availableModelsForAi.length} model{availableModelsForAi.length === 1 ? "" : "s"}…</div>}
                {aiErr && !aiBusy && <div className="flex items-center gap-2 rounded-lg border border-err/40 bg-surface px-3 py-2 text-[11px] text-err"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {aiErr}</div>}
                {!aiBusy && aiPresets && aiPresets.map((p) => <PresetCard key={`ai-${p.name}`} p={p} tone="ai" />)}
                {!aiBusy && !aiErr && !aiPresets && (
                  <div className="rounded-lg border border-dashed border-border px-3 py-2 font-mono text-[11px] text-text-muted">
                    AI can suggest presets like Top Frontier, Second-in-class, or Open source over your {availableModelsForAi.length} runnable model{availableModelsForAi.length === 1 ? "" : "s"}.
                  </div>
                )}
              </div>

              {/* Your saved snapshots (unchanged manual library). */}
              <div className="space-y-2">
                {(canonPresets.length > 0 || aiPresets) && suites.length > 0 && (
                  <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Saved by you</div>
                )}
          {suites.map((s) => {
            const isScheduled = scheduledSuiteId === s.id;
            return (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2">
                <button onClick={() => loadSuite(s)} title="Load into the editor to tweak (does not run)" className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-normal text-text-secondary hover:text-accent">{s.name}</span>
                    {isScheduled && <span className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-1.5 py-px font-mono text-[9px] text-accent"><CalendarClock className="h-2.5 w-2.5" /> {schedFreq}</span>}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-text-muted">
                    {s.models.length} model{s.models.length === 1 ? "" : "s"}{s.domains.length ? ` · ${suiteScopeLabel(s)}` : ""}
                  </div>
                </button>
                <button onClick={() => onRunSuite(s)} disabled={running} title="Run this suite now" className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
                  <Play className="h-3 w-3" /> Run
                </button>
                <button onClick={() => scheduleSuite(s)} title="Run this suite on the background schedule" className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] ${isScheduled ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-secondary hover:border-accent-border hover:text-accent"}`}>
                  <CalendarClock className="h-3 w-3" /> {isScheduled ? "Scheduled" : "Schedule"}
                </button>
                <button onClick={() => { loadSuite(s); setSuiteName(s.name); setSavingSuite(true); }} title="Edit: load this preset's models into the editor above, adjust the selection, then Save to update it" className="text-text-muted/60 hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => { if (isScheduled) setScheduledSuiteId(null); deleteSuite(s.id); }} title="Delete suite" className="text-text-muted/50 hover:text-err"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            );
          })}
          {savingSuite ? (
            <div className="flex items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/30 px-3 py-2">
              <input
                autoFocus value={suiteName} onChange={(e) => setSuiteName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitSuite(); if (e.key === "Escape") { setSavingSuite(false); setSuiteName(""); } }}
                placeholder="suite name (e.g. Frontier x Finance)" className="flex-1 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] outline-none focus:border-accent-border"
              />
              <span className="font-mono text-[10px] text-text-muted">{selModels.size} model{selModels.size === 1 ? "" : "s"}</span>
              <button onClick={commitSuite} disabled={!suiteName.trim() || selModels.size === 0} className="rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] text-background disabled:opacity-40">{suites.some((x) => x.name.toLowerCase() === suiteName.trim().toLowerCase()) ? "Update" : "Save"}</button>
              <button onClick={() => { setSavingSuite(false); setSuiteName(""); }} className="text-text-muted hover:text-text-primary"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <button onClick={() => setSavingSuite(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 font-mono text-[11px] text-text-muted hover:border-accent-border hover:text-accent">
              <Plus className="h-3.5 w-3.5" /> Save selected models as a preset
            </button>
          )}
              </div>
            </div>
          );
        })()}
        </div>
      )}

      {/* STEP 3 · REVIEW & RUN - the run summary (selected models, domains, total
          questions) folded in, with the primary Run action. Everything reflects
          the live selection. When a run is in progress the whole config is
          replaced by the running-jobs view above, so this step is the launch pad. */}
      {effectiveStep === "review" && (
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="mb-2.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Run summary</div>
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold text-text-primary">Models ({selModels.size})</div>
              <button onClick={() => setActiveStep("models")} className="font-mono text-[10px] text-text-muted hover:text-accent">Edit</button>
            </div>
            <div className="mt-1 space-y-1">
              {selModelLabels.length === 0
                ? <div className="rounded-lg border border-dashed border-border px-2 py-1.5 text-[11px] text-text-muted">No models selected yet. Go back to the Models step.</div>
                : selModelLabels.slice(0, 8).map((l, i) => (
                  <div key={i} className="truncate rounded-lg bg-surface-warm/60 px-2 py-1 font-mono text-[11px] text-text-secondary">{l}</div>
                ))}
              {selModelLabels.length > 8 && <div className="px-2 font-mono text-[10px] text-text-muted">+{selModelLabels.length - 8} more</div>}
            </div>
            <div className="mb-1 mt-3 flex items-center justify-between">
              <div className="text-[12px] font-semibold text-text-primary">Domains ({scope.size === 0 ? allDomains.length : scope.size})</div>
              {domainsStepShown && <button onClick={() => setActiveStep("domains")} className="font-mono text-[10px] text-text-muted hover:text-accent">Edit</button>}
            </div>
            <div className="flex flex-wrap gap-1">
              {scope.size === 0
                ? <span className="rounded-md bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">All domains</span>
                : Array.from(scope).map((d) => <span key={d} className="rounded-md bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">{titleCase(d)}</span>)}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
              <span className="font-mono text-[11px] text-text-muted">Total questions</span>
              <span className="font-mono text-sm font-semibold text-text-primary">{questionCount}</span>
            </div>
            <button
              onClick={onRun}
              disabled={running || questionCount === 0 || selCount === 0}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Running…" : `Run ${selCount} model${selCount === 1 ? "" : "s"}`}
            </button>
            <p className="mt-2 text-center font-mono text-[10px] leading-relaxed text-text-muted">Different CLIs run in parallel · auto-scored. Review results in History.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Right rail for the Leaderboard: the aggregate stats the mockup pins to the
// side (average arena score, fastest model, lowest cost, highest value), a
// score-distribution chart, and plain-language insights. Everything is derived
// from the same ranked rows shown in the standings, so the numbers are real.
type BoardRow = {
  key: string;
  parsed: { vendor: string; model: string };
  best: number | null;
  value: number | null;
  latestRun: BenchmarkRun | null;
  history: number[];
};
function LeaderboardRail({ rows }: { rows: BoardRow[] }) {
  const stats = useMemo(() => {
    const scored = rows.filter((m) => m.best != null);
    if (scored.length === 0) return null;
    const avg = scored.reduce((a, m) => a + (m.best ?? 0), 0) / scored.length;
    const costOf = (m: BoardRow) => (m.latestRun?.cost_basis === "local" ? 0 : m.latestRun?.cost_usd_est ?? null);
    const withMs = scored.filter((m) => m.latestRun?.ms_avg != null && (m.latestRun?.ms_avg ?? 0) > 0);
    const fastest = withMs.length ? withMs.reduce((a, b) => ((a.latestRun!.ms_avg as number) <= (b.latestRun!.ms_avg as number) ? a : b)) : null;
    const withCost = scored.filter((m) => costOf(m) != null);
    const cheapest = withCost.length ? withCost.reduce((a, b) => ((costOf(a) as number) <= (costOf(b) as number) ? a : b)) : null;
    const withValue = scored.filter((m) => m.value != null);
    const bestValue = withValue.length ? withValue.reduce((a, b) => ((a.value as number) >= (b.value as number) ? a : b)) : null;
    // Score distribution into 0-2 / 2-4 / 4-6 / 6-8 / 8-10 buckets.
    const buckets = [0, 0, 0, 0, 0];
    for (const m of scored) { const b = m.best ?? 0; buckets[Math.min(4, Math.floor(b / 2))]++; }
    return { avg, fastest, cheapest, bestValue, buckets, n: scored.length, leader: scored[0], avgSeries: scored.map((m) => m.best ?? 0) };
  }, [rows]);

  if (!stats) return null;
  return (
    <ArenaRightRail>
      <ArenaStatCard icon={TrendingUp} label="Average arena score" value={stats.avg.toFixed(2)} unit="/10" sub={`across ${stats.n} ranked model${stats.n === 1 ? "" : "s"}`} series={stats.avgSeries} />
      {stats.fastest && <ArenaStatCard icon={Gauge} label="Fastest model (avg)" value={fmtLatency(stats.fastest.latestRun?.ms_avg)} badge="Fastest" badgeTone="ok" sub={stats.fastest.parsed.model} />}
      {stats.cheapest && <ArenaStatCard icon={Coins} label="Lowest cost / run" value={fmtCost(stats.cheapest.latestRun?.cost_usd_est, stats.cheapest.latestRun?.cost_basis)} badge="Lowest" badgeTone="ok" sub={stats.cheapest.parsed.model} />}
      {stats.bestValue && <ArenaStatCard icon={Award} label="Highest value" value={stats.bestValue.value!.toFixed(1)} badge="Best value" badgeTone="accent" sub={stats.bestValue.parsed.model} />}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-text-muted">Score distribution</div>
        <ArenaBars buckets={stats.buckets} labels={["0-2", "2-4", "4-6", "6-8", "8-10"]} />
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-text-muted">Leaderboard insights</div>
        <div className="space-y-2.5">
          {stats.leader && <ArenaInsight icon={Crown} tone="accent">{stats.leader.parsed.model} leads with an arena score of {stats.leader.best?.toFixed(2)}.</ArenaInsight>}
          {stats.fastest && <ArenaInsight icon={Gauge} tone="ok">{stats.fastest.parsed.model} is the fastest on average ({fmtLatency(stats.fastest.latestRun?.ms_avg)} per question), ideal for low-latency use.</ArenaInsight>}
          {stats.cheapest && <ArenaInsight icon={Coins} tone="ok">{stats.cheapest.parsed.model} is the most economical at {fmtCost(stats.cheapest.latestRun?.cost_usd_est, stats.cheapest.latestRun?.cost_basis)} per run.</ArenaInsight>}
        </div>
      </div>
    </ArenaRightRail>
  );
}

export function BenchResults({
  view, domainFilter, runs, matrix, allDomains, vaultPath, initialModel, currentDomain, onChanged, onRerun, onRerunBatch, onContinueBatch,
  finishedBatch, onViewBatch, onDismissBanner, onCrumbHome, onClearDomain,
}: {
  view: "board" | "history" | "matrix" | "frontier";
  domainFilter: string;
  runs: BenchmarkRun[];
  matrix: MatrixRow[];
  allDomains: string[];
  vaultPath: string;
  currentDomain?: string | null;
  initialModel?: string | null;
  onChanged: () => void;
  onRerun: (run: BenchmarkRun) => void;
  onRerunBatch: (runs: BenchmarkRun[]) => void;
  onContinueBatch: (runs: BenchmarkRun[]) => void;
  finishedBatch?: string | null;
  onViewBatch?: () => void;
  onDismissBanner?: () => void;
  onCrumbHome?: () => void;
  onClearDomain?: () => void;
}) {
  const resultsView = view;
  const [selected, setSelected] = useState<RunDetail | null>(null);
  // The run + breadcrumb context behind the open detail page, so the user can
  // see where they are (view › batch › run) and walk back up the tree.
  const [selectedRun, setSelectedRun] = useState<BenchmarkRun | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<{ view: string; batch?: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedQ, setExpandedQ] = useState<string | null>(null);
  // Set of run_dirs currently being scored, so you can fire scoring on several
  // runs at once - each scores independently instead of one lock blocking all.
  const [scoringRuns, setScoringRuns] = useState<Set<string>>(() => new Set());

  async function loadRun(runDir: string, from?: { view: string; batch?: string }) {
    setLoadingDetail(true);
    setExpandedQ(null);
    setSelectedRun(runs.find((r) => r.run_dir === runDir) ?? null);
    setSelectedFrom(from ?? { view: resultsView === "history" ? "History" : resultsView === "matrix" ? "Model × domain" : resultsView === "frontier" ? "Chart" : "Leaderboard" });
    try {
      setSelected(await invoke<RunDetail>("benchmark_run_detail", { runDir }));
    } catch { /* ignore */ } finally {
      setLoadingDetail(false);
    }
  }

  // Score one unscored run on demand, then refresh the lists.
  async function scoreNow(run: BenchmarkRun) {
    const runName = run.run_dir.split("/").pop() ?? "";
    if (!runName) return;
    const dir = run.run_dir;
    if (scoringRuns.has(dir)) return; // already scoring this one
    const session = `bench-score-one-${Date.now()}-${runName}`;
    setScoringRuns((s) => new Set(s).add(dir));
    try {
      const done = new Promise<void>((resolve) => {
        let un: UnlistenFn | null = null;
        listen<{ session: string; phase: string }>("benchmark:done", (e) => {
          if (e.payload.session === session && e.payload.phase === "score") { un?.(); resolve(); }
        }).then((u) => { un = u; });
      });
      await invoke("benchmark_score", { args: { session_id: session, vault: vaultPath, run: runName } });
      await done;
      onChanged();
    } catch { /* surfaced via refresh */ } finally {
      setScoringRuns((s) => { const n = new Set(s); n.delete(dir); return n; });
    }
  }

  // Runs visible under the current domain filter (a run is "in" a domain
  // when any of its questions came from it).
  const visibleRuns = useMemo(() => {
    if (domainFilter === "all") return runs;
    return runs.filter((r) => r.domains.includes(domainFilter));
  }, [runs, domainFilter]);

  // Run history grouped by BATCH - the models you launched together are one
  // unit, named by time + scope + panel size so several batches a day stay
  // distinct. Runs from before batch-stamping are clustered into
  // pseudo-batches by launch time (folders created within minutes of each
  // other were one launch), so old history reads as real sessions too.
  const [historySort, setHistorySort] = useState<"recent" | "oldest" | "score" | "size">("recent");
  const runsByBatch = useMemo(() => {
    type Group = { key: string; label: string; date: string; runs: BenchmarkRun[]; isBatch: boolean };
    const groups = new Map<string, Group>();
    const legacy: BenchmarkRun[] = [];
    for (const r of visibleRuns) {
      if (!r.batch_id) { legacy.push(r); continue; }
      const g = groups.get(r.batch_id) ?? {
        key: r.batch_id,
        label: r.batch_label || r.batch_id,
        date: r.date || "",
        runs: [],
        isBatch: true,
      };
      g.runs.push(r);
      groups.set(r.batch_id, g);
    }
    // Cluster legacy runs: sorted by creation time, a gap over 10 minutes
    // starts a new pseudo-batch.
    const GAP = 10 * 60 * 1000;
    const sortedLegacy = [...legacy].sort((a, b) => a.created_ms - b.created_ms);
    let cluster: BenchmarkRun[] = [];
    const flush = () => {
      if (cluster.length === 0) return;
      const first = cluster[0];
      const t = first.created_ms ? new Date(first.created_ms) : null;
      const hhmm = t ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "";
      const key = `legacy-${first.run_dir}`;
      groups.set(key, {
        key,
        label: `${hhmm ? hhmm + " · " : ""}${cluster.length} model${cluster.length === 1 ? "" : "s"}`,
        date: first.date || "",
        runs: cluster,
        isBatch: false,
      });
      cluster = [];
    };
    for (const r of sortedLegacy) {
      if (cluster.length > 0 && r.created_ms - cluster[cluster.length - 1].created_ms > GAP) flush();
      cluster.push(r);
    }
    flush();
    // Enrich each group with sort keys: the most recent run's timestamp (so
    // "latest on top" is reliable, not dependent on insertion order), the best
    // score, and the model count. Runs within a group are ordered newest-first.
    const enriched = Array.from(groups.values()).map((g) => ({
      ...g,
      runs: [...g.runs].sort((a, b) => (b.created_ms ?? 0) - (a.created_ms ?? 0)),
      latestMs: g.runs.reduce((mx, r) => Math.max(mx, r.created_ms ?? 0), 0),
      best: g.runs.reduce<number | null>((acc, r) => (r.judge_avg == null ? acc : acc == null ? r.judge_avg : Math.max(acc, r.judge_avg)), null),
    }));
    enriched.sort((a, b) => {
      if (historySort === "oldest") return a.latestMs - b.latestMs;
      if (historySort === "score") return (b.best ?? -1) - (a.best ?? -1);
      if (historySort === "size") return b.runs.length - a.runs.length;
      return b.latestMs - a.latestMs; // "recent" (default): latest on top
    });
    return enriched;
  }, [visibleRuns, historySort]);

  // By-model aggregation: every run of the same model folded into one row -
  // best/latest scores, run count, and the domains it has been tested on.
  const modelAgg = useMemo(() => {
    const byModel = new Map<string, { parsed: ReturnType<typeof parseRunLabel>; runs: BenchmarkRun[] }>();
    for (const r of visibleRuns) {
      const parsed = parseRunLabel(r.label);
      const key = `${parsed.vendor}::${parsed.model || r.label}`;
      const e = byModel.get(key) ?? { parsed, runs: [] };
      e.runs.push(r);
      byModel.set(key, e);
    }
    const rows = Array.from(byModel.values()).map(({ parsed, runs: rr }) => {
      const judgeFor = (r: BenchmarkRun) => {
        if (domainFilter === "all") return r.judge_avg;
        return matrix.find((m) => m.run_dir === r.run_dir)?.per_domain[domainFilter]?.judge_avg ?? null;
      };
      const kwFor = (r: BenchmarkRun) => {
        if (domainFilter === "all") return r.keyword_avg;
        return matrix.find((m) => m.run_dir === r.run_dir)?.per_domain[domainFilter]?.keyword_avg ?? null;
      };
      const scoredRuns = rr.filter((r) => judgeFor(r) !== null);
      const best = scoredRuns.reduce<number | null>((acc, r) => {
        const v = judgeFor(r);
        return v === null ? acc : acc === null ? v : Math.max(acc, v);
      }, null);
      const latest = [...rr].sort((a, b) => b.date.localeCompare(a.date))[0];
      const domains = Array.from(new Set(rr.flatMap((r) => r.domains))).sort();
      // Chronological judge scores - the drift line. Delta = latest vs the
      // run before it.
      const history = [...scoredRuns]
        .sort((a, b) => a.created_ms - b.created_ms)
        .map((r) => judgeFor(r))
        .filter((v): v is number => v !== null);
      const delta = history.length >= 2 ? history[history.length - 1] - history[history.length - 2] : null;
      return {
        key: `${parsed.vendor}::${parsed.model}`,
        parsed,
        runs: [...rr].sort((a, b) => b.date.localeCompare(a.date)),
        best,
        latestRun: latest ?? null,
        latestJudge: latest ? judgeFor(latest) : null,
        latestKw: latest ? kwFor(latest) : null,
        latestDate: latest?.date ?? "",
        domains,
        history,
        delta,
      };
    });
    return rows.sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
  }, [visibleRuns, matrix, domainFilter]);
  const [expandedModel, setExpandedModel] = useState<string | null>(initialModel ?? null);

  // The Leaderboard is sortable across all dimensions + a composite Value
  // (this folds in the old Compare "Ranked" view so there's one ranked list,
  // not two). Value = 50% intelligence · 25% speed · 25% cost, normalized over
  // the visible models. Default sort stays Intelligence.
  const [boardSort, setBoardSort] = useState<"intel" | "value" | "speed" | "cost">("intel");
  const { rankedRows, unrankedRows } = useMemo(() => {
    // A model is "rankable" only if it produced a real judged score — meaning a
    // score that is BOTH present and > 0. A model that errored/never ran shows up
    // with a null OR a 0 score, and its speed ($0) and latency (~0ms) are equally
    // bogus. Excluding it from the rankable set here keeps it off the top of
    // EVERY sort (Intelligence, Value, Speed AND Cost), not just Intelligence.
    const hasRealScore = (b: number | null) => b != null && b > 0;
    const rankable = modelAgg.filter((m) => hasRealScore(m.best));
    const costsPos = rankable.map((m) => (m.latestRun?.cost_basis === "local" ? 0 : m.latestRun?.cost_usd_est)).filter((c): c is number => c != null && c > 0);
    const costMax = costsPos.length ? Math.max(...costsPos, 0.0001) : 1;
    const msVals = rankable.map((m) => m.latestRun?.ms_avg).filter((v): v is number => v != null && v > 0);
    const msMin = msVals.length ? Math.min(...msVals) : 0;
    const msMax = msVals.length ? Math.max(...msVals) : 1;
    const speedN = (ms: number | null | undefined) => ms == null ? 0.5 : msMax === msMin ? 0.5 : 1 - (ms - msMin) / (msMax - msMin);
    const costN = (c: number | null | undefined) => c == null ? 0.5 : costMax <= 0 ? 1 : 1 - c / costMax;
    const withV = rankable.map((m) => {
      const local = m.latestRun?.cost_basis === "local";
      const cost = local ? 0 : (m.latestRun?.cost_usd_est ?? null);
      return { ...m, value: (0.5 * ((m.best ?? 0) / 10) + 0.25 * speedN(m.latestRun?.ms_avg) + 0.25 * costN(cost)) * 10 };
    });
    const ranked = [...withV].sort((a, b) => {
      if (boardSort === "cost") {
        const ac = a.latestRun?.cost_basis === "local" ? 0 : (a.latestRun?.cost_usd_est ?? Infinity);
        const bc = b.latestRun?.cost_basis === "local" ? 0 : (b.latestRun?.cost_usd_est ?? Infinity);
        return ac - bc;
      }
      const f = (x: typeof withV[number]) => boardSort === "intel" ? (x.best ?? -1) : boardSort === "speed" ? speedN(x.latestRun?.ms_avg) : boardSort === "value" ? x.value : (x.best ?? -1);
      return f(b) - f(a);
    });
    // Unranked: didn't produce a real score (null OR 0). Value is null so the
    // row renders dashes, not a misleading 0.
    const unranked = modelAgg
      .filter((m) => !hasRealScore(m.best))
      .map((m) => ({ ...m, value: null as number | null }))
      .sort((a, b) => (b.latestDate || "").localeCompare(a.latestDate || ""));
    return { rankedRows: ranked, unrankedRows: unranked };
  }, [modelAgg, boardSort]);

  // One leaderboard row. rank === null means the model produced no judged score
  // (errored / unscored) — it renders muted, parked below the standings, and its
  // speed/cost are hidden so a $0/0ms error can't masquerade as a great result.
  const renderBoardRow = (m: (typeof rankedRows)[number] | (typeof unrankedRows)[number], rank: number | null) => {
    const total = rankedRows.length;
    const leader = rank === 0 && total > 1;
    const podium = rank !== null && rank < 3 && total > 1;
    return (
      <div
        key={m.key}
        className={`overflow-hidden rounded-xl border transition-colors ${
          rank === null
            ? "border-border-subtle bg-surface/60 opacity-70"
            : leader
              ? "border-accent bg-gradient-to-r from-accent-soft/70 to-surface"
              : podium
                ? "border-accent-border/50 bg-surface"
                : "border-border-subtle bg-surface"
        }`}
      >
        <button
          onClick={() => setExpandedModel(expandedModel === m.key ? null : m.key)}
          className={`flex w-full items-center gap-3 text-left hover:bg-surface-warm/60 ${leader ? "px-4 py-3" : "px-4 py-2"}`}
        >
          {/* Rank */}
          <span className={`flex shrink-0 items-center justify-center rounded-full font-mono font-bold ${
            rank === null
              ? "h-6 w-6 text-[11px] text-text-muted/50"
              : leader
                ? "h-8 w-8 bg-accent text-background"
                : podium
                  ? "h-6 w-6 border border-accent-border bg-accent-soft text-[11px] text-accent"
                  : "h-6 w-6 text-[11px] text-text-muted"
          }`}>
            {rank === null ? "–" : leader ? <Crown className="h-4 w-4" /> : rank + 1}
          </span>
          <ProviderMark vendor={m.parsed.vendor} size={leader ? 28 : 22} />
          <span className="min-w-0 flex-1">
            <span className={`block truncate font-display tracking-tight ${leader ? "text-base font-bold" : "text-sm font-semibold"}`}>
              {m.parsed.model}
            </span>
            <span className="block font-mono text-[10px] text-text-muted">
              {m.runs.length} run{m.runs.length === 1 ? "" : "s"} · {m.domains.length} domain{m.domains.length === 1 ? "" : "s"} · last {m.latestDate || "-"}
              {rank === null ? (
                <span className="ml-1.5 font-semibold text-warn" title="No judged score: this model errored or hasn't been scored, so it isn't ranked.">· no score</span>
              ) : m.delta !== null && Math.abs(m.delta) >= 0.05 ? (
                <span className={`ml-1.5 font-semibold ${m.delta > 0 ? "text-ok" : "text-warn"}`} title={`Judge trend: ${m.history.map((v) => v.toFixed(1)).join(" → ")}`}>
                  {m.delta > 0 ? "▲" : "▼"}{Math.abs(m.delta).toFixed(1)}
                </span>
              ) : null}
            </span>
          </span>
          {/* Numeric columns — fixed widths + always rendered so every row lines
              up. Speed/cost are dashed for unranked models (can't be trusted). */}
          <span className={`hidden w-16 shrink-0 text-right font-mono text-[11px] tabular-nums sm:block ${boardSort === "speed" && rank !== null ? "text-text-primary" : "text-text-muted"}`} title="Speed: avg latency per question (latest run)">
            {rank !== null && m.latestRun?.ms_avg != null ? fmtLatency(m.latestRun.ms_avg) : "–"}
          </span>
          <span className={`hidden w-20 shrink-0 text-right font-mono text-[11px] tabular-nums sm:block ${boardSort === "cost" && rank !== null ? "text-text-primary" : "text-text-muted"}`} title="Cost: est. per run (latest run)">
            {rank !== null && m.latestRun?.cost_usd_est != null ? fmtCost(m.latestRun.cost_usd_est, m.latestRun.cost_basis) : "–"}
          </span>
          <span className={`hidden w-12 shrink-0 text-right font-mono text-[11px] tabular-nums md:block ${boardSort === "value" && rank !== null ? "text-accent" : "text-text-muted"}`} title="Value: 50% intelligence · 25% speed · 25% cost">
            {m.value != null ? m.value.toFixed(1) : "–"}
          </span>
          <div className="hidden w-24 shrink-0 lg:block"><ScoreBar value={m.best} max={10} color={scoreColor((m.best ?? 0) * 10)} /></div>
          <span className={`shrink-0 text-right font-mono font-bold tabular-nums ${rank === null ? "text-text-muted/50" : "text-accent"} ${leader ? "w-14 text-2xl" : "w-12 text-sm"}`}>
            {m.best?.toFixed(1) ?? "–"}
          </span>
        </button>
        {expandedModel === m.key && (
          <div className="border-t border-border-subtle bg-surface px-4 py-2">
            {m.runs.map((r) => (
              <div key={r.run_dir} className="flex w-full items-center gap-3 rounded px-2 py-1.5 hover:bg-surface-warm">
                <button
                  onClick={() => r.scored && loadRun(r.run_dir)}
                  disabled={!r.scored}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                >
                  <span className="w-20 shrink-0 font-mono text-[10px] text-text-muted">{r.date || "undated"}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    {r.domains.slice(0, 6).map((d) => (
                      <span key={d} className="rounded bg-surface-warm px-1.5 py-0 font-mono text-[9px] text-text-muted">{d}</span>
                    ))}
                    {r.domains.length > 6 && <span className="font-mono text-[9px] text-text-muted">+{r.domains.length - 6}</span>}
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">{r.questions} q</span>
                  {r.scored ? (
                    <RunDims run={r} />
                  ) : (
                    <span className="font-mono text-[10px] text-warn">unscored</span>
                  )}
                </button>
                <button
                  onClick={() => onRerun(r)}
                  title="Rerun: same model, same domains, as a fresh run"
                  className="shrink-0 rounded-md border border-border p-1 text-text-muted hover:border-accent-border hover:text-accent"
                >
                  <RotateCw className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // K2 (Monday feedback): the "Coverage by domain" summary table was removed -
  // it restated runs/models-per-domain that the main Model × domain matrix below
  // already conveys ("What's the point of this. Remove it.").

  if (selected) {
    const p = parseRunLabel(selected.score.label);
    const crumbBatch = selectedRun?.batch_label ?? selectedFrom?.batch ?? (selectedRun?.date || null);
    // A section header inside an expanded question: big, bold, unmissable.
    const SectionHead = ({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "ok" | "accent" }) => (
      <h4 className={`mb-1.5 flex items-center gap-2 font-display text-[15px] font-bold tracking-tight ${
        tone === "ok" ? "text-ok" : tone === "accent" ? "text-accent" : "text-text-primary"
      }`}>
        {children}
      </h4>
    );
    return (
      <div className="w-full px-8 py-5">
        <BenchCrumbs
          items={[
            { label: "Arena" },
            { label: selectedFrom?.view ?? "Leaderboard", onClick: () => setSelected(null) },
            ...(crumbBatch ? [{ label: crumbBatch, onClick: () => setSelected(null) }] : []),
            { label: p.model },
          ]}
          meta={`${selected.score.questionScores.length} questions`}
        />
        {/* Dense header - model, when, where it ran, and the verdict, one row. */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
          <ProviderMark vendor={p.vendor} size={28} />
          <h2 className="font-display text-xl font-bold tracking-tight">{p.model}</h2>
          {selectedRun?.date && <span className="rounded bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-muted">{selectedRun.date}</span>}
          <span className="flex items-center gap-1">
            {(selectedRun?.domains ?? []).slice(0, 6).map((d) => (
              <span key={d} className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{d}</span>
            ))}
            {(selectedRun?.domains.length ?? 0) > 6 && <span className="font-mono text-[10px] text-text-muted">+{(selectedRun?.domains.length ?? 0) - 6}</span>}
          </span>
          <div className="ml-auto flex items-center gap-5 font-mono text-sm">
            <span title="Intelligence: judge score /10"><span className="font-display text-2xl font-bold text-accent">{selected.score.judge_avg?.toFixed(1) ?? "-"}</span><span className="text-[11px] text-text-muted"> /10</span></span>
            <span className="text-text-secondary">{selected.score.keyword_avg !== null ? Math.round(selected.score.keyword_avg) + "% kw" : ""}</span>
            <span className="inline-flex items-center gap-1 text-text-muted" title="Speed: average latency per question"><Zap className="h-3.5 w-3.5" />{fmtLatency(selectedRun?.ms_avg ?? selected.score.ms_avg)}</span>
            <span className={`inline-flex items-center gap-1 ${(selectedRun?.cost_basis ?? selected.score.cost_basis) === "local" ? "text-ok" : "text-text-muted"}`} title="Cost: estimated from token usage (free for local models)"><DollarSign className="h-3.5 w-3.5" />{fmtCost(selectedRun?.cost_usd_est ?? selected.score.cost_usd_est, selectedRun?.cost_basis ?? selected.score.cost_basis)}</span>
            <span className="text-text-muted">{selected.score.questionScores.length} q</span>
            {selectedRun && (
              <button
                onClick={() => onRerun(selectedRun)}
                title="Rerun: same model, same domains, as a fresh run"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
              >
                <RotateCw className="h-3 w-3" /> rerun
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {selected.score.questionScores.map((q) => {
            const expanded = expandedQ === q.id;
            const record = selected.records.find((r) => r.id === q.id);
            return (
              <div key={q.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                <button onClick={() => setExpandedQ(expanded ? null : q.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-warm">
                  <span className="text-text-muted">{expanded ? "▾" : "▸"}</span>
                  <span className="w-44 shrink-0 truncate font-mono text-sm text-text-primary" title={q.id}>{q.id}</span>
                  <span className="rounded bg-surface-warm px-1.5 py-0 font-mono text-[10px] text-text-muted">{q.domain}</span>
                  <div className="min-w-0 flex-1"><ScoreBar value={q.judge_score} max={10} /></div>
                  <span className="flex shrink-0 items-center gap-3 font-mono text-xs">
                    <span className="text-text-muted">{q.keyword_score !== null ? Math.round(q.keyword_score) + "%" : "-"}</span>
                    <span className="w-10 text-right text-accent">{q.judge_score ?? "-"}/10</span>
                  </span>
                </button>
                {expanded && (
                  <div className="space-y-5 border-t border-border-subtle px-6 py-5 text-sm">
                    <div>
                      <SectionHead><FileText className="h-4 w-4" /> Question</SectionHead>
                      <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record?.prompt ?? "(n/a)"}</div>
                    </div>
                    {record?.expected_decision && (
                      <div className="rounded-lg border border-ok/25 bg-ok/5 px-4 py-3">
                        <SectionHead tone="ok"><Check className="h-4 w-4" strokeWidth={3} /> Expected decision</SectionHead>
                        <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record.expected_decision}</div>
                      </div>
                    )}
                    <div>
                      <SectionHead><MessagesSquare className="h-4 w-4" /> Model's answer</SectionHead>
                      <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record?.reply ?? "(no reply)"}</div>
                    </div>
                    {q.judge_rationale && (
                      <div className="rounded-lg border border-accent-border bg-accent-soft/40 px-4 py-3">
                        <SectionHead tone="accent"><Scale className="h-4 w-4" /> Judge verdict · {q.judge_score}/10</SectionHead>
                        <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-secondary">{q.judge_rationale}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // The view title + breadcrumb now live in the Arena page header (rendered by
  // BenchmarkPanel); this body opens straight into the content. onCrumbHome /
  // onClearDomain are still used by the drill-down detail view above.
  void onCrumbHome; void onClearDomain;
  return (
    <div className="w-full px-8 pb-6">
      {visibleRuns.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          {domainFilter === "all"
            ? <>No runs yet. Head to <span className="text-accent">Run</span> to kick one off.</>
            : <>No runs cover <span className="text-accent">{titleCase(domainFilter)}</span> yet. Run a benchmark scoped to it, or switch the filter to all domains.</>}
        </div>
      )}

      {/* K2: "Coverage by domain" table removed - redundant with the matrix. */}

      {loadingDetail && <div className="mb-2 text-xs text-text-muted">loading…</div>}

      {/* LEADERBOARD - the page leads with the ANSWER: which model wins.
          Podium for the top three, then full standings, one row per model. */}
      {resultsView === "board" && visibleRuns.length > 0 && (
        <div className="flex flex-col gap-5 xl:flex-row">
          <div className="min-w-0 flex-1">
          {finishedBatch && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-accent-border bg-accent-soft/50 px-4 py-2.5">
              <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={3} />
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                Batch <span className="font-semibold">{finishedBatch}</span> finished and is on the board.
              </span>
              <button onClick={onViewBatch} className="shrink-0 rounded-md border border-accent-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background">
                View batch
              </button>
              <button onClick={onDismissBanner} title="Dismiss" className="shrink-0 rounded-md p-1 text-text-muted hover:text-text-primary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {/* Hero: the current top performer reads first, with its trend and the
              dimensions that matter (speed, cost, value), all from real runs. */}
          {rankedRows.length > 0 && (() => {
            const top = rankedRows[0];
            return (
              <div className="mb-4 overflow-hidden rounded-2xl border border-accent bg-gradient-to-br from-accent-soft/70 via-surface to-surface p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-background">
                    <Crown className="h-3 w-3" /> #1 Top performer
                  </span>
                  <ProviderMark vendor={top.parsed.vendor} size={26} />
                  <span className="font-display text-xl font-bold tracking-tight text-text-primary">{top.parsed.model}</span>
                  <span className="font-mono text-[11px] text-text-muted">{top.runs.length} run{top.runs.length === 1 ? "" : "s"} · {top.domains.length} domain{top.domains.length === 1 ? "" : "s"}{top.latestDate ? ` · last ${top.latestDate}` : ""}</span>
                  {top.history.length >= 2 && <span className="ml-auto"><Sparkline values={top.history} width={120} height={32} /></span>}
                </div>
                <div className="mt-4 flex flex-wrap items-end gap-6">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Arena score</div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-4xl font-bold tracking-tight text-accent">{top.best?.toFixed(2) ?? "-"}</span>
                      <span className="text-sm text-text-muted">/10</span>
                      {top.delta !== null && Math.abs(top.delta) >= 0.05 && (
                        <span className={`font-mono text-xs font-semibold ${top.delta > 0 ? "text-ok" : "text-warn"}`}>{top.delta > 0 ? "▲" : "▼"}{Math.abs(top.delta).toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                    <ArenaMetric icon={Gauge} label="Avg speed" value={fmtLatency(top.latestRun?.ms_avg)} hint="latest run" />
                    <ArenaMetric icon={DollarSign} label="Avg cost / run" value={fmtCost(top.latestRun?.cost_usd_est, top.latestRun?.cost_basis)} hint="lower is better" tone={top.latestRun?.cost_basis === "local" ? "ok" : "muted"} />
                    <ArenaMetric icon={Award} label="Value" value={top.value != null ? top.value.toFixed(1) : "-"} hint="intel · speed · cost" tone="accent" />
                    <ArenaMetric icon={Layers} label="Domains" value={String(top.domains.length)} hint="tested on" />
                  </div>
                </div>
              </div>
            );
          })()}
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Sort by</span>
            <div className="inline-flex items-center rounded-lg border border-border-subtle bg-surface p-0.5">
              {([["intel", "Intelligence"], ["value", "Value"], ["speed", "Speed"], ["cost", "Cost"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setBoardSort(k)} className={`rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${boardSort === k ? "bg-accent text-background shadow-sm" : "text-text-muted hover:bg-surface-warm hover:text-text-primary"}`}>{label}</button>
              ))}
            </div>
          </div>
          {/* Column header — aligns with the fixed-width columns below. */}
          <div className="mb-1 hidden items-center gap-3 px-4 font-mono text-[9px] uppercase tracking-wider text-text-muted/70 sm:flex">
            <span className="min-w-0 flex-1" />
            <span className="w-16 text-right">Speed</span>
            <span className="w-20 text-right">Cost</span>
            <span className="hidden w-12 text-right md:block">Value</span>
            <span className="hidden w-24 lg:block">Score</span>
            <span className="w-12 text-right">/10</span>
          </div>
          <div className="flex flex-col gap-2">
            {rankedRows.map((m, i) => renderBoardRow(m, i))}
          </div>
          {unrankedRows.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-1.5 px-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                <AlertTriangle className="h-3 w-3 text-warn" /> Not ranked: no judged score (errored or unscored)
              </div>
              <div className="flex flex-col gap-2">
                {unrankedRows.map((m) => renderBoardRow(m, null))}
              </div>
            </div>
          )}
          </div>
          <LeaderboardRail rows={rankedRows} />
        </div>
      )}

      {/* HISTORY - one card per BATCH (the models launched together),
          collapsed by default. The summary alone says when, what scope, how
          many models, and the session's best score. */}
      {resultsView === "history" && visibleRuns.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Sort by</span>
            <div className="inline-flex items-center rounded-lg border border-border-subtle bg-surface p-0.5">
              {([["recent", "Latest"], ["oldest", "Oldest"], ["score", "Best score"], ["size", "Most models"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setHistorySort(k)} className={`rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${historySort === k ? "bg-accent text-background shadow-sm" : "text-text-muted hover:bg-surface-warm hover:text-text-primary"}`}>{label}</button>
              ))}
            </div>
          </div>
          {runsByBatch.map((group) => {
            const best = group.best;
            const unscored = group.runs.filter((r) => !r.scored).length;
            // Avg + a per-run score trend for the batch, mirroring the mockup's
            // best / avg / sparkline columns. All from this batch's real scores.
            const scores = group.runs.map((r) => r.judge_avg).filter((v): v is number => v != null);
            const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
            return (
            <details key={group.key} className="group/date overflow-hidden rounded-2xl border border-border bg-surface">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-2.5 hover:bg-surface-warm">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-open/date:rotate-90" />
                {group.isBatch && <span className="font-mono text-[12px] font-semibold text-text-primary">{group.date}</span>}
                <span className={`min-w-0 truncate font-mono text-[12px] ${group.isBatch ? "text-text-secondary" : "font-semibold text-text-primary"}`}>{group.label}</span>
                <span className="font-mono text-[10px] text-text-muted">{group.runs.length} model{group.runs.length === 1 ? "" : "s"}</span>
                {unscored > 0 && <span className="rounded bg-warn/10 px-1.5 py-0 font-mono text-[9px] text-warn">{unscored} unscored</span>}
                {group.isBatch && unscored > 0 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.preventDefault(); onContinueBatch(group.runs); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onContinueBatch(group.runs); } }}
                    title="Continue this batch: resume where it left off. Skips questions already answered, runs only what's missing, then scores. No tokens re-burned on finished work."
                    className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-accent-border bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent/20"
                  >
                    <RotateCw className="h-3 w-3" /> continue
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.preventDefault(); onRerunBatch(group.runs); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onRerunBatch(group.runs); } }}
                  title="Rerun this whole batch: every model in it, same domains, fresh runs"
                  className={`${group.isBatch && unscored > 0 ? "" : "ml-auto "}inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent`}
                >
                  <RotateCw className="h-3 w-3" /> rerun batch
                </span>
                {scores.length >= 2 && <span className="hidden md:inline"><Sparkline values={scores} width={64} height={20} /></span>}
                <span className="hidden font-mono text-[10px] text-text-muted sm:inline">avg</span>
                <span className="hidden font-mono text-sm text-text-secondary sm:inline">{avg != null ? avg.toFixed(1) : "-"}</span>
                <span className="font-mono text-[10px] text-text-muted">best</span>
                <span className="font-mono text-sm font-semibold text-accent">{best?.toFixed(1) ?? "-"}</span>
              </summary>
              <div className="space-y-1.5 border-t border-border-subtle px-3 py-2.5">
                {group.runs.map((r) => {
                  const parsed = parseRunLabel(r.label);
                  return (
                    <div
                      key={r.run_dir}
                      className="flex w-full items-center gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2 hover:bg-surface-warm"
                    >
                      <button
                        onClick={() => r.scored && loadRun(r.run_dir, { view: "History", batch: group.label })}
                        disabled={!r.scored}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                      >
                        <ProviderMark vendor={parsed.vendor} size={22} />
                        <span className="min-w-0 truncate font-mono text-xs text-text-primary">{parsed.model || r.label}</span>
                        <span className="hidden items-center gap-1 md:flex">
                          {r.domains.slice(0, 5).map((d) => (
                            <span key={d} className="rounded bg-surface-warm px-1.5 py-0 font-mono text-[9px] text-text-muted">{d}</span>
                          ))}
                          {r.domains.length > 5 && <span className="font-mono text-[9px] text-text-muted">+{r.domains.length - 5}</span>}
                        </span>
                      </button>
                      <span className="font-mono text-[10px] text-text-muted">{r.questions} q</span>
                      {r.scored ? (
                        <RunDims run={r} />
                      ) : (
                        <button
                          onClick={() => scoreNow(r)}
                          disabled={scoringRuns.has(r.run_dir)}
                          className="inline-flex items-center gap-1 rounded-md border border-warn/50 bg-warn/10 px-2 py-0.5 font-mono text-[10px] text-warn hover:bg-warn/20 disabled:opacity-50"
                        >
                          {scoringRuns.has(r.run_dir) ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          {scoringRuns.has(r.run_dir) ? "scoring…" : "unscored · score now"}
                        </button>
                      )}
                      <button
                        onClick={() => onRerun(r)}
                        title="Rerun: same model, same domains, as a fresh run"
                        className="shrink-0 rounded-md border border-border p-1 text-text-muted hover:border-accent-border hover:text-accent"
                      >
                        <RotateCw className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </details>
            );
          })}
        </div>
      )}

      {resultsView === "matrix" && visibleRuns.length > 0 && (
        <div className="flex flex-col gap-5 xl:flex-row">
          <div className="min-w-0 flex-1"><BenchMatrix matrix={matrix} allDomains={allDomains} onPick={loadRun} currentDomain={currentDomain} runs={runs} /></div>
          <MatrixInsights matrix={matrix} allDomains={allDomains} />
        </div>
      )}
      {resultsView === "frontier" && visibleRuns.length > 0 && (
        <div className="flex flex-col gap-5 xl:flex-row">
          <div className="min-w-0 flex-1">
            <BenchFrontier
              models={modelAgg}
              onPick={(key) => { const mm = modelAgg.find((x) => x.key === key); if (mm?.latestRun?.scored) loadRun(mm.latestRun.run_dir); }}
            />
          </div>
          <ChartRail models={modelAgg} onPick={(key) => { const mm = modelAgg.find((x) => x.key === key); if (mm?.latestRun?.scored) loadRun(mm.latestRun.run_dir); }} />
        </div>
      )}
    </div>
  );
}

// The 3D Arena as a quality–cost frontier: Y = intelligence, X = cost (log),
// bubble size = speed (bigger = faster). The dashed line is the Pareto frontier
// (the best intelligence available at each cost) - models ON it are the value
// picks; models below/right of it are dominated by something cheaper or smarter.
// Hover a bubble for full stats, click to open its run. SVG (percentage viewBox,
// non-scaling strokes) draws the grid + frontier; the bubbles are positioned
// HTML so they can carry the real vendor mark and react to hover/click.
function BenchFrontier({
  models,
  onPick,
}: {
  models: Array<{ key: string; parsed: { vendor: string; model: string }; best: number | null; latestRun: BenchmarkRun | null }>;
  onPick: (key: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const pts = models.filter((m) => m.best != null).map((m) => {
    const r = m.latestRun;
    const local = r?.cost_basis === "local";
    const cost = local ? 0 : (r?.cost_usd_est ?? null);
    return { key: m.key, vendor: m.parsed.vendor, label: m.parsed.model, intel: m.best as number, cost, local, ms: r?.ms_avg ?? null };
  });
  const plotted = pts.filter((p): p is typeof p & { cost: number } => p.cost != null);
  const unpriced = pts.filter((p) => p.cost == null);

  const positives = plotted.filter((p) => p.cost > 0).map((p) => p.cost);
  const xmin = positives.length ? Math.min(...positives) : 0.01;
  const xmax = positives.length ? Math.max(...positives) : 0.1;
  const logRange = Math.log10(xmax) - Math.log10(xmin) || 1;
  const PL = 11, PR = 96, PT = 8, PB = 85; // plot box, in %
  const xPct = (cost: number) => {
    if (cost <= 0 || positives.length === 0) return PL;             // free lane (left edge)
    const f = (Math.log10(cost) - Math.log10(xmin)) / logRange;
    return PL + 5 + f * (PR - PL - 5);                              // leave room for the free lane
  };
  const yPct = (intel: number) => PT + (1 - intel / 10) * (PB - PT);

  const msVals = plotted.map((p) => p.ms).filter((v): v is number => v != null && v > 0);
  const msMin = msVals.length ? Math.min(...msVals) : 0;
  const msMax = msVals.length ? Math.max(...msVals) : 1;
  const radius = (ms: number | null) => {
    if (ms == null || msMax === msMin) return 15;
    return 11 + (1 - (ms - msMin) / (msMax - msMin)) * 13;          // faster => bigger (11..24)
  };

  // The frontier only considers models with a REAL score (intel > 0). Otherwise
  // an errored / 0-intelligence model, just because it's the cheapest, anchors
  // the line at the bottom and makes "best value" look nonsensical.
  const scored = plotted.filter((p) => p.intel > 0);
  const dominated = (p: { cost: number; intel: number }) =>
    scored.some((q) => q.cost <= p.cost && q.intel >= p.intel && (q.cost < p.cost || q.intel > p.intel));
  const frontier = scored.filter((p) => !dominated(p)).sort((a, b) => a.cost - b.cost);
  const frontierPath = frontier.map((p, i) => `${i === 0 ? "M" : "L"} ${xPct(p.cost)} ${yPct(p.intel)}`).join(" ");
  const frontierKeys = new Set(frontier.map((p) => p.key));

  if (plotted.length === 0) {
    return <div className="rounded-xl border border-border-subtle bg-surface px-4 py-10 text-center text-sm text-text-muted">No scored runs with both a score and a cost yet. Run a benchmark to populate the frontier.</div>;
  }

  return (
    <div className="space-y-3">
      {/* Legend — what the visual encodings mean. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border-subtle bg-surface-warm/40 px-3 py-2 font-mono text-[10px] text-text-muted">
        <span className="inline-flex items-center gap-1"><span className="text-accent">↑</span> smarter (judge /10)</span>
        <span className="inline-flex items-center gap-1"><span className="text-accent">→</span> pricier (log cost)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border border-border bg-surface-warm" /> bigger = faster</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full border border-accent bg-accent-soft" /> ★ best-value frontier</span>
        <span className="ml-auto inline-flex items-center gap-1.5"><span className="inline-block h-0 w-5 border-t border-dashed border-accent" /> most intelligence per dollar</span>
      </div>
      <div className="relative w-full rounded-xl border border-border-subtle bg-surface" style={{ height: 440 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {/* "Sweet spot" tint — top-left corner is smart + cheap. */}
          <rect x={PL} y={PT} width={(PR - PL) * 0.42} height={(PB - PT) * 0.4} className="text-accent" fill="currentColor" opacity={0.04} />
          {[0, 2, 4, 6, 8, 10].map((g) => (
            <line key={g} x1={PL} y1={yPct(g)} x2={PR} y2={yPct(g)} stroke="currentColor" className="text-border-subtle" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={PL} y1={PT} x2={PL} y2={PB} stroke="currentColor" className="text-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={PL} y1={PB} x2={PR} y2={PB} stroke="currentColor" className="text-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {frontier.length >= 2 && <path d={frontierPath} fill="none" stroke="currentColor" className="text-accent" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* Y-axis tick numbers — right-aligned in the gutter, sitting on each gridline. */}
        {[0, 2, 4, 6, 8, 10].map((g) => (
          <span key={g} className="absolute -translate-y-1/2 pr-1.5 text-right font-mono text-[9px] tabular-nums text-text-muted" style={{ left: 0, width: `${PL}%`, top: `${yPct(g)}%` }}>{g}</span>
        ))}
        {/* Y-axis title — rotated along the axis. */}
        <span className="pointer-events-none absolute left-0 font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted" style={{ top: `${(PT + PB) / 2}%`, transform: "translateY(-50%) rotate(-90deg)", transformOrigin: "center", marginLeft: -14 }}>intelligence</span>
        {/* X-axis tick numbers — centered under each gridpoint. */}
        <span className="absolute -translate-x-1/2 font-mono text-[9px] text-text-muted" style={{ left: `${PL}%`, top: `${PB + 3}%` }}>free</span>
        {positives.length > 0 && [xmin, Math.sqrt(xmin * xmax), xmax].map((c, i) => (
          <span key={i} className="absolute -translate-x-1/2 font-mono text-[9px] tabular-nums text-text-muted" style={{ left: `${xPct(c)}%`, top: `${PB + 3}%` }}>{fmtCost(c)}</span>
        ))}
        {/* X-axis title — centered under the plot. */}
        <span className="absolute -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted" style={{ left: `${(PL + PR) / 2}%`, top: `${PB + 9}%` }}>cost per run →</span>
        {plotted.map((p) => {
          const rad = radius(p.ms);
          const on = frontierKeys.has(p.key);
          const isHover = hover === p.key;
          return (
            <button
              key={p.key}
              onClick={() => onPick(p.key)}
              onMouseEnter={() => setHover(p.key)}
              onMouseLeave={() => setHover((h) => (h === p.key ? null : h))}
              title={`${p.label}: ${p.intel.toFixed(1)}/10 · ${fmtLatency(p.ms)} · ${fmtCost(p.cost, p.local ? "local" : undefined)}${on ? " · best-value frontier" : ""}`}
              className={`absolute flex items-center justify-center rounded-full border transition-transform ${on ? "border-accent bg-accent-soft" : "border-border bg-surface-warm"} ${isHover ? "ring-2 ring-accent/40" : ""}`}
              style={{ left: `${xPct(p.cost)}%`, top: `${yPct(p.intel)}%`, width: rad * 2, height: rad * 2, transform: `translate(-50%,-50%) scale(${isHover ? 1.15 : 1})`, zIndex: isHover ? 30 : on ? 10 : 2 }}
            >
              <ProviderMark vendor={p.vendor} size={Math.min(Math.round(rad), 18)} />
            </button>
          );
        })}
        {/* Always-on labels: name + intel · speed · cost under each bubble (above
            for low ones so they don't fall off the axis), so every model reads at
            a glance with no hover. A ★ marks the best-value frontier members. A
            faint backdrop keeps text legible where bubbles crowd together. */}
        {plotted.map((p) => {
          const rad = radius(p.ms);
          const low = yPct(p.intel) > 62;
          const isHover = hover === p.key;
          return (
            <div
              key={`lbl-${p.key}`}
              className="pointer-events-none absolute flex w-24 flex-col items-center rounded px-1 text-center"
              style={{ left: `${xPct(p.cost)}%`, top: `calc(${yPct(p.intel)}% ${low ? `- ${rad + 5}px` : `+ ${rad + 5}px`})`, transform: `translate(-50%, ${low ? "-100%" : "0"})`, zIndex: isHover ? 31 : 15, background: "color-mix(in srgb, var(--color-surface) 70%, transparent)" }}
            >
              <span className={`max-w-full truncate font-mono text-[10px] font-semibold ${frontierKeys.has(p.key) ? "text-accent" : "text-text-primary"}`}>
                {frontierKeys.has(p.key) ? "★ " : ""}{p.label}
              </span>
              <span className="font-mono text-[9px] text-text-muted">{p.intel.toFixed(1)} · {fmtLatency(p.ms)} · {fmtCost(p.cost, p.local ? "local" : undefined)}</span>
            </div>
          );
        })}
      </div>
      {/* Plain-language explanation of how to read the chart. */}
      <p className="px-1 text-[11px] leading-relaxed text-text-muted">
        Each bubble is a model. <span className="text-text-secondary">Higher is smarter</span> (judge score out of 10),{" "}
        <span className="text-text-secondary">further left is cheaper</span> (cost per run, log scale), and a{" "}
        <span className="text-text-secondary">bigger bubble is faster</span>. The dashed line connects the{" "}
        <span className="text-accent">best-value picks</span> (★): the most intelligence you can buy at each price. The tinted top-left corner is the sweet spot: smart and cheap.
      </p>
      {unpriced.length > 0 && (
        <div className="px-1 font-mono text-[10px] text-text-muted">unpriced (no cost axis): {unpriced.map((p) => p.label).join(", ")}</div>
      )}
    </div>
  );
}

// Right rail for the Chart view: a compact "Compare" table of the scored models
// (intelligence / cost / speed) plus quick stats (best intelligence, lowest
// cost, fastest). Everything is read straight off the real model aggregates.
type ChartModel = { key: string; parsed: { vendor: string; model: string }; best: number | null; latestRun: BenchmarkRun | null };
function ChartRail({ models, onPick }: { models: ChartModel[]; onPick: (key: string) => void }) {
  const scored = models.filter((m) => m.best != null && (m.best ?? 0) > 0);
  if (scored.length === 0) {
    return (
      <ArenaRightRail>
        <div className="rounded-2xl border border-border bg-surface p-4 text-[12px] text-text-muted">No scored models yet. Run a benchmark to compare intelligence, cost, and speed here.</div>
      </ArenaRightRail>
    );
  }
  const costOf = (m: ChartModel) => (m.latestRun?.cost_basis === "local" ? 0 : m.latestRun?.cost_usd_est ?? null);
  const top = [...scored].sort((a, b) => (b.best ?? 0) - (a.best ?? 0)).slice(0, 8);
  const bestIntel = top[0];
  const withCost = scored.filter((m) => costOf(m) != null);
  const cheapest = withCost.length ? withCost.reduce((a, b) => ((costOf(a) as number) <= (costOf(b) as number) ? a : b)) : null;
  const withMs = scored.filter((m) => m.latestRun?.ms_avg != null && (m.latestRun?.ms_avg ?? 0) > 0);
  const fastest = withMs.length ? withMs.reduce((a, b) => ((a.latestRun!.ms_avg as number) <= (b.latestRun!.ms_avg as number) ? a : b)) : null;
  return (
    <ArenaRightRail>
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Compare</span>
          <span className="font-mono text-[10px] text-text-muted">{scored.length} model{scored.length === 1 ? "" : "s"}</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 px-1 font-mono text-[8px] uppercase tracking-wider text-text-muted/60">
            <span className="min-w-0 flex-1">Model</span>
            <span className="w-8 text-right">/10</span>
            <span className="w-12 text-right">Cost</span>
            <span className="w-10 text-right">Speed</span>
          </div>
          {top.map((m) => (
            <button key={m.key} onClick={() => onPick(m.key)} className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-surface-warm">
              <ProviderMark vendor={m.parsed.vendor} size={14} />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-primary">{m.parsed.model}</span>
              <span className="w-8 text-right font-mono text-[11px] font-semibold text-accent">{m.best?.toFixed(1)}</span>
              <span className="w-12 text-right font-mono text-[10px] text-text-muted">{fmtCost(costOf(m), m.latestRun?.cost_basis)}</span>
              <span className="w-10 text-right font-mono text-[10px] text-text-muted">{fmtLatency(m.latestRun?.ms_avg)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">Quick stats</div>
        <div className="grid grid-cols-2 gap-2">
          <ArenaMetric icon={BrainCircuit} tone="accent" label="Best intelligence" value={bestIntel.best!.toFixed(1)} hint={bestIntel.parsed.model} />
          {cheapest && <ArenaMetric icon={Coins} tone="ok" label="Lowest cost" value={fmtCost(costOf(cheapest), cheapest.latestRun?.cost_basis)} hint={cheapest.parsed.model} />}
          {fastest && <ArenaMetric icon={Gauge} tone="ok" label="Fastest" value={fmtLatency(fastest.latestRun?.ms_avg)} hint={fastest.parsed.model} />}
        </div>
      </div>
    </ArenaRightRail>
  );
}

// Model × domain pivot - rows are runs (models), columns are domains, cells
// are judge averages. Best cell per column is highlighted so "which model
// wins which domain" reads at a glance.

export function BenchmarkPanel({
  vaultPath,
  initialDomain,
}: {
  vaultPath: string;
  initialDomain?: string | null;
}) {
  // A "runs" deep link from the Models page lands here with a model key to
  // expand on the leaderboard. Consumed once.
  const [initialModel] = useState<string | null>(() => {
    const v = lsGet("prevail.bench.expandModel");
    if (v) lsSet("prevail.bench.expandModel", "");
    return v || null;
  });
  // ONE flat navigation level: every destination is a top-level tab. No
  // "Results" grouping with a second pill bar underneath - that double
  // hierarchy was genuinely confusing.
  const [view, setView] = useState<"run" | "board" | "history" | "matrix" | "frontier" | "questions" | "scout" | "schedule">(
    initialModel ? "board" : initialDomain ? "run" : "board",
  );
  // Domain filter shared by Leaderboard + History, shown in the same bar.
  const [domainFilter, setDomainFilter] = useState<string>(initialDomain ? initialDomain.toLowerCase() : "all");
  // Whether the left section-nav rail is collapsed to an icon-only strip. Choice
  // persists so the Arena reopens the way the user left it.
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => lsGet("prevail.arena.navCollapsed", "0") === "1");
  useEffect(() => { lsSet("prevail.arena.navCollapsed", navCollapsed ? "1" : "0"); }, [navCollapsed]);
  // Set when a batch just finished: the Leaderboard shows a "batch finished"
  // banner linking to it in History (answer first, filing one click away).
  const [finishedBatch, setFinishedBatch] = useState<string | null>(null);

  // Data
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [questions, setQuestions] = useState<BenchQuestion[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [vaultDomains, setVaultDomains] = useState<string[]>([]);
  // Connected apps (Google, Meta, ...). Loaded only so we can EXCLUDE them from
  // the Arena domain list - apps are not benchmarkable domains and were leaking
  // in via question/matrix keys (e.g. "App Google", "Meta").
  const [apps, setApps] = useState<EngineApp[]>([]);
  const refresh = useCallback(() => {
    invoke<BenchmarkRun[]>("benchmark_runs", { vault: vaultPath }).then(setRuns).catch((e) => setErr(String(e)));
    invoke<MatrixRow[]>("benchmark_matrix", { vault: vaultPath }).then(setMatrix).catch(() => {});
    invoke<BenchQuestion[]>("benchmark_questions", { vault: vaultPath }).then(setQuestions).catch(() => {});
    invoke<Domain[]>("scan_vault", { path: vaultPath })
      .then((ds) => setVaultDomains(ds.map((d) => d.name)))
      .catch(() => {});
    invoke<EngineApp[]>("engine_apps_list").then(setApps).catch(() => {});
  }, [vaultPath]);
  useEffect(() => { refresh(); }, [refresh]);
  // Auto-refresh: re-read runs whenever the window regains focus or the tab
  // becomes visible again. Benchmark runs/scores can change on disk from outside
  // this view (a CLI run, an engine rescore), and the panel otherwise only read
  // once on mount - so a freshly-scored model wouldn't appear until a remount.
  useEffect(() => {
    const onWake = () => { if (document.visibilityState !== "hidden") refresh(); };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => { window.removeEventListener("focus", onWake); document.removeEventListener("visibilitychange", onWake); };
  }, [refresh]);

  // Domains available to scope/filter by: the vault's REAL domains first,
  // then any extra domains that exist only in question files or old runs
  // (so nothing is hidden, but the list always matches the actual vault).
  const questionCounts = useMemo(() => {
    const m: Record<string, number> = {};
    // Only NON-archived questions are runnable - the CLI runner skips archived
    // ones, so counting them here made a run look like it had work to do when it
    // had none (e.g. "13 career questions" that all errored to nothing).
    for (const q of questions) { if (q.archived) continue; m[q.domain] = (m[q.domain] ?? 0) + 1; }
    return m;
  }, [questions]);
  const allDomains = useMemo(() => {
    // Normalized app keys: strip everything but a-z0-9. A leading "app" is also
    // stripped so a domain like "App Google" ("appgoogle") matches an app whose
    // id/title normalizes to "google".
    const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const stripApp = (n: string) => n.replace(/^app/, "");
    const appKeys = new Set<string>();
    for (const a of apps) {
      appKeys.add(norm(a.id));
      appKeys.add(norm(a.title));
    }
    const isApp = (d: string) => {
      const n = norm(d);
      return appKeys.has(n) || appKeys.has(stripApp(n));
    };
    const vault = [...vaultDomains].sort().filter((d) => !isApp(d));
    const extra = new Set<string>();
    for (const q of questions) extra.add(q.domain);
    for (const m of matrix) for (const d of Object.keys(m.per_domain)) extra.add(d);
    for (const v of vault) extra.delete(v);
    return [...vault, ...Array.from(extra).sort().filter((d) => !isApp(d))];
  }, [vaultDomains, questions, matrix, apps]);

  // ── Run config ──────────────────────────────────────────────────
  const [mode, setMode] = useState<"single" | "council">("single");
  const [selModels, setSelModels] = useState<Set<string>>(() => new Set([`claude${MODEL_SEP}opus`]));
  const [scope, setScope] = useState<Set<string>>(
    () => new Set(initialDomain ? [initialDomain.toLowerCase()] : []),
  );
  // Live run state comes from the module-scope registry, so it survives any
  // navigation and remount. This panel surfaces the batch matching its home
  // domain when scoped, otherwise the most relevant one.
  const allBatches = useBenchBatches().filter((b) => b.vault === vaultPath);
  const homeDomain = initialDomain ? initialDomain.toLowerCase() : null;
  const matchesHome = (b: BenchBatch) =>
    !homeDomain || b.scopeKey === "" || b.scopeKey.split(",").includes(homeDomain);
  const visibleBatches = allBatches.filter(matchesHome);
  const current =
    // A RUNNING batch always surfaces (even if its scope differs from this panel's
    // home domain) - otherwise launching a run scoped to another domain looks like
    // "nothing happened". Finished batches still respect the home filter.
    [...allBatches].reverse().find((b) => b.running) ??
    [...visibleBatches].reverse().find((b) => !b.consumed) ??
    null;
  const jobs = current?.jobs ?? [];
  const running = current?.running ?? false;
  const log = current?.log ?? "";
  const activeBatch = current
    ? { label: current.label, scope: current.scopeLabel, domains: current.scopeDomains }
    : null;
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  // When a batch this panel surfaces finishes, land on the refreshed
  // leaderboard with the "batch finished" banner - once.
  useEffect(() => {
    const fin = visibleBatches.find((b) => !b.running && !b.consumed);
    if (!fin) return;
    fin.consumed = true;
    refresh();
    if (!fin.cancelled) {
      const ran = fin.jobs.filter((j) => j.status === "done").length;
      const errored = fin.jobs.filter((j) => j.status === "error").length;
      if (ran === 0 && errored > 0) {
        // Nothing produced a run. Don't flash a misleading "finished and is on
        // the board" banner - keep the user on the Run view with the per-job
        // errors visible. (Leave the batch in the registry so those errors stay
        // on screen; the next run's startup sweep clears consumed batches.)
        setErr(`Batch "${fin.label}" produced no runs: all ${errored} model${errored === 1 ? "" : "s"} errored. Open the Run tab for the per-model reason.`);
        setView("run");
        benchNotify();
        return;
      }
      setFinishedBatch(errored > 0 ? `${fin.label} - ${ran} ran, ${errored} failed` : fin.label);
      setView("board");
    }
    benchBatches.delete(fin.id);
    benchNotify();
  }, [visibleBatches, refresh]);

  const toggleModel = (cli: string, model: string) => {
    const k = `${cli}${MODEL_SEP}${model}`;
    setSelModels((cur) => {
      const next = new Set(cur);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };
  const toggleScope = (d: string) =>
    setScope((cur) => {
      const next = new Set(cur);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });

  // Execute from EXPLICIT inputs so a saved suite can run its own models+domains
  // directly, without waiting on a setState round-trip. runBenchmark() just feeds
  // it the current UI selection.
  function executeRun(modelKeys: string[], domains: Set<string>, runMode: "single" | "council") {
    const scopeStr = Array.from(domains).join(",");
    // Archived questions are excluded - the CLI runner skips them, so a run must
    // be planned only over the questions that will actually execute.
    const active = questions.filter((q) => !q.archived);
    const scoped = domains.size === 0
      ? active
      : active.filter((q) => domains.has(q.domain.toLowerCase()));
    const qids = scoped.map((q) => q.id).sort();
    if (qids.length === 0) {
      setErr(domains.size === 0
        ? "No active questions to run. Add some in the Questions tab (archived questions don't run)."
        : `No active questions in ${Array.from(domains).map(titleCase).join(", ")}. They may all be archived - add or unarchive some in the Questions tab.`);
      return;
    }
    const blankJob = { status: "queued" as BenchJobStatus, done: 0, total: qids.length, qids, qdone: {} };
    const plannedJobs: BenchJob[] =
      runMode === "council"
        ? [{ key: "council", cli: "", model: "", label: "Council", ...blankJob }]
        : modelKeys.map((k) => {
            const [cli, model] = k.split(MODEL_SEP);
            const ml = MODELS[cli]?.find((m) => m.id === model)?.label ?? model;
            return { key: k, cli, model, label: `${titleCase(cli)} · ${ml}`, ...blankJob, qdone: {} };
          });
    const runnable = isBunkerOn() ? plannedJobs.filter((j) => j.cli && isLocalCli(j.cli)) : plannedJobs;
    if (isBunkerOn() && runMode === "council") { setErr("Blocked by Bunker Mode: the Council convenes cloud models."); return; }
    if (isBunkerOn() && runnable.length < plannedJobs.length) {
      setErr(runnable.length === 0
        ? "Blocked by Bunker Mode: pick a local model (Ollama, LM Studio, oMLX)."
        : "Cloud models were skipped (Blocked by Bunker Mode).");
      if (runnable.length === 0) return;
    }
    if (runnable.length === 0) { setErr("Pick at least one model to run."); return; }
    void executeBenchBatch(vaultPath, runnable, runMode === "council", scopeStr);
  }
  async function runBenchmark() {
    executeRun(Array.from(selModels), scope, mode);
  }
  // Run a saved suite: reflect its selection in the UI (so the panel shows what
  // ran) AND execute it immediately from the suite's own values.
  function runSuite(s: { mode: "single" | "council"; models: string[]; domains: string[] }) {
    setMode(s.mode);
    setSelModels(new Set(s.models));
    // A council is models-only; benchmark it against the CURRENT domain scope
    // (fall back to the council's own saved domains for legacy suites).
    const doms = s.domains.length ? new Set(s.domains) : scope;
    setScope(doms);
    executeRun(s.models, doms, s.mode);
  }
  const applyModels = (keys: string[]) => setSelModels(new Set(keys));
  const applyScope = (domains: string[]) => setScope(new Set(domains));

  // Rebuild a runnable job from a stored run. Runs since the rerun fix carry
  // meta.json (exact cli/model/council); older runs fall back to parsing the
  // label.
  function jobFromRun(r: BenchmarkRun, key: string): { job: BenchJob; council: boolean } | null {
    const stripped = r.label.replace(/^\d{4}-\d{2}-\d{2}[_ ]/, "").trim();
    let council = /^council\b/i.test(stripped);
    let cli = "";
    let modelId = "";
    if (r.council) {
      council = true;
    } else if (r.cli) {
      cli = r.cli;
      modelId = r.model ?? "";
    } else if (!council) {
      const known = ["claude", "codex", "antigravity", "ollama", "openrouter", "lmstudio"];
      for (const k of known) {
        if (stripped === k) { cli = k; break; }
        if (stripped.toLowerCase().startsWith(k + "-")) { cli = k; modelId = stripped.slice(k.length + 1); break; }
      }
      if (!cli) return null;
    }
    const label = council ? "Council" : `${titleCase(cli)} · ${modelLabel(cli, modelId) || modelId || "default"}`;
    const domSet = new Set(r.domains.map((d) => d.toLowerCase()));
    const qids = questions.filter((q) => domSet.size === 0 || domSet.has(q.domain.toLowerCase())).map((q) => q.id).sort();
    return {
      job: { key, cli, model: modelId, label, status: "queued", done: 0, total: qids.length || r.questions, qids, qdone: {} },
      council,
    };
  }

  // Rerun a past run as-is: the same model (or council) against the same
  // domain scope, as a fresh dated run.
  async function rerunRun(r: BenchmarkRun) {
    const built = jobFromRun(r, `rerun-${Date.now()}`);
    if (!built) { setErr(`Can't rerun: unrecognized run label "${r.label}"`); return; }
    setView("run");
    void executeBenchBatch(vaultPath, [built.job], built.council, r.domains.join(","));
  }

  // CONTINUE a whole BATCH: pick up where an interrupted batch left off.
  // Re-launches every model in the batch under the ORIGINAL batch id, so the
  // engine resumes into the existing run directories - it skips the questions
  // each model already answered and runs only the missing/errored ones, then
  // re-scores. No questions are regenerated, no completed answers re-run, no
  // tokens re-burned on finished work. This is the "come back and finish it"
  // path for a big batch.
  async function continueBatch(batchRuns: BenchmarkRun[]) {
    const batchId = batchRuns.find((r) => r.batch_id)?.batch_id;
    if (!batchId) { setErr("Can't continue: this group predates batch tracking. Use rerun instead."); return; }
    const builds = batchRuns
      .map((r, i) => ({ r, built: jobFromRun(r, `continue-${Date.now()}-${i}`) }))
      .filter((x): x is { r: BenchmarkRun; built: NonNullable<ReturnType<typeof jobFromRun>> } => x.built !== null);
    if (builds.length === 0) { setErr("Can't continue this batch: no recognizable runs."); return; }
    const seen = new Set<string>();
    const jobs = builds.filter(({ built }) => {
      const k = `${built.job.cli}::${built.job.model}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const council = jobs.some(({ built }) => built.council);
    setView("run");
    const scope = Array.from(new Set(batchRuns.flatMap((r) => r.domains))).join(",");
    // Pass the original batch id: executeBenchBatch reuses it, so the engine
    // resumes the existing run dirs rather than minting fresh ones.
    void executeBenchBatch(vaultPath, jobs.map(({ built }) => built.job), council, scope, batchId);
  }

  // Rerun a whole BATCH: every model that ran together, together again.
  async function rerunBatch(batchRuns: BenchmarkRun[]) {
    const builds = batchRuns
      .map((r, i) => ({ r, built: jobFromRun(r, `rerun-${Date.now()}-${i}`) }))
      .filter((x): x is { r: BenchmarkRun; built: NonNullable<ReturnType<typeof jobFromRun>> } => x.built !== null);
    if (builds.length === 0) { setErr("Can't rerun this batch: no recognizable runs."); return; }
    // Dedup models (a batch should not double-run the same model).
    const seen = new Set<string>();
    const jobs = builds.filter(({ built }) => {
      const k = `${built.job.cli}::${built.job.model}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const council = jobs.some(({ built }) => built.council);
    setView("run");
    // Scope = the UNION of every run's domains, not just the first run's. The
    // first run can be an errored/empty run with no recorded domains, which
    // would otherwise scope the whole rerun to "" (all domains) or drop it.
    const scope = Array.from(new Set(batchRuns.flatMap((r) => r.domains))).join(",");
    void executeBenchBatch(vaultPath, jobs.map(({ built }) => built.job), council, scope);
  }

  // Arena navigation, in the mockups' order. A left rail (section nav) sits
  // inside the panel, distinct from the app's global sidebar, with a DOMAINS
  // section below it (the domain filter for Leaderboard + History).
  const NAV: Array<{ id: typeof view; label: string; icon: LucideIcon }> = [
    { id: "run", label: "Run", icon: Sparkles },
    { id: "board", label: "Leaderboard", icon: Crown },
    { id: "frontier", label: "Chart", icon: LineChart },
    { id: "history", label: "History", icon: Activity },
    { id: "matrix", label: "Model × domain", icon: Layers },
    { id: "questions", label: "Questions", icon: FileText },
    { id: "scout", label: "Scout", icon: BrainCircuit },
    { id: "schedule", label: "Schedule", icon: CalendarClock },
  ];
  const HEAD: Record<typeof view, { title: string; subtitle: string }> = {
    run: { title: "New Run", subtitle: "Configure your benchmark to compare models across domains and questions." },
    board: { title: "Leaderboard", subtitle: "Compare model performance across domains and find your top performers." },
    frontier: { title: "Chart", subtitle: "Visual analytics. Explore model performance across intelligence, cost, and speed." },
    history: { title: "History", subtitle: "Review and analyze past benchmark runs and model performance." },
    matrix: { title: "Model × domain", subtitle: "Compare model performance across domains to spot strengths, weaknesses, and opportunities." },
    questions: { title: "Questions", subtitle: "Curate, evaluate, and manage your benchmark question bank." },
    scout: { title: "Scout", subtitle: "Discover and evaluate the best models for your use cases." },
    schedule: { title: "Schedule", subtitle: "Plan and automate benchmark runs with confidence." },
  };
  const showDomains = !initialDomain && allDomains.length > 0 && (view === "board" || view === "history");
  return (
    <div className="flex h-full">
      {/* Left section-nav rail (mockups' navigation), with a DOMAINS filter.
          Collapsible to an icon-only strip; the choice persists in localStorage. */}
      <nav className={`flex shrink-0 flex-col border-r border-border-subtle bg-surface-warm/30 transition-all ${navCollapsed ? "w-12" : "w-52"}`}>
        <div className={`flex items-center gap-2 py-4 ${navCollapsed ? "flex-col px-2" : "px-4"}`}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent font-display text-sm font-bold text-background">A</span>
          {!navCollapsed && <span className="font-display text-base font-bold tracking-tight text-text-primary">Arena</span>}
          {!navCollapsed && initialDomain && <span className="ml-auto rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] text-accent" title={`Scoped to ${titleCase(initialDomain)}`}>{titleCase(initialDomain)}</span>}
          <button
            onClick={() => setNavCollapsed((c) => !c)}
            title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-warm hover:text-text-primary ${navCollapsed ? "" : "ml-auto"}`}
          >
            {navCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto pb-3 ${navCollapsed ? "px-1.5" : "px-2"}`}>
          <div className="space-y-0.5">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                title={navCollapsed ? label : undefined}
                className={`flex w-full items-center rounded-lg text-left text-[13px] transition-colors ${
                  navCollapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-1.5"
                } ${
                  view === id
                    ? "bg-surface font-semibold text-accent shadow-sm ring-1 ring-black/5"
                    : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!navCollapsed && <span className="truncate">{label}</span>}
              </button>
            ))}
          </div>
          {!navCollapsed && showDomains && (
            <div className="mt-5">
              <div className="px-2.5 pb-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted/60">Domains</div>
              <div className="space-y-0.5">
                <button
                  onClick={() => setDomainFilter("all")}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-left text-[12px] transition-colors ${domainFilter === "all" ? "bg-accent font-semibold text-background" : "text-text-secondary hover:bg-surface-warm"}`}
                >
                  <Layers className="h-3.5 w-3.5 shrink-0" /> All
                </button>
                {allDomains.map((d) => {
                  const Icon = domainIcon(d) ?? Circle;
                  const on = domainFilter === d;
                  return (
                    <button
                      key={d}
                      onClick={() => setDomainFilter(d)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-left text-[12px] transition-colors ${on ? "bg-accent font-semibold text-background" : "text-text-secondary hover:bg-surface-warm"}`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{titleCase(d)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Content column: the per-view header + the routed view + footer. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {err && <div className="mx-8 mt-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-8 pt-6">
            <ArenaHeader
              title={HEAD[view].title}
              subtitle={HEAD[view].subtitle}
              actions={
                view === "run" ? null : (
                  <button onClick={() => setView("run")} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover">
                    <Plus className="h-3.5 w-3.5" /> New Run
                  </button>
                )
              }
            />
          </div>
        {view === "run" && (
          <BenchRunConfig
            mode={mode} setMode={setMode}
            selModels={selModels} toggleModel={toggleModel}
            allDomains={allDomains} scope={scope} toggleScope={toggleScope} scoped={!!initialDomain}
            applyModels={applyModels} applyScope={applyScope} onRunSuite={runSuite}
            questionCounts={questionCounts}
            questionCount={
              scope.size === 0
                ? questions.filter((q) => !q.archived).length
                : questions.filter((q) => !q.archived && scope.has(q.domain.toLowerCase())).length
            }
            running={running} jobs={jobs} log={log} logRef={logRef}
            activeBatch={activeBatch}
            onRun={runBenchmark}
            onViewResults={() => setView("board")}
            onReset={() => { if (current && !current.running) { benchBatches.delete(current.id); benchNotify(); } }}
            onCancel={current?.running ? () => void cancelBenchBatch(current.id) : undefined}
            onCrumbHome={() => setView("board")}
          />
        )}
        {view === "scout" && (
          <div className="px-8 pb-6">
            <ModelScoutSuggestions vaultPath={vaultPath} />
          </div>
        )}
        {view === "schedule" && (
          <div className="px-8 pb-6">
            <BenchScheduleCard vault={vaultPath} />
          </div>
        )}
        {(view === "board" || view === "history" || view === "matrix" || view === "frontier") && (
          <BenchResults
            view={view}
            domainFilter={view === "matrix" ? "all" : domainFilter}
            runs={runs} matrix={matrix} allDomains={allDomains} vaultPath={vaultPath}
            initialModel={initialModel} currentDomain={initialDomain} onChanged={refresh}
            onRerun={(r) => void rerunRun(r)}
            onRerunBatch={(rs) => void rerunBatch(rs)}
            onContinueBatch={(rs) => void continueBatch(rs)}
            finishedBatch={finishedBatch}
            onViewBatch={() => { setView("history"); setFinishedBatch(null); }}
            onDismissBanner={() => setFinishedBatch(null)}
            onCrumbHome={() => setView("run")}
            onClearDomain={() => setDomainFilter("all")}
          />
        )}
        {view === "questions" && (
          <BenchQuestions
            vaultPath={vaultPath} questions={questions} allDomains={allDomains}
            initialDomain={initialDomain}
            onChanged={refresh}
          />
        )}
      </div>
      {/* Consistent footer across every Arena tab: a one-line read of the eval's
          state - models tested, runs, the leaderboard leader, and the auto-run
          schedule (which links to the Schedule tab). */}
      {(() => {
        const modelCount = new Set(runs.map((r) => { const p = parseRunLabel(r.label); return `${p.vendor}::${p.model || r.label}`; })).size;
        const lastDate = runs.reduce((a, r) => (r.date > a ? r.date : a), "");
        const leader = [...runs].filter((r) => r.judge_avg != null).sort((a, b) => (b.judge_avg ?? -1) - (a.judge_avg ?? -1))[0];
        const leaderModel = leader ? parseRunLabel(leader.label).model : null;
        const schedOn = lsGet(BENCH_SCHED.enabled, "0") === "1";
        return (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle bg-surface-warm/40 px-4 py-2 font-mono text-[10px] text-text-muted">
            <span>{modelCount} model{modelCount === 1 ? "" : "s"} · {runs.length} run{runs.length === 1 ? "" : "s"}{lastDate ? ` · last ${lastDate}` : ""}</span>
            {leaderModel && <span className="inline-flex items-center gap-1"><Crown className="h-3 w-3 text-accent" /> {leaderModel} {leader?.judge_avg?.toFixed(1)}</span>}
            <button onClick={() => setView("schedule")} className="ml-auto inline-flex items-center gap-1.5 hover:text-accent" title="Auto-run schedule (Schedule tab)">
              <span className={`h-1.5 w-1.5 rounded-full ${schedOn ? "bg-ok" : "bg-text-muted/40"}`} />
              auto-runs {schedOn ? benchFreqLabel(lsGet(BENCH_SCHED.freq, "weekly") || "weekly") : "off"}
            </button>
          </div>
        );
      })()}
      </div>
    </div>
  );
}
