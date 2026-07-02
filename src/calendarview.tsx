// Calendar (Work mode). Everything scheduled on your system in one place —
// automation loops (by next run), tasks (by due date), and external events
// synced from Google Calendar via the app-sync. Supports Day / Week / Month /
// Quarter views, source filters, click-to-edit, and day drill-down.
//
// Data sources (all read from data that already exists — no fake events):
//   • loops  → per-domain _loops.json (next run = lastRunTs + cadence)
//   • tasks  → tasks_read_all (by due date)
//   • google → <vault>/calendar-external.json, the integration contract the
//              app-sync writes: [{ id, title, date: "YYYY-MM-DD", domain?, url? }].
//              Two-way sync is handled by the app-sync; "Sync now" fires
//              prevail:sync-calendar for it to pick up, then reloads.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CalendarDays, Check, ChevronLeft, ChevronRight, ExternalLink, MessageSquare, Plus, RefreshCw, Repeat, Trash2, X } from "lucide-react";
import { invoke } from "./bridge";
import { makeLoop, readLoops, writeLoops } from "./loops";
import { titleCase } from "./format";
import { SettingsHeader } from "./sectionutil";
import type { BoardTask, Domain } from "./types";
import type { Loop, LoopCadence } from "./loops";

const CADENCE_MS: Record<string, number> = { continuous: 3600e3, daily: 864e5, weekly: 6048e5, monthly: 2592e6 };
type ViewMode = "day" | "week" | "month" | "quarter";

interface ExternalEvent { id?: string; title: string; date: string; domain?: string; url?: string }

type CalEvent = {
  key: string;
  kind: "loop" | "task" | "google";
  title: string;
  domain: string;
  dateKey: string; // YYYY-MM-DD (local)
  detail: string;
  task?: BoardTask;
  loop?: Loop;
  domainPath?: string;
  external?: ExternalEvent;
};

