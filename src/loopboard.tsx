// Loop Board — the cross-domain view of every standing loop, the mirror of the
// Work Board for tasks. See all loops across domains, filter by domain, see what's
// running / scheduled next, run one now, toggle it, or jump into its domain to
// edit. Loops are also editable per-domain (the Loops tab); this is the bird's-eye.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowDownAZ, CalendarClock, Check, ChevronDown, Infinity as InfinityIcon, Layers, Loader2, Mail, Pencil, Play, RefreshCw, Repeat, Search, Trash2 } from "lucide-react";
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
  const [sort, setSort] = useState<"schedule" | "name" | "domain">("schedule");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [grouped, setGrouped] = useState(true);
  // Click the active sort again to flip direction; a new sort starts ascending.
  const pickSort = (k: "schedule" | "name" | "domain") => {
    if (k === sort) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(k); setSortDir("asc"); }
  };
  const [running, setRunning] = useState<string | null>(null);
  // Click a row to expand its detail (full meta + edit/archive/delete), so the
  // collapsed rows can stay minimal. `confirmId` gates the destructive delete.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  // Domain filter popover (scales to any number of domains: searchable + scrollable).
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [filterOpen]);
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
  const countFor = useCallback((d: string) => rows.filter((r) => r.domain === d).length, [rows]);
  // When a loop next runs, as a sortable number: an enabled, never-run loop is due
  // now (0 -> top); a paused/disabled loop has no schedule (Infinity -> bottom).
  const nextRunMs = useCallback((r: Row): number => {
    if (!r.loop.enabled || r.loop.status !== "active") return Infinity;
    if (!r.loop.lastRunTs) return 0;
    return r.loop.lastRunTs + (CADENCE_MS[r.loop.cadence] ?? 6048e5);
  }, []);
  const sortRows = useCallback((a: Row, b: Row): number => {
    const base = sort === "name"
      ? a.loop.name.localeCompare(b.loop.name)
      : sort === "domain"
        ? (a.domain.localeCompare(b.domain) || a.loop.name.localeCompare(b.loop.name))
        : (nextRunMs(a) - nextRunMs(b) || a.loop.name.localeCompare(b.loop.name)); // schedule
    return sortDir === "asc" ? base : -base;
  }, [sort, sortDir, nextRunMs]);
  const shown = useMemo(
    () => rows.filter((r) => domainFilter === "all" || r.domain === domainFilter).slice().sort(sortRows),
    [rows, domainFilter, sortRows],
  );
  // When grouped, the chosen sort must apply WITHIN each domain group AND order
  // the groups themselves, so toggling asc/desc reorders coherently instead of
  // looking like one flat list got re-sorted. Group order follows the active
  // sort: by soonest next-run for "schedule", else by domain name — both honoring
  // the direction. (Items within a group already come from the sorted `shown`.)
  const orderedDomains = useMemo(() => {
    const ds = domains.filter((d) => shown.some((r) => r.domain === d));
    const soonest = (d: string) => Math.min(...shown.filter((r) => r.domain === d).map(nextRunMs));
    ds.sort((a, b) => {
      const base = sort === "schedule" ? (soonest(a) - soonest(b) || a.localeCompare(b)) : a.localeCompare(b);
      return sortDir === "asc" ? base : -base;
    });
    return ds;
  }, [domains, shown, sort, sortDir, nextRunMs]);

  // A loop reads as "running" if a live loop process names it (domain + loop name).
  const isRunning = (r: Row) => procs.some((p) => p.kind === "loop" && (p.domain ?? "") === r.domain && p.label.includes(r.loop.name));

  const toggleEnabled = async (r: Row, on: boolean) => {
    const doc = ensureBriefingLoop(await readLoops(r.domainPath), r.domain).doc;
    await writeLoops(r.domainPath, { ...doc, loops: doc.loops.map((l) => (l.id === r.loop.id ? { ...l, enabled: on } : l)) });
    load();
  };

  // Archive = set the loop's status to "done" (drops out of the active set but is
  // preserved). Delete = remove it from its domain's loops doc entirely.
  const archiveLoop = async (r: Row) => {
    setActing(`${r.domain}:${r.loop.id}`);
    try {
      const doc = ensureBriefingLoop(await readLoops(r.domainPath), r.domain).doc;
      await writeLoops(r.domainPath, { ...doc, loops: doc.loops.map((l) => (l.id === r.loop.id ? { ...l, status: "done" as const, enabled: false } : l)) });
      setExpandedId(null);
      load();
    } catch (e) { console.error("archive loop", e); }
    finally { setActing(null); }
  };
  const deleteLoop = async (r: Row) => {
    setActing(`${r.domain}:${r.loop.id}`);
    try {
      const doc = ensureBriefingLoop(await readLoops(r.domainPath), r.domain).doc;
      await writeLoops(r.domainPath, { ...doc, loops: doc.loops.filter((l) => l.id !== r.loop.id) });
      setConfirmId(null); setExpandedId(null);
      load();
    } catch (e) { console.error("delete loop", e); }
    finally { setActing(null); }
  };

  const runNow = async (r: Row) => {
    const key = `${r.domain}:${r.loop.id}`;
    setRunning(key);
    const procId = `loop-${r.loop.id}-${Date.now()}`;
    startProcess(procId, "loop", `${titleCase(r.domain)} · ${r.loop.name}`, r.domain);
    try {
      const provider = (r.loop.executor && r.loop.executor.trim()) || getPref(PREF.memoryProvider, "claude");
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

  // One loop row, shared by the grouped + flat layouts. Collapsed rows stay
  // deliberately sparse (name + a quiet next-run + run + toggle); the cadence,
  // autonomy, status, last-run, and the Edit/Archive/Delete actions live in the
  // click-to-expand detail so the board reads cleanly instead of as a text wall.
  const renderRow = (r: Row, showDomain: boolean) => {
    const id = `${r.domain}:${r.loop.id}`;
    const run = isRunning(r);
    const nr = nextRunMs(r);
    const nextLabel = nr === 0 ? "due now" : nr === Infinity ? "" : new Date(nr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const busy = running === id;
    const isExpanded = expandedId === id;
    const isActing = acting === id;
    const dot = r.loop.status === "done" ? "#9aa0a6" : r.loop.status === "paused" ? "#d9a441" : "#0d7a6e";
    const lastRun = r.rt?.history?.[r.rt.history.length - 1];
    return (
      <div key={id} className={r.loop.enabled ? "" : "opacity-55"}>
        <div className={`group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-warm/60 ${isExpanded ? "bg-surface-warm/60" : ""}`}>
          <button onClick={() => setExpandedId(isExpanded ? null : id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" title="Show details">
            <ChevronDown className={`h-3 w-3 shrink-0 text-text-muted/50 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} title={r.loop.status} />
            <span className="truncate text-[13px] font-medium text-text-primary">{r.loop.name}</span>
            {r.loop.kind === "briefing"
              ? <Mail className="h-3 w-3 shrink-0 text-accent" />
              : r.loop.type === "open" && <InfinityIcon className="h-3 w-3 shrink-0 text-text-muted/40" />}
            {run && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />}
          </button>
          {showDomain && <span className="hidden shrink-0 text-[11px] text-text-muted sm:inline">{titleCase(r.domain)}</span>}
          {nextLabel && <span className={`hidden w-14 shrink-0 text-right text-[11px] lg:inline ${nextLabel === "due now" ? "text-accent" : "text-text-muted/70"}`}>{nextLabel}</span>}
          <button onClick={() => runNow(r)} disabled={busy || run} title="Run now"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <Toggle on={r.loop.enabled} onChange={(v) => toggleEnabled(r, v)} label={`${r.loop.name} enabled`} />
        </div>
        {isExpanded && (
          <div className="border-t border-border-subtle bg-surface-warm/20 px-3 py-3 pl-8">
            <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
              <span className="text-text-secondary">{titleCase(r.domain)}</span>
              <span>· {CADENCE_LABEL[r.loop.cadence]}</span>
              {r.loop.kind !== "briefing" && <span>· {AUTONOMY_LABEL[r.loop.autonomy ?? "ask"]}</span>}
              <span>· {r.loop.status}</span>
              {nextLabel && <span>· next {nextLabel}</span>}
              {lastRun && <span>· last run {new Date(lastRun.ts).toLocaleDateString()}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => runNow(r)} disabled={busy || run}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run now
              </button>
              <button onClick={() => openInDomain(r)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:border-accent-border hover:text-accent">
                <Pencil className="h-3 w-3" /> Edit in domain
              </button>
              <button onClick={() => archiveLoop(r)} disabled={isActing || r.loop.status === "done"}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
                <Archive className="h-3 w-3" /> {r.loop.status === "done" ? "Archived" : "Archive"}
              </button>
              {confirmId === id ? (
                <span className="inline-flex items-center gap-2">
                  <button onClick={() => deleteLoop(r)} disabled={isActing}
                    className="inline-flex items-center gap-1.5 rounded-md border border-err/50 bg-err/10 px-2.5 py-1 text-[11px] text-err hover:bg-err/20 disabled:opacity-50">
                    {isActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Confirm delete
                  </button>
                  <button onClick={() => setConfirmId(null)} className="text-[11px] text-text-muted hover:text-text-secondary">cancel</button>
                </span>
              ) : (
                <button onClick={() => setConfirmId(id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted hover:border-err hover:text-err">
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <SettingsHeader icon={Repeat} title="Loop Board"
        subtitle="Every standing loop across your domains - the mirror of the Work Board for tasks. See what's running, when each runs next, run one now, or jump into its domain to edit." />
      {/* Toolbar: a compact searchable domain filter (scales to any count) + sort
          + grouping + refresh, all on one line. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <div ref={filterRef} className="relative">
          <button onClick={() => setFilterOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium transition-colors ${domainFilter !== "all" ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-secondary hover:bg-surface-warm"}`}>
            <Layers className="h-3.5 w-3.5" /> {domainFilter === "all" ? "All domains" : titleCase(domainFilter)}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
          {filterOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
              <div className="flex items-center gap-1.5 border-b border-border-subtle px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <input autoFocus value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} placeholder="Filter domains…"
                  className="w-full bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted" />
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {[{ name: "all", count: rows.length }, ...domains.map((d) => ({ name: d, count: countFor(d) }))]
                  .filter((o) => o.name === "all" || o.name.toLowerCase().includes(filterQuery.trim().toLowerCase()))
                  .map((o) => (
                    <button key={o.name} onClick={() => { setDomainFilter(o.name); setFilterOpen(false); setFilterQuery(""); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-warm">
                      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-accent">{domainFilter === o.name && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                      <span className="flex-1 truncate text-text-primary">{o.name === "all" ? "All domains" : titleCase(o.name)}</span>
                      <span className="shrink-0 font-mono text-[10px] text-text-muted">{o.count}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Sort</span>
        <div className="flex items-center overflow-hidden rounded-lg border border-border">
          {([["schedule", "Next run", CalendarClock], ["name", "Name", ArrowDownAZ], ["domain", "Domain", Layers]] as const).map(([k, lbl, Icon], i) => (
            <button key={k} onClick={() => pickSort(k)} aria-pressed={sort === k}
              title={sort === k ? `Sorted ${sortDir === "asc" ? "ascending" : "descending"} - click to reverse` : `Sort by ${lbl.toLowerCase()}`}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 font-medium transition-colors ${i > 0 ? "border-l border-border" : ""} ${sort === k ? "bg-accent text-background" : "bg-background text-text-secondary hover:bg-surface-warm"}`}>
              <Icon className="h-3.5 w-3.5" /> {lbl}
              {sort === k && <ChevronDown className={`h-3 w-3 transition-transform ${sortDir === "desc" ? "rotate-180" : ""}`} />}
            </button>
          ))}
        </div>
        <button onClick={() => setGrouped((g) => !g)} aria-pressed={grouped} title={grouped ? "Grouped by domain - click to ungroup" : "Group loops by domain"}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium transition-colors ${grouped ? "border-accent bg-accent text-background shadow-sm" : "border-border bg-background text-text-secondary hover:bg-surface-warm"}`}>
          {grouped ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Layers className="h-3.5 w-3.5" />} Group by domain
        </button>
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
      ) : grouped ? (
        // Grouped by domain: a domain header + count, then a tight divided list.
        <div className="flex flex-col gap-5">
          {orderedDomains.map((d) => {
            const items = shown.filter((r) => r.domain === d);
            return (
              <section key={d}>
                <div className="mb-1.5 flex items-baseline gap-2 px-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">{titleCase(d)}</span>
                  <span className="font-mono text-[10px] text-text-muted">{items.length}</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-border-subtle divide-y divide-border-subtle">
                  {items.map((r) => renderRow(r, false))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        // Flat: one list in the chosen sort order (e.g. soonest-to-run first), each
        // row carrying its domain chip.
        <div className="overflow-hidden rounded-xl border border-border-subtle divide-y divide-border-subtle">
          {shown.map((r) => renderRow(r, true))}
        </div>
      )}
    </>
  );
}
