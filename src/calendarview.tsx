// Calendar (Work mode → Automations). Phase 2 of the 2026 redesign: a month
// grid that shows everything scheduled on the system — automation loops (by
// their next run) and tasks (by their due date) — in one place, and lets you
// create a new dated task tied to a domain right from a day cell.
//
// Read-only over data that already exists: loops live per-domain in _loops.json
// (gathered like the LoopBoard does), tasks come from tasks_read_all. Creating
// an event reuses tasks_add with the engine's "@YYYY-MM-DD" due convention.
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Repeat, X } from "lucide-react";
import { invoke } from "./bridge";
import { makeLoop, readLoops, writeLoops } from "./loops";
import { titleCase } from "./format";
import { SettingsHeader } from "./sectionutil";
import type { BoardTask, Domain } from "./types";
import type { Loop, LoopCadence } from "./loops";

const CADENCE_MS: Record<string, number> = { continuous: 3600e3, daily: 864e5, weekly: 6048e5, monthly: 2592e6 };

type CalEvent = {
  kind: "loop" | "task";
  title: string;
  domain: string;
  dateKey: string; // YYYY-MM-DD (local)
  detail: string;
};

// Local YYYY-MM-DD for a Date (avoids UTC off-by-one from toISOString).
function dateKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CalendarView({ vaultPath }: { vaultPath: string }) {
  // The month being viewed, anchored to its first day.
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  // New-event composer: which day is open + its field state.
  const [composeDay, setComposeDay] = useState<string | null>(null);
  const [evText, setEvText] = useState("");
  const [evDomain, setEvDomain] = useState("");
  const [evKind, setEvKind] = useState<"task" | "automation">("task");
  const [evCadence, setEvCadence] = useState<LoopCadence>("weekly");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!vaultPath) return;
    setLoading(true);
    try {
      const ds = await invoke<Domain[]>("scan_vault", { path: vaultPath }).catch(() => [] as Domain[]);
      const real = ds.filter((d) => !d.name.startsWith("_"));
      setDomains(real);
      const out: CalEvent[] = [];
      // Loops → next run day.
      await Promise.all(real.map(async (d) => {
        const doc = await readLoops(d.path).catch(() => null);
        if (!doc) return;
        for (const l of doc.loops as Loop[]) {
          if (!l.enabled || l.status !== "active") continue;
          const nextMs = l.lastRunTs ? l.lastRunTs * 1000 + (CADENCE_MS[l.cadence] ?? CADENCE_MS.weekly) : Date.now();
          out.push({ kind: "loop", title: l.name, domain: d.name, dateKey: dateKeyOf(new Date(nextMs)), detail: `${l.cadence} loop · next run` });
        }
      }));
      // Tasks → due day.
      const tasks = await invoke<BoardTask[]>("tasks_read_all", { vault: vaultPath }).catch(() => [] as BoardTask[]);
      for (const t of tasks) {
        if (!t.due || t.done || t.trashed) continue;
        out.push({ kind: "task", title: t.text, domain: t.domain, dateKey: t.due, detail: `task · ${t.status || "todo"}` });
      }
      setEvents(out);
    } finally {
      setLoading(false);
    }
  }, [vaultPath]);

  useEffect(() => { void load(); }, [load]);
  // Stay live as loops/tasks change elsewhere.
  useEffect(() => {
    const f = () => void load();
    window.addEventListener("prevail:loops-changed", f);
    window.addEventListener("prevail:tasks-changed", f);
    return () => { window.removeEventListener("prevail:loops-changed", f); window.removeEventListener("prevail:tasks-changed", f); };
  }, [load]);

  // Group events by day for O(1) cell lookup.
  const byDay = useMemo(() => {
    const m: Record<string, CalEvent[]> = {};
    for (const e of events) (m[e.dateKey] ??= []).push(e);
    return m;
  }, [events]);

  // The 6×7 grid of days covering this month (leading/trailing days from
  // adjacent months greyed out), starting on Sunday.
  const weeks = useMemo(() => {
    const first = new Date(anchor);
    const start = new Date(first);
    start.setDate(1 - first.getDay()); // back up to Sunday
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(d); }
    const rows: Date[][] = [];
    for (let i = 0; i < 6; i++) rows.push(cells.slice(i * 7, i * 7 + 7));
    return rows;
  }, [anchor]);

  const todayKey = dateKeyOf(new Date());
  const monthLabel = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shiftMonth = (delta: number) => setAnchor((a) => { const d = new Date(a); d.setMonth(a.getMonth() + delta); return d; });

  const openCompose = (key: string) => {
    setComposeDay(key);
    setEvText("");
    setEvDomain(domains[0]?.name ?? "");
    setEvKind("task");
    setEvCadence("weekly");
  };
  const saveEvent = async () => {
    const text = evText.trim();
    const domain = (evDomain || domains[0]?.name || "").trim();
    if (!text || !domain || !composeDay) return;
    setSaving(true);
    try {
      if (evKind === "automation") {
        // Create a standing loop (automation) in the domain. Loops run on a
        // cadence, not a single day, so the picked day just seeds it.
        const dom = domains.find((d) => d.name === domain);
        if (dom) {
          const doc = await readLoops(dom.path);
          const loop = makeLoop({ name: text, cadence: evCadence, purpose: text });
          await writeLoops(dom.path, { ...doc, loops: [...doc.loops, loop] });
          window.dispatchEvent(new CustomEvent("prevail:loops-changed"));
        }
      } else {
        // The engine parses a trailing "@YYYY-MM-DD" into the task's due date.
        await invoke("tasks_add", { vault: vaultPath, domain, text: `${text} @${composeDay}`, source: "calendar" });
        window.dispatchEvent(new CustomEvent("prevail:tasks-changed"));
      }
      setComposeDay(null);
      await load();
    } catch (e) {
      console.error("calendar save event", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsHeader
        title="Calendar"
        icon={CalendarDays}
        subtitle="Everything scheduled on your system in one view — automation loops by their next run and tasks by their due date. Click any day to add a task tied to a domain."
        right={
          <div className="flex items-center gap-1.5">
            <button onClick={() => shiftMonth(-1)} title="Previous month" className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-warm hover:text-text-primary"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setAnchor(d); }} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-warm hover:text-text-primary">Today</button>
            <button onClick={() => shiftMonth(1)} title="Next month" className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-warm hover:text-text-primary"><ChevronRight className="h-4 w-4" /></button>
          </div>
        }
      />

      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-text-primary">{monthLabel}</h3>
        {loading && <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">loading…</span>}
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">{d}</div>
        ))}
      </div>
      {/* Month grid */}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle">
        {weeks.flat().map((d) => {
          const key = dateKeyOf(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = key === todayKey;
          const dayEvents = byDay[key] ?? [];
          return (
            <div
              key={key}
              className={`group/cell relative min-h-[92px] bg-background p-1.5 ${inMonth ? "" : "opacity-45"}`}
            >
              <div className="flex items-center justify-between">
                <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${isToday ? "bg-accent text-background" : "text-text-secondary"}`}>{d.getDate()}</span>
                <button
                  onClick={() => openCompose(key)}
                  title="Add a task on this day"
                  className="flex h-5 w-5 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-surface-warm hover:text-accent group-hover/cell:opacity-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <ul className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 4).map((e, i) => (
                  <li
                    key={i}
                    title={`${e.title} · ${titleCase(e.domain)} · ${e.detail}`}
                    className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                      e.kind === "loop" ? "bg-ai/15 text-ai" : "bg-accent-soft text-accent"
                    }`}
                  >
                    {e.kind === "loop" ? <Repeat className="h-2.5 w-2.5 shrink-0" /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                    <span className="truncate">{e.title}</span>
                  </li>
                ))}
                {dayEvents.length > 4 && (
                  <li className="px-1 text-[9px] text-text-muted">+{dayEvents.length - 4} more</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-4 font-mono text-[10px] uppercase tracking-wider text-text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded bg-ai/30" /> Automation loop</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded bg-accent-soft" /> Task due</span>
      </div>

      {/* New-event composer */}
      {composeDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setComposeDay(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-text-primary"><CalendarDays className="h-5 w-5 text-accent" /> New event</h3>
              <button onClick={() => setComposeDay(null)} className="rounded p-1 text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
            </div>
            {/* Type toggle: a one-off dated task, or a standing automation. */}
            <div className="mb-3 flex rounded-md border border-border p-0.5">
              {(["task", "automation"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setEvKind(k)}
                  className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${evKind === k ? "bg-accent text-background" : "text-text-secondary hover:text-text-primary"}`}
                >
                  {k}
                </button>
              ))}
            </div>
            <p className="mb-3 text-xs text-text-muted">
              {evKind === "task"
                ? <>A task due <span className="font-mono text-text-secondary">{composeDay}</span>, tied to a domain.</>
                : <>A standing automation (loop) that runs on a cadence, tied to a domain.</>}
            </p>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">{evKind === "task" ? "Task" : "Automation"}</label>
            <input
              autoFocus
              value={evText}
              onChange={(e) => setEvText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void saveEvent(); }}
              placeholder={evKind === "task" ? "e.g. Review portfolio" : "e.g. Weekly portfolio review"}
              className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none"
            />
            {evKind === "automation" && (
              <>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Cadence</label>
                <select
                  value={evCadence}
                  onChange={(e) => setEvCadence(e.target.value as LoopCadence)}
                  className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none"
                >
                  {(["continuous", "daily", "weekly", "monthly"] as LoopCadence[]).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </>
            )}
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Domain</label>
            <select
              value={evDomain}
              onChange={(e) => setEvDomain(e.target.value)}
              className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none"
            >
              {domains.length === 0 && <option value="">No domains yet</option>}
              {domains.map((d) => <option key={d.name} value={d.name}>{titleCase(d.name)}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setComposeDay(null)} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-warm">Cancel</button>
              <button
                onClick={() => void saveEvent()}
                disabled={saving || !evText.trim() || !evDomain}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? "Adding…" : evKind === "task" ? "Add task" : "Add automation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
