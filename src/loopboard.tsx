// Loop Board — the cross-domain view of every standing loop, the mirror of the
// Work Board for tasks. See all loops across domains, filter by domain, see what's
// running / scheduled next, run one now, toggle it, or jump into its domain to
// edit. Loops are also editable per-domain (the Loops tab); this is the bird's-eye.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Infinity as InfinityIcon, Loader2, Mail, Play, RefreshCw, Repeat } from "lucide-react";
import { invoke } from "./bridge";
import { SettingsHeader } from "./sectionutil";
import { titleCase } from "./format";
import { PREF, getPref } from "./storage";
import { startProcess, endProcess, useProcesses } from "./processes";
import { Toggle } from "./ui";
import {
  AUTONOMY_LABEL, CADENCE_LABEL, type Loop, type LoopsRuntime,
  ensureBriefingLoop, readLoops, readLoopsRuntime, writeLoops,
} from "./loops";

type Row = { domain: string; domainPath: string; loop: Loop; rt?: LoopsRuntime["loops"][string] };

const CADENCE_MS: Record<string, number> = { continuous: 3600e3, daily: 864e5, weekly: 6048e5, monthly: 2592e6 };

export function LoopBoard({ vaultPath }: { vaultPath: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [domainFilter, setDomainFilter] = useState("all");
  const [running, setRunning] = useState<string | null>(null);
  const procs = useProcesses();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ds = await invoke<{ name: string; path: string }[]>("scan_vault", { path: vaultPath }).catch(() => []);
      const list = Array.isArray(ds) ? ds : [];
      // General lives at data/domains/general on a v4 vault, else the root.
      const v4 = list.some((d) => d.path.replace(/\\/g, "/").includes("/data/domains/"));
      const genPath = v4 ? `${vaultPath.replace(/\/+$/, "")}/data/domains/general` : vaultPath;
      const targets = [{ name: "general", path: genPath }, ...list];
      const out: Row[] = [];
      for (const d of targets) {
        try {
          const doc = ensureBriefingLoop(await readLoops(d.path), d.name).doc;
          const rt = await readLoopsRuntime(d.path);
          for (const loop of doc.loops) out.push({ domain: d.name, domainPath: d.path, loop, rt: rt.loops[loop.id] });
        } catch { /* skip a domain that fails to read */ }
      }
      setRows(out);
    } finally { setLoading(false); }
  }, [vaultPath]);

  useEffect(() => {
    load();
    const f = () => load();
    window.addEventListener("prevail:loops-advanced", f);
    return () => window.removeEventListener("prevail:loops-advanced", f);
  }, [load]);

  const domains = useMemo(() => [...new Set(rows.map((r) => r.domain))].sort(), [rows]);
  const shown = useMemo(() => rows.filter((r) => domainFilter === "all" || r.domain === domainFilter), [rows, domainFilter]);

  // A loop reads as "running" if a live loop process names it (domain + loop name).
  const isRunning = (r: Row) => procs.some((p) => p.kind === "loop" && (p.domain ?? "") === r.domain && p.label.includes(r.loop.name));

  const toggleEnabled = async (r: Row, on: boolean) => {
    const doc = ensureBriefingLoop(await readLoops(r.domainPath), r.domain).doc;
    await writeLoops(r.domainPath, { ...doc, loops: doc.loops.map((l) => (l.id === r.loop.id ? { ...l, enabled: on } : l)) });
    load();
  };

  const runNow = async (r: Row) => {
    const key = `${r.domain}:${r.loop.id}`;
    setRunning(key);
    const procId = `loop-${r.loop.id}-${Date.now()}`;
    startProcess(procId, "loop", `${titleCase(r.domain)} · ${r.loop.name}`, r.domain);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = (r.loop.model && r.loop.model.trim()) || getPref(PREF.distillModel, "claude-haiku-4-5");
      await invoke("loop_run_now", { vault: vaultPath, domain: r.domain, loopId: r.loop.id, provider, model });
      window.dispatchEvent(new Event("prevail:loops-advanced"));
      window.dispatchEvent(new Event("prevail:tasks-changed"));
    } catch (e) { console.error("loop run now", e); }
    finally { setRunning(null); endProcess(procId); load(); }
  };

  const openInDomain = (r: Row) => {
    window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: r.domain === "general" ? "" : r.domain }));
    window.dispatchEvent(new CustomEvent("prevail:domain-tab", { detail: "loops" }));
  };

  const activeCount = rows.filter((r) => r.loop.enabled && r.loop.status === "active").length;

  return (
    <>
      <SettingsHeader icon={Repeat} title="Loop Board"
        subtitle="Every standing loop across your domains - the mirror of the Work Board for tasks. See what's running, when each runs next, run one now, or jump into its domain to edit." />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-text-secondary">
          <option value="all">All domains</option>
          {domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
        </select>
        <span className="font-mono text-[11px] text-text-muted">{shown.length} loop{shown.length === 1 ? "" : "s"} · {activeCount} active</span>
        <button onClick={load} disabled={loading} title="Refresh"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="text-sm text-text-muted">loading loops…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">No loops yet. Open a domain's Loops tab to add some.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {shown.map((r) => {
            const run = isRunning(r);
            const nextRun = r.loop.enabled && r.loop.status === "active" && r.loop.lastRunTs
              ? new Date(r.loop.lastRunTs + (CADENCE_MS[r.loop.cadence] ?? 6048e5)) : null;
            const busy = running === `${r.domain}:${r.loop.id}`;
            const dot = r.loop.status === "done" ? "#9aa0a6" : r.loop.status === "paused" ? "#d9a441" : "#0d7a6e";
            return (
              <div key={`${r.domain}:${r.loop.id}`} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
                <button onClick={() => openInDomain(r)} className="min-w-0 flex-1 text-left" title="Open in its domain to edit">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-text-primary">{r.loop.name}</span>
                    {r.loop.kind === "briefing"
                      ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent"><Mail className="h-2.5 w-2.5" /> briefing</span>
                      : r.loop.type === "open" && <InfinityIcon className="h-3 w-3 shrink-0 text-text-muted/60" />}
                    {run && <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-accent"><Loader2 className="h-2.5 w-2.5 animate-spin" /> running</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-text-muted">
                    <span className="rounded-full bg-surface-warm px-1.5 py-px text-text-secondary">{titleCase(r.domain)}</span>
                    <span>{CADENCE_LABEL[r.loop.cadence]}</span>
                    {r.loop.kind !== "briefing" && <span className="text-accent/80">{AUTONOMY_LABEL[r.loop.autonomy ?? "ask"]}</span>}
                    {nextRun && <span title="Next scheduled run">next ~{nextRun.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                  </div>
                </button>
                <button onClick={() => runNow(r)} disabled={busy || run} title="Run this loop now"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run
                </button>
                <Toggle on={r.loop.enabled} onChange={(v) => toggleEnabled(r, v)} label={`${r.loop.name} enabled`} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
