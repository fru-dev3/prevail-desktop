// System Activity (Settings -> Automation): one feed of everything Prevail does
// on its own. "Running now" is live (the in-memory process registry); the
// history below is the persistent ledger the engine appends to
// (_meta/activity.jsonl) - loop runs, executed approvals, tasks filed by loops,
// briefings, app syncs. Full transparency into the autonomous system, at scale.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ListPlus, Loader2, Mail, RefreshCw, RotateCw, Zap, Repeat, Bell } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase, relTime } from "./format";
import { useProcesses } from "./processes";

type ActivityType = "loop_run" | "loop_exec" | "task_filed" | "briefing" | "sync" | "nudge" | "other";
interface ActivityEvent {
  ts: number;
  type: ActivityType;
  domain?: string;
  title: string;
  detail?: string;
  status?: "ok" | "error" | "pending";
  ref?: string;
}

const TYPE_META: Record<ActivityType, { label: string; icon: typeof Activity; tint: string }> = {
  loop_run:   { label: "Loop run",   icon: Repeat,   tint: "text-accent" },
  loop_exec:  { label: "Executed",   icon: Zap,      tint: "text-warn" },
  task_filed: { label: "Task filed", icon: ListPlus, tint: "text-ok" },
  briefing:   { label: "Briefing",   icon: Mail,     tint: "text-accent" },
  sync:       { label: "App sync",   icon: RotateCw, tint: "text-text-secondary" },
  nudge:      { label: "Nudge",      icon: Bell,     tint: "text-text-secondary" },
  other:      { label: "Event",      icon: Activity, tint: "text-text-muted" },
};

const FILTERS: { id: ActivityType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "loop_run", label: "Loop runs" },
  { id: "loop_exec", label: "Executed" },
  { id: "task_filed", label: "Tasks" },
  { id: "briefing", label: "Briefings" },
  { id: "sync", label: "Syncs" },
];

export function SystemActivity({ vaultPath }: { vaultPath: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<ActivityType | "all">("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const live = useProcesses();

  const load = useCallback(async () => {
    try {
      const rows = await invoke<ActivityEvent[]>("activity_read", { vault: vaultPath, limit: 400 });
      setEvents(Array.isArray(rows) ? rows : []);
    } catch { setEvents([]); }
    finally { setLoading(false); }
  }, [vaultPath]);

  useEffect(() => {
    load();
    // Refresh when the system reports it did something, plus a slow poll so
    // background daemon activity shows up without a manual reload.
    const onChange = () => load();
    window.addEventListener("prevail:loops-advanced", onChange);
    window.addEventListener("prevail:tasks-changed", onChange);
    const iv = window.setInterval(load, 15000);
    return () => {
      window.removeEventListener("prevail:loops-advanced", onChange);
      window.removeEventListener("prevail:tasks-changed", onChange);
      window.clearInterval(iv);
    };
  }, [load]);

  const domains = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) if (e.domain) s.add(e.domain);
    return [...s].sort();
  }, [events]);

  const shown = useMemo(() => events.filter((e) =>
    (typeFilter === "all" || e.type === typeFilter) &&
    (domainFilter === "all" || e.domain === domainFilter),
  ), [events, typeFilter, domainFilter]);

  return (
    <div className="w-full space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">Activity</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Everything Prevail does on its own, across every domain: loop runs, executed approvals, tasks filed, briefings, and app syncs. Full transparency into the autonomous system.
          </p>
        </div>
        <button onClick={load} disabled={loading} title="Refresh"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Running now - the live, in-flight processes (not yet in history). */}
      <section>
        <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Running now</div>
        {live.length === 0 ? (
          <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2.5 text-xs text-text-muted">Nothing running right now.</div>
        ) : (
          <ul className="space-y-1.5">
            {live.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/20 px-3 py-2">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                <span className="flex-1 truncate text-[13px] text-text-primary">{p.label}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">{p.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setTypeFilter(f.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${typeFilter === f.id ? "bg-accent-soft text-accent" : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"}`}>
              {f.label}
            </button>
          ))}
        </div>
        {domains.length > 0 && (
          <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-text-secondary">
            <option value="all">All domains</option>
            {domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
          </select>
        )}
        <span className="ml-auto font-mono text-[10px] text-text-muted">{shown.length} event{shown.length === 1 ? "" : "s"}</span>
      </div>

      {/* History feed */}
      <section>
        <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">History</div>
        {loading ? (
          <div className="text-sm text-text-muted">loading activity…</div>
        ) : shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-text-secondary">
            No activity recorded yet. Loop runs, executed approvals, and briefings will appear here as they happen.
          </div>
        ) : (
          <ul className="space-y-0 border-l border-border-subtle pl-4">
            {shown.map((e, i) => {
              const m = TYPE_META[e.type] ?? TYPE_META.other;
              const Icon = m.icon;
              return (
                <li key={`${e.ts}-${i}`} className="relative pb-3.5 last:pb-0">
                  <span className={`absolute -left-[21px] top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface ring-2 ring-surface ${e.status === "error" ? "text-danger" : m.tint}`}>
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-text-muted">
                    <span className={m.tint}>{m.label}</span>
                    {e.domain && <span className="rounded bg-surface-warm px-1.5 py-0.5 text-text-secondary">{titleCase(e.domain)}</span>}
                    <span>{relTime(e.ts)}</span>
                    {e.status === "error" && <span className="text-danger">failed</span>}
                    {e.status === "pending" && <span className="text-warn">needs setup</span>}
                  </div>
                  <div className="mt-0.5 text-[13px] leading-snug text-text-primary">{e.title}</div>
                  {e.detail && <div className="mt-0.5 text-[12px] leading-relaxed text-text-muted">{e.detail}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