function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfWeek(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function quarterOf(d: Date): number { return Math.floor(d.getMonth() / 3); }
function prettyDate(key: string): string { const [y, m, dd] = key.split("-").map(Number); return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
function daysUntil(key: string): number {
  const [y, m, dd] = key.split("-").map(Number);
  const due = new Date(y, m - 1, dd); due.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}
// The right-side urgency badge: the single most useful fact (when it's due),
// color-coded so the eye lands on what's urgent without extra noise.
function dueBadge(key: string, kind: CalEvent["kind"]): { label: string; cls: string } {
  const n = daysUntil(key);
  if (kind === "loop") {
    const label = n <= 0 ? "runs now" : n === 1 ? "runs in 1 day" : `runs in ${n} days`;
    return { label, cls: "bg-ai/15 text-ai" };
  }
  if (n < 0) return { label: `${-n}d overdue`, cls: "bg-err/10 text-err" };
  if (n === 0) return { label: "today", cls: "bg-warn/15 text-warn" };
  if (n === 1) return { label: "tomorrow", cls: "bg-accent-soft text-accent" };
  if (n <= 7) return { label: `in ${n} days`, cls: "bg-accent-soft text-accent" };
  if (n <= 30) return { label: `in ${n} days`, cls: "bg-surface-warm text-text-secondary" };
  return { label: `in ${Math.round(n / 7)} wks`, cls: "bg-surface-warm text-text-muted" };
}
const PRIORITY_CLS: Record<string, string> = { high: "bg-err/10 text-err", urgent: "bg-err/10 text-err", med: "bg-warn/15 text-warn", medium: "bg-warn/15 text-warn", low: "bg-surface-warm text-text-muted" };

export function CalendarView({ vaultPath }: { vaultPath: string }) {
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState({ loop: true, task: true, google: true });
  const [syncing, setSyncing] = useState(false);

  // New-event composer.
  const [composeDay, setComposeDay] = useState<string | null>(null);
  const [evText, setEvText] = useState("");
  const [evDomain, setEvDomain] = useState("");
  const [evKind, setEvKind] = useState<"task" | "automation">("task");
  const [evCadence, setEvCadence] = useState<LoopCadence>("weekly");
  const [saving, setSaving] = useState(false);

  // Edit drawer.
  const [edit, setEdit] = useState<CalEvent | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editStatus, setEditStatus] = useState("todo");
  const [editCadence, setEditCadence] = useState<LoopCadence>("weekly");
  const [editEnabled, setEditEnabled] = useState(true);
  const [editBusy, setEditBusy] = useState(false);

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
          out.push({ key: `loop:${d.name}:${l.id}`, kind: "loop", title: l.name, domain: d.name, dateKey: dateKeyOf(new Date(nextMs)), detail: `${l.cadence} loop · next run`, loop: l, domainPath: d.path });
        }
      }));
      // Tasks → due day.
      const tasks = await invoke<BoardTask[]>("tasks_read_all", { vault: vaultPath }).catch(() => [] as BoardTask[]);
      for (const t of tasks) {
        if (!t.due || t.done || t.trashed) continue;
        out.push({ key: `task:${t.domain}:${t.id ?? t.text}`, kind: "task", title: t.text, domain: t.domain, dateKey: t.due, detail: `task · ${t.status || "todo"}`, task: t });
      }
      // Google (external) → synced by the app-sync into calendar-external.json.
      try {
        const raw = await invoke<string>("read_text_file", { path: `${vaultPath.replace(/\/+$/, "")}/calendar-external.json` }).catch(() => "");
        const ext = raw ? (JSON.parse(raw) as ExternalEvent[]) : [];
        if (Array.isArray(ext)) {
          for (const e of ext) {
            if (!e?.date || !e?.title) continue;
            out.push({ key: `google:${e.id ?? e.title}:${e.date}`, kind: "google", title: e.title, domain: e.domain ?? "", dateKey: e.date, detail: "Google Calendar", external: e });
          }
        }
      } catch { /* no external file yet */ }
      setEvents(out);
    } finally {
      setLoading(false);
    }
  }, [vaultPath]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const f = () => void load();
    window.addEventListener("prevail:loops-changed", f);
    window.addEventListener("prevail:tasks-changed", f);
    return () => { window.removeEventListener("prevail:loops-changed", f); window.removeEventListener("prevail:tasks-changed", f); };
  }, [load]);

  const visible = useMemo(() => events.filter((e) => sources[e.kind]), [events, sources]);
  const byDay = useMemo(() => {
    const m: Record<string, CalEvent[]> = {};
    for (const e of visible) (m[e.dateKey] ??= []).push(e);
    return m;
  }, [visible]);

  const todayKey = dateKeyOf(new Date());

  // Period label + navigation depend on the view.
  const periodLabel = useMemo(() => {
    if (view === "day") return cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (view === "week") { const s = startOfWeek(cursor), e = addDays(s, 6); return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`; }
    if (view === "quarter") return `Q${quarterOf(cursor) + 1} ${cursor.getFullYear()}`;
    return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [view, cursor]);
  const shift = (dir: number) => setCursor((c) => {
    const d = new Date(c);
    if (view === "day") d.setDate(d.getDate() + dir);
    else if (view === "week") d.setDate(d.getDate() + dir * 7);
    else if (view === "quarter") d.setMonth(d.getMonth() + dir * 3);
    else d.setMonth(d.getMonth() + dir);
    return d;
  });

  const openCompose = (key: string) => { setComposeDay(key); setEvText(""); setEvDomain(domains[0]?.name ?? ""); setEvKind("task"); setEvCadence("weekly"); };
  const drillToDay = (key: string) => { const [y, m, dd] = key.split("-").map(Number); setCursor(new Date(y, m - 1, dd)); setView("day"); };

  const saveEvent = async () => {
    const text = evText.trim();
    const domain = (evDomain || domains[0]?.name || "").trim();
    if (!text || !domain || !composeDay) return;
    setSaving(true);
    try {
      if (evKind === "automation") {
        const dom = domains.find((d) => d.name === domain);
        if (dom) {
          const doc = await readLoops(dom.path);
          await writeLoops(dom.path, { ...doc, loops: [...doc.loops, makeLoop({ name: text, cadence: evCadence, purpose: text })] });
          window.dispatchEvent(new CustomEvent("prevail:loops-changed"));
        }
      } else {
        await invoke("tasks_add", { vault: vaultPath, domain, text: `${text} @${composeDay}`, source: "calendar" });
        window.dispatchEvent(new CustomEvent("prevail:tasks-changed"));
      }
      setComposeDay(null);
      await load();
    } catch (e) { console.error("calendar save event", e); } finally { setSaving(false); }
  };

  // Open the edit drawer, seeding fields from the event.
  const openEdit = (ev: CalEvent) => {
    setEdit(ev);
    setEditTitle(ev.title);
    setEditDue(ev.dateKey);
    setEditStatus(ev.task?.status || "todo");
    setEditCadence((ev.loop?.cadence as LoopCadence) || "weekly");
    setEditEnabled(ev.loop?.enabled ?? true);
  };

  const saveTaskEdit = async (opts?: { trash?: boolean; done?: boolean }) => {
    if (!edit?.task) return;
    setEditBusy(true);
    try {
      const list = await invoke<BoardTask[]>("tasks_read", { vault: vaultPath, domain: edit.domain }).catch(() => [] as BoardTask[]);
      const id = edit.task.id;
      const next = list.map((t) => {
        if ((id && t.id === id) || (!id && t.text === edit.task!.text)) {
          if (opts?.trash) return { ...t, trashed: dateKeyOf(new Date()) };
          return { ...t, text: editTitle.trim() || t.text, due: editDue || null, status: opts?.done ? "done" : editStatus, done: opts?.done ? true : t.done };
        }
        return t;
      });
      await invoke("tasks_set", { vault: vaultPath, domain: edit.domain, tasks: next });
      window.dispatchEvent(new CustomEvent("prevail:tasks-changed"));
      setEdit(null);
      await load();
    } catch (e) { console.error("task edit", e); } finally { setEditBusy(false); }
  };

  const saveLoopEdit = async () => {
    if (!edit?.loop || !edit.domainPath) return;
    setEditBusy(true);
    try {
      const doc = await readLoops(edit.domainPath);
      const next = doc.loops.map((l) => (l.id === edit.loop!.id ? { ...l, cadence: editCadence, enabled: editEnabled } : l));
      await writeLoops(edit.domainPath, { ...doc, loops: next });
      window.dispatchEvent(new CustomEvent("prevail:loops-changed"));
      setEdit(null);
      await load();
    } catch (e) { console.error("loop edit", e); } finally { setEditBusy(false); }
  };

  // Card actions: chat about it, hand it to an AI agent, or turn it into a loop.
  const chatAbout = (ev: CalEvent) => {
    const seed = `Let's work on this task: "${ev.title}". `;
    try { localStorage.setItem("prevail.compose.pending", seed); } catch { /* ignore */ }
    setEdit(null);
    window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: ev.domain || "" }));
    window.dispatchEvent(new CustomEvent("prevail:compose-seed", { detail: seed }));
  };
  const handToAgent = async (ev: CalEvent) => {
    if (!ev.task?.id) return;
    setEditBusy(true);
    try {
      await invoke("tasks_set_owner", { vault: vaultPath, domain: ev.domain, id: ev.task.id, owner: "ai" });
      if ((ev.task.status || "todo") === "todo") await invoke("tasks_set_status", { vault: vaultPath, domain: ev.domain, id: ev.task.id, status: "doing" });
      window.dispatchEvent(new CustomEvent("prevail:tasks-changed"));
      setEdit(null);
      await load();
    } catch (e) { console.error("hand to agent", e); } finally { setEditBusy(false); }
  };
  const turnIntoLoop = async (ev: CalEvent) => {
    const dom = domains.find((d) => d.name === ev.domain);
    if (!dom) return;
    setEditBusy(true);
    try {
      const doc = await readLoops(dom.path);
      await writeLoops(dom.path, { ...doc, loops: [...doc.loops, makeLoop({ name: ev.title, cadence: "weekly", purpose: ev.title })] });
      window.dispatchEvent(new CustomEvent("prevail:loops-changed"));
      setEdit(null);
      window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "automations" }));
    } catch (e) { console.error("turn into loop", e); } finally { setEditBusy(false); }
  };

  const syncGoogle = async () => {
    setSyncing(true);
    try {
      // Syncing rides on the Google Workspace CLI. If it isn't set up, take the
      // user to its setup in Apps instead of silently doing nothing.
      const status = await invoke<{ installed?: boolean }>("google_cli_status").catch(() => ({ installed: false }));
      if (!status?.installed) {
        window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" }));
        // Let the Apps panel mount, then select the Google Workspace connector.
        setTimeout(() => window.dispatchEvent(new CustomEvent("prevail:app-open", { detail: "google" })), 300);
        return;
      }
      // Set up → hand off to the app-sync (it owns the Google Calendar two-way
      // sync, using the gws CLI), then re-read whatever it wrote.
      window.dispatchEvent(new CustomEvent("prevail:sync-calendar"));
      await new Promise((r) => setTimeout(r, 600));
      await load();
    } finally { setSyncing(false); }
  };

  // One event chip (clickable → edit). Google events open in Google instead.
  const Chip = ({ e, full }: { e: CalEvent; full?: boolean }) => (
    <button
      onClick={() => (e.kind === "google" ? openEdit(e) : openEdit(e))}
      title={`${e.title} · ${e.domain ? titleCase(e.domain) : (e.kind === "google" ? "Google" : "General")} · ${e.detail}`}
      className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight transition-colors hover:brightness-95 ${
        e.kind === "loop" ? "bg-ai/15 text-ai" : e.kind === "google" ? "bg-purple-500/15 text-purple-600 dark:text-purple-300" : "bg-accent-soft text-accent"
      } ${full ? "text-[12px] py-1" : ""}`}
    >
      {e.kind === "loop" ? <Repeat className="h-2.5 w-2.5 shrink-0" /> : e.kind === "google" ? <CalendarDays className="h-2.5 w-2.5 shrink-0" /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      <span className="truncate">{e.title}</span>
    </button>
  );

  // ----- Renderers per view -----
  const monthCells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const renderMonth = () => (
    <>
      <div className="grid grid-cols-7 gap-px">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle">
        {monthCells.map((d) => {
          const key = dateKeyOf(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = key === todayKey;
          const dayEvents = byDay[key] ?? [];
          return (
            <div key={key} className={`group/cell relative min-h-[92px] bg-background p-1.5 ${inMonth ? "" : "opacity-45"}`}>
              <div className="flex items-center justify-between">
                <button onClick={() => drillToDay(key)} title="Open day" className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold hover:bg-surface-warm ${isToday ? "bg-accent text-background" : "text-text-secondary"}`}>{d.getDate()}</button>
                <button onClick={() => openCompose(key)} title="Add on this day" className="flex h-5 w-5 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-surface-warm hover:text-accent group-hover/cell:opacity-100"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <ul className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 4).map((e) => <li key={e.key}><Chip e={e} /></li>)}
                {dayEvents.length > 4 && (
                  <li><button onClick={() => drillToDay(key)} className="px-1 text-[9px] text-text-muted hover:text-accent">+{dayEvents.length - 4} more</button></li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );

  const renderWeek = () => {
    const s = startOfWeek(cursor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
    return (
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle">
        {days.map((d) => {
          const key = dateKeyOf(d);
          const isToday = key === todayKey;
          const dayEvents = byDay[key] ?? [];
          return (
            <div key={key} className="group/cell flex min-h-[60vh] flex-col bg-background p-1.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${isToday ? "bg-accent text-background" : "text-text-secondary"}`}>{d.getDate()}</span>
              </div>
              <ul className="flex-1 space-y-0.5">
                {dayEvents.map((e) => <li key={e.key}><Chip e={e} /></li>)}
              </ul>
              <button onClick={() => openCompose(key)} className="mt-1 flex items-center justify-center gap-1 rounded border border-dashed border-border py-1 text-[10px] text-text-muted opacity-0 hover:text-accent group-hover/cell:opacity-100"><Plus className="h-3 w-3" /></button>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDay = () => {
    const key = dateKeyOf(cursor);
    const dayEvents = byDay[key] ?? [];
    return (
      <div className="rounded-lg border border-border-subtle bg-background p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-text-primary">{prettyDate(key)}</h3>
          <button onClick={() => openCompose(key)} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover"><Plus className="h-4 w-4" /> Add</button>
        </div>
        {dayEvents.length === 0 ? (
          <p className="py-10 text-center text-sm text-text-muted">Nothing scheduled this day.</p>
        ) : (
          <ul className="space-y-1.5">
            {dayEvents.map((e) => {
              const due = dueBadge(e.dateKey, e.kind);
              const prio = e.task?.priority?.toLowerCase();
              const status = e.task?.status;
              return (
                <li key={e.key}>
                  <button onClick={() => openEdit(e)} className="group/card flex w-full items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3 text-left transition-all hover:border-accent-border hover:shadow-sm">
                    {/* Kind marker */}
                    {e.kind === "loop" ? <Repeat className="h-4 w-4 shrink-0 text-ai" /> : e.kind === "google" ? <CalendarDays className="h-4 w-4 shrink-0 text-purple-500" /> : <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />}
                    {/* Title + quiet metadata line */}
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-sm font-medium text-text-primary">{e.title}</span>
                      <span className="flex items-center gap-1.5 truncate text-[11px] text-text-muted">
                        <span className="truncate">{e.domain ? titleCase(e.domain) : (e.kind === "google" ? "Google Calendar" : "General")}</span>
                        {status && status !== "todo" && <span className="capitalize">· {status}</span>}
                      </span>
                    </span>
                    {/* Right side: priority (if any) + the urgency badge — the
                        important bit, color-coded. */}
                    <span className="flex shrink-0 items-center gap-1.5">
                      {prio && PRIORITY_CLS[prio] && (
                        <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${PRIORITY_CLS[prio]}`}>{prio}</span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide ${due.cls}`}>{due.label}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  const renderQuarter = () => {
    const q = quarterOf(cursor);
    const months = [0, 1, 2].map((i) => new Date(cursor.getFullYear(), q * 3 + i, 1));
    const inQuarter = (key: string) => { const m = Number(key.split("-")[1]) - 1; const y = Number(key.split("-")[0]); return y === cursor.getFullYear() && Math.floor(m / 3) === q; };
    const quarterEvents = visible.filter((e) => inQuarter(e.dateKey)).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const grouped: Record<string, CalEvent[]> = {};
    for (const e of quarterEvents) (grouped[e.dateKey] ??= []).push(e);
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Mini month overviews */}
        <div className="space-y-3">
          {months.map((mDate) => {
            const start = startOfWeek(new Date(mDate.getFullYear(), mDate.getMonth(), 1));
            const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
            return (
              <div key={mDate.getMonth()} className="rounded-lg border border-border-subtle bg-background p-3">
                <div className="mb-1 font-display text-sm font-semibold text-text-primary">{mDate.toLocaleDateString(undefined, { month: "long" })}</div>
                <div className="grid grid-cols-7 gap-0.5">
                  {cells.map((d) => {
                    const key = dateKeyOf(d);
                    const n = (byDay[key] ?? []).length;
                    const inM = d.getMonth() === mDate.getMonth();
                    return (
                      <button key={key} onClick={() => drillToDay(key)} className={`flex aspect-square items-center justify-center rounded text-[10px] ${inM ? "text-text-secondary hover:bg-surface-warm" : "text-text-muted/40"} ${key === todayKey ? "bg-accent text-background" : ""}`} title={n ? `${n} item${n === 1 ? "" : "s"}` : undefined}>
                        <span className="relative">{d.getDate()}{n > 0 && key !== todayKey && <span className="absolute -right-1.5 -top-0.5 h-1 w-1 rounded-full bg-accent" />}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {/* Quarter agenda list */}
        <div className="rounded-lg border border-border-subtle bg-background p-3">
          <div className="mb-2 font-display text-sm font-semibold text-text-primary">Everything this quarter ({quarterEvents.length})</div>
          {quarterEvents.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">Nothing scheduled this quarter.</p>
          ) : (
            <ul className="space-y-2">
              {Object.keys(grouped).sort().map((key) => (
                <li key={key}>
                  <button onClick={() => drillToDay(key)} className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-accent">{prettyDate(key)}</button>
                  <ul className="space-y-0.5">{grouped[key].map((e) => <li key={e.key}><Chip e={e} full /></li>)}</ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  const Source = ({ id, label, color }: { id: "loop" | "task" | "google"; label: string; color: string }) => (
    <button onClick={() => setSources((s) => ({ ...s, [id]: !s[id] }))} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${sources[id] ? "border-border bg-surface text-text-primary" : "border-border-subtle text-text-muted opacity-60"}`}>
      <span className="inline-block h-2.5 w-2.5 rounded" style={{ background: color }} />{label}
    </button>
  );

  return (
    <>
      <SettingsHeader
        title="Calendar"
        icon={CalendarDays}
        subtitle="Everything scheduled on your system - automation loops, tasks, and your Google Calendar - in one place. Click an item to edit it; click a day to add one."
        right={
          <div className="flex items-center gap-1.5">
            <button onClick={() => shift(-1)} title="Previous" className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-warm hover:text-text-primary"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => setCursor(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-warm hover:text-text-primary">Today</button>
            <button onClick={() => shift(1)} title="Next" className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-warm hover:text-text-primary"><ChevronRight className="h-4 w-4" /></button>
          </div>
        }
      />

      {/* Controls: view switcher + sources + sync */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-border p-0.5">
            {(["day", "week", "month", "quarter"] as ViewMode[]).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${view === v ? "bg-accent text-background" : "text-text-secondary hover:text-text-primary"}`}>{v}</button>
            ))}
          </div>
          <h3 className="font-display text-lg font-semibold text-text-primary">{periodLabel}</h3>
          {loading && <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">loading…</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <Source id="loop" label="Loops" color="color-mix(in srgb, var(--color-ai, #3CD8FF) 40%, transparent)" />
          <Source id="task" label="Tasks" color="var(--color-accent, #0d7a6e)" />
          <Source id="google" label="Google" color="#a855f7" />
          <button onClick={() => void syncGoogle()} disabled={syncing} title="Sync with Google Calendar - uses the Google Workspace CLI (takes you to set it up if it isn't yet)" className="ml-1 flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:bg-surface-warm hover:text-text-primary disabled:opacity-50">
            <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync"}
          </button>
        </div>
      </div>

      {view === "month" && renderMonth()}
      {view === "week" && renderWeek()}
      {view === "day" && renderDay()}
      {view === "quarter" && renderQuarter()}

      {/* New-event composer */}
      {composeDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setComposeDay(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-text-primary"><CalendarDays className="h-5 w-5 text-accent" /> New event</h3>
              <button onClick={() => setComposeDay(null)} className="rounded p-1 text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
            </div>
            <div className="mb-3 flex rounded-md border border-border p-0.5">
              {(["task", "automation"] as const).map((k) => (
                <button key={k} onClick={() => setEvKind(k)} className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${evKind === k ? "bg-accent text-background" : "text-text-secondary hover:text-text-primary"}`}>{k}</button>
              ))}
            </div>
            <p className="mb-3 text-xs text-text-muted">{evKind === "task" ? <>A task due <span className="font-mono text-text-secondary">{composeDay}</span>, tied to a domain.</> : <>A standing automation (loop) that runs on a cadence, tied to a domain.</>}</p>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">{evKind === "task" ? "Task" : "Automation"}</label>
            <input autoFocus value={evText} onChange={(e) => setEvText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveEvent(); }} placeholder={evKind === "task" ? "e.g. Review portfolio" : "e.g. Weekly portfolio review"} className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none" />
            {evKind === "automation" && (
              <>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Cadence</label>
                <select value={evCadence} onChange={(e) => setEvCadence(e.target.value as LoopCadence)} className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none">
                  {(["continuous", "daily", "weekly", "monthly"] as LoopCadence[]).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </>
            )}
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Domain</label>
            <select value={evDomain} onChange={(e) => setEvDomain(e.target.value)} className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none">
              {domains.length === 0 && <option value="">No domains yet</option>}
              {domains.map((d) => <option key={d.name} value={d.name}>{titleCase(d.name)}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setComposeDay(null)} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-warm">Cancel</button>
              <button onClick={() => void saveEvent()} disabled={saving || !evText.trim() || !evDomain} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{saving ? "Adding…" : evKind === "task" ? "Add task" : "Add automation"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit drawer */}
      {edit && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setEdit(null)}>
          <div className="h-full w-full max-w-sm overflow-y-auto border-l border-border bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-text-primary">
                {edit.kind === "loop" ? <Repeat className="h-5 w-5 text-ai" /> : edit.kind === "google" ? <CalendarDays className="h-5 w-5 text-purple-500" /> : <CalendarDays className="h-5 w-5 text-accent" />}
                {edit.kind === "loop" ? "Automation" : edit.kind === "google" ? "Google event" : "Task"}
              </h3>
              <button onClick={() => setEdit(null)} className="rounded p-1 text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
            </div>

            {edit.kind === "task" && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Title</label>
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Due date</label>
                  <input type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Status</label>
                  <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none">
                    {["todo", "doing", "review", "done", "blocked", "icebox"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="text-[11px] text-text-muted">Domain: {edit.domain ? titleCase(edit.domain) : "General"}</div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button onClick={() => void saveTaskEdit()} disabled={editBusy} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-50">Save</button>
                  <button onClick={() => void saveTaskEdit({ done: true })} disabled={editBusy} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-warm"><Check className="h-3.5 w-3.5" /> Mark done</button>
                  <button onClick={() => void saveTaskEdit({ trash: true })} disabled={editBusy} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-err hover:bg-err/10"><Trash2 className="h-3.5 w-3.5" /> Trash</button>
                </div>
                {/* Do something with this task */}
                <div className="mt-3 border-t border-border-subtle pt-3">
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Work on it</div>
                  <div className="grid grid-cols-1 gap-1.5">
                    <button onClick={() => chatAbout(edit)} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm text-text-secondary hover:border-accent-border hover:text-accent"><MessageSquare className="h-4 w-4 shrink-0" /> Chat about this</button>
                    <button onClick={() => void handToAgent(edit)} disabled={editBusy || !edit.task?.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50"><Bot className="h-4 w-4 shrink-0" /> Hand to an agent</button>
                    <button onClick={() => void turnIntoLoop(edit)} disabled={editBusy} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50"><Repeat className="h-4 w-4 shrink-0" /> Turn into a loop</button>
                  </div>
                </div>
              </div>
            )}

            {edit.kind === "loop" && (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-text-primary">{edit.title}</div>
                <div className="text-[11px] text-text-muted">Domain: {titleCase(edit.domain)}</div>
                <div>
                  <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Cadence</label>
                  <select value={editCadence} onChange={(e) => setEditCadence(e.target.value as LoopCadence)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none">
                    {(["continuous", "daily", "weekly", "monthly"] as LoopCadence[]).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={editEnabled} onChange={(e) => setEditEnabled(e.target.checked)} /> Enabled
                </label>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button onClick={() => void saveLoopEdit()} disabled={editBusy} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-50">Save</button>
                  <button onClick={() => { setEdit(null); window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "automations" })); }} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-warm">Open in Automations</button>
                </div>
              </div>
            )}

            {edit.kind === "google" && (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-text-primary">{edit.title}</div>
                <div className="text-[11px] text-text-muted">{prettyDate(edit.dateKey)} · synced from Google Calendar</div>
                <p className="text-[12px] text-text-muted">Google events are managed in Google Calendar; the app-sync keeps them in sync both ways.</p>
                {edit.external?.url && (
                  <a href={edit.external.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-warm hover:text-text-primary"><ExternalLink className="h-3.5 w-3.5" /> Open in Google Calendar</a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
