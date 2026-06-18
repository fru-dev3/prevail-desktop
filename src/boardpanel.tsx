// Workflows-Kanban (P0) - the cross-domain task board. Tasks are owned by Me or
// AI and flow across columns (To-do / Doing / Review / Done). AI-owned tasks run
// as workflows via the Loop steward; anything consequential surfaces in the
// Decision Inbox. Reads tasks_read_all; moves via tasks_set_status/tasks_set_owner.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, Columns3, Inbox, List, Loader2, Play, Plus, Trash2, User } from "lucide-react";
import { invoke } from "./bridge";
import { SettingsHeader } from "./sectionutil";
import { titleCase } from "./format";
import { PREF, getPref } from "./storage";
import { DecisionInbox } from "./decisioninbox";
import type { BoardTask } from "./types";

type BoardView = "board" | "list" | "needs";

const COLUMNS: { key: string; label: string }[] = [
  { key: "todo", label: "To-do" },
  { key: "doing", label: "Doing" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];
// "blocked" tasks live visually in the Doing column with a flag.
const columnFor = (status: string) => (status === "blocked" ? "doing" : status);

const dueTone = (due?: string | null): string => {
  if (!due) return "text-text-muted/60";
  const today = new Date().toISOString().slice(0, 10);
  if (due < today) return "text-danger";
  if (due === today) return "text-warn";
  return "text-text-muted";
};

export function BoardPanel({ vaultPath }: { vaultPath: string }) {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<"all" | "me" | "ai">("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [view, setView] = useState<BoardView>(() => (localStorage.getItem("prevail.board.view") === "list" ? "list" : "board"));
  const [decisionsCount, setDecisionsCount] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [addText, setAddText] = useState("");
  const [addDomain, setAddDomain] = useState("");
  const [addDue, setAddDue] = useState("");
  const [running, setRunning] = useState(false);

  const [allDomains, setAllDomains] = useState<string[]>([]);

  const reload = useCallback(() => {
    invoke<BoardTask[]>("tasks_read_all", { vault: vaultPath })
      .then((t) => setTasks(Array.isArray(t) ? t : []))
      .catch((e) => console.error("tasks_read_all", e));
  }, [vaultPath]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const f = () => reload();
    window.addEventListener("prevail:tasks-changed", f);
    return () => window.removeEventListener("prevail:tasks-changed", f);
  }, [reload]);
  // Decision count for the "Needs you" tab. Cheap; refreshed on a slow cadence + events.
  useEffect(() => {
    let alive = true;
    const poll = () => invoke<unknown[]>("decisions_pending", { vault: vaultPath })
      .then((d) => { if (alive) setDecisionsCount(Array.isArray(d) ? d.length : 0); })
      .catch(() => {});
    void poll();
    const id = window.setInterval(poll, 60000);
    const onEvt = () => poll();
    window.addEventListener("prevail:tasks-changed", onEvt);
    window.addEventListener("prevail:loops-advanced", onEvt);
    return () => { alive = false; window.clearInterval(id); window.removeEventListener("prevail:tasks-changed", onEvt); window.removeEventListener("prevail:loops-advanced", onEvt); };
  }, [vaultPath]);
  // The top-bar Decisions pill opens the board straight into the "Needs you" view.
  useEffect(() => {
    const onView = (e: Event) => {
      const v = (e as CustomEvent<string>).detail;
      if (v === "needs" || v === "board" || v === "list") setView(v);
    };
    window.addEventListener("prevail:board-view", onView as EventListener);
    if (localStorage.getItem("prevail.board.openNeeds") === "1") {
      localStorage.removeItem("prevail.board.openNeeds");
      setView("needs");
    }
    return () => window.removeEventListener("prevail:board-view", onView as EventListener);
  }, []);
  // Full domain list (so you can add a task to a domain that has none yet).
  useEffect(() => {
    invoke<{ name: string }[]>("scan_vault", { path: vaultPath })
      .then((ds) => setAllDomains(Array.isArray(ds) ? ds.map((d) => d.name) : []))
      .catch(() => {});
  }, [vaultPath]);

  // Filter dropdown shows only domains with tasks; the add picker offers every domain.
  const domains = useMemo(() => [...new Set(tasks.map((t) => t.domain))].sort(), [tasks]);
  const addDomains = useMemo(
    () => [...new Set([...allDomains, ...domains])].sort(),
    [allDomains, domains],
  );
  useEffect(() => { if (!addDomain && addDomains.length) setAddDomain(addDomains[0]); }, [addDomains, addDomain]);

  const shown = useMemo(
    () => tasks.filter((t) =>
      (ownerFilter === "all" || t.owner === ownerFilter) &&
      (domainFilter === "all" || t.domain === domainFilter)),
    [tasks, ownerFilter, domainFilter],
  );
  const byColumn = useMemo(() => {
    const m: Record<string, BoardTask[]> = { todo: [], doing: [], review: [], done: [] };
    for (const t of shown) (m[columnFor(t.status)] ??= []).push(t);
    return m;
  }, [shown]);

  // Live read on the AI workflow (across all owners/domains, ignoring filters):
  // what AI is actively working, what's queued to it, what's waiting on you.
  const flow = useMemo(() => ({
    inFlight: tasks.filter((t) => t.owner === "ai" && t.status === "doing").length,
    queued: tasks.filter((t) => t.owner === "ai" && t.status === "todo").length,
    waiting: tasks.filter((t) => t.status === "review" || t.status === "blocked").length,
  }), [tasks]);

  // Trigger one engine pass now (advances loops + works AI-owned tasks) so handing
  // a task to AI produces visible movement instead of waiting for the daemon tick.
  const runNow = async () => {
    setRunning(true);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = getPref(PREF.distillModel, "claude-haiku-4-5");
      await invoke("loops_run_once", { vault: vaultPath, provider, model });
      reload();
      window.dispatchEvent(new Event("prevail:tasks-changed"));
      window.dispatchEvent(new Event("prevail:loops-advanced"));
    } catch (e) { console.error("run now", e); }
    finally { setRunning(false); }
  };

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); reload(); window.dispatchEvent(new Event("prevail:tasks-changed")); }
    catch (e) { console.error("board action", e); }
    finally { setBusy(null); }
  };
  const setStatus = (t: BoardTask, status: string) =>
    t.id && t.status !== status && act(`s:${t.id}`, () => invoke("tasks_set_status", { vault: vaultPath, domain: t.domain, id: t.id, status }));
  // Hand to AI: also move todo→doing so it visibly lands in Doing and the steward
  // picks it up. Take back: just flip owner, leave the column where it is.
  const toggleOwner = (t: BoardTask) => {
    if (!t.id) return;
    const toAi = t.owner !== "ai";
    return act(`o:${t.id}`, async () => {
      await invoke("tasks_set_owner", { vault: vaultPath, domain: t.domain, id: t.id, owner: toAi ? "ai" : "me" });
      if (toAi && t.status === "todo") await invoke("tasks_set_status", { vault: vaultPath, domain: t.domain, id: t.id, status: "doing" });
    });
  };
  const saveEdit = (t: BoardTask) => {
    const next = editVal.trim();
    setEditId(null);
    if (!t.id || !next || next === t.text) return;
    void act(`e:${t.id}`, async () => {
      const cur = await invoke<BoardTask[]>("tasks_read", { vault: vaultPath, domain: t.domain });
      await invoke("tasks_set", { vault: vaultPath, domain: t.domain, tasks: cur.map((x) => (x.id === t.id ? { ...x, text: next } : x)) });
    });
  };
  const onDrop = (status: string) => {
    setDragCol(null);
    const t = tasks.find((x) => x.id === dragId);
    setDragId(null);
    if (t) setStatus(t, status);
  };
  const del = async (t: BoardTask) => {
    if (!t.id) return;
    await act(`d:${t.id}`, async () => {
      const cur = await invoke<{ id?: string | null }[]>("tasks_read", { vault: vaultPath, domain: t.domain });
      await invoke("tasks_set", { vault: vaultPath, domain: t.domain, tasks: cur.filter((x) => x.id !== t.id) });
    });
  };
  const setViewMode = (v: "board" | "list") => { setView(v); localStorage.setItem("prevail.board.view", v); };

  const renderCard = (t: BoardTask) => {
    const ai = t.owner === "ai";
    const blocked = t.status === "blocked";
    const editing = editId != null && editId === t.id;
    return (
      <div key={`${t.domain}:${t.id ?? t.text}`}
        draggable={!editing && !!t.id}
        onDragStart={() => t.id && setDragId(t.id)}
        onDragEnd={() => { setDragId(null); setDragCol(null); }}
        className={`rounded-lg border bg-surface px-2.5 py-2 transition-opacity ${blocked ? "border-warn/40" : "border-border"} ${dragId === t.id ? "opacity-40" : ""} ${editing ? "" : "cursor-grab active:cursor-grabbing"}`}>
        <div className="flex items-start gap-1.5">
          <span title={ai ? "AI" : "Me"} className={`mt-0.5 shrink-0 ${ai ? "text-accent" : "text-text-muted"}`}>
            {ai ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
          </span>
          {editing ? (
            <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)}
              onBlur={() => saveEdit(t)}
              onKeyDown={(e) => { if (e.key === "Enter") saveEdit(t); if (e.key === "Escape") setEditId(null); }}
              className="min-w-0 flex-1 rounded border border-accent-border bg-background px-1 py-0.5 text-[13px] text-text-primary focus:outline-none" />
          ) : (
            <span onDoubleClick={() => { setEditId(t.id ?? null); setEditVal(t.text); }} title="Double-click to edit"
              className="min-w-0 flex-1 text-[13px] leading-snug text-text-primary">{t.text}</span>
          )}
          <button onClick={() => del(t)} title="Delete task" disabled={busy === `d:${t.id}`} className="shrink-0 text-text-muted/40 transition-colors hover:text-danger">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5 font-mono text-[10px]">
          <span className="rounded-full bg-surface-warm px-1.5 py-px text-text-muted">{titleCase(t.domain)}</span>
          {t.due && <span className={dueTone(t.due)}>{t.due}</span>}
          {blocked && <span className="text-warn">⏸ needs decision</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 pl-5">
          <select value={t.status} onChange={(e) => setStatus(t, e.target.value)} disabled={busy === `s:${t.id}`}
            className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-text-secondary focus:border-accent-border focus:outline-none">
            {["todo", "doing", "review", "blocked", "done"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => toggleOwner(t)} disabled={busy === `o:${t.id}`}
            title={ai ? "Take it back" : "Hand to AI to run as a workflow"}
            className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50">
            {ai ? "→ Me" : "→ AI"}
          </button>
        </div>
      </div>
    );
  };

  // List view: a full-width horizontal row (text grows, controls sit on the right).
  const renderRow = (t: BoardTask) => {
    const ai = t.owner === "ai";
    const blocked = t.status === "blocked";
    const editing = editId != null && editId === t.id;
    return (
      <div key={`row:${t.domain}:${t.id ?? t.text}`}
        className={`flex items-center gap-3 rounded-lg border bg-surface px-3 py-2 ${blocked ? "border-warn/40" : "border-border"}`}>
        <span title={ai ? "AI" : "Me"} className={`shrink-0 ${ai ? "text-accent" : "text-text-muted"}`}>
          {ai ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
        </span>
        {editing ? (
          <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)}
            onBlur={() => saveEdit(t)}
            onKeyDown={(e) => { if (e.key === "Enter") saveEdit(t); if (e.key === "Escape") setEditId(null); }}
            className="min-w-0 flex-1 rounded border border-accent-border bg-background px-1.5 py-0.5 text-[13px] text-text-primary focus:outline-none" />
        ) : (
          <span onDoubleClick={() => { setEditId(t.id ?? null); setEditVal(t.text); }} title="Double-click to edit"
            className={`min-w-0 flex-1 truncate text-[13px] ${t.status === "done" ? "text-text-muted line-through" : "text-text-primary"}`}>{t.text}</span>
        )}
        <span className="hidden shrink-0 rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-muted sm:inline">{titleCase(t.domain)}</span>
        {blocked && <span className="shrink-0 font-mono text-[10px] text-warn">⏸ decision</span>}
        <span className={`hidden w-20 shrink-0 text-right font-mono text-[10px] md:inline ${dueTone(t.due)}`}>{t.due || ""}</span>
        <select value={t.status} onChange={(e) => setStatus(t, e.target.value)} disabled={busy === `s:${t.id}`}
          className="shrink-0 rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-text-secondary focus:border-accent-border focus:outline-none">
          {["todo", "doing", "review", "blocked", "done"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => toggleOwner(t)} disabled={busy === `o:${t.id}`}
          title={ai ? "Take it back" : "Hand to AI to run as a workflow"}
          className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50">
          {ai ? "→ Me" : "→ AI"}
        </button>
        <button onClick={() => del(t)} title="Delete task" disabled={busy === `d:${t.id}`} className="shrink-0 text-text-muted/40 transition-colors hover:text-danger">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  // List view ordering: open work first (by column order), done last; then by due.
  const ORDER: Record<string, number> = { todo: 0, doing: 1, blocked: 1, review: 2, done: 3 };
  const listed = useMemo(
    () => [...shown].sort((a, b) =>
      (ORDER[a.status] ?? 0) - (ORDER[b.status] ?? 0) ||
      (a.due || "9999").localeCompare(b.due || "9999")),
    [shown],
  );
  const addTask = () => {
    const text = addText.trim(); const domain = addDomain.trim();
    if (!text || !domain) return;
    const withDue = addDue ? `${text} @${addDue}` : text;
    void act("add", async () => {
      await invoke("tasks_add", { vault: vaultPath, domain, text: withDue, source: "user" });
      setAddText(""); setAddDue("");
    });
  };

  return (
    <>
      {/* Pinned header: title, AI status, and all controls stay visible while the
          board/list scrolls. Negative margins cancel the page's px-8/py-10 so the
          backdrop goes edge-to-edge and flush to the top. */}
      <div className="sticky top-0 z-20 -mx-8 -mt-10 border-b border-border-subtle bg-background px-8 pb-3 pt-8">
      <SettingsHeader title="Board" icon={Check}
        subtitle="Your tasks as a board - owned by you or handed to AI. AI-owned tasks run as workflows and ask you to decide anything consequential in the Decision Inbox." />

      {/* AI workflow status strip - only when AI is involved or something waits on you */}
      {(flow.inFlight + flow.queued + flow.waiting > 0 || running) && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border-subtle bg-surface/40 px-3 py-2 text-xs text-text-muted">
          {running
            ? <span className="inline-flex items-center gap-1.5 text-accent"><Loader2 className="h-3.5 w-3.5 animate-spin" /> AI is working…</span>
            : <span className="inline-flex items-center gap-1.5"><Bot className="h-3.5 w-3.5 text-accent" /> {flow.inFlight} in flight · {flow.queued} queued to AI</span>}
          {flow.waiting > 0 && <span className="text-warn">{flow.waiting} waiting on you in Decisions</span>}
          <button onClick={runNow} disabled={running}
            title="Run one engine pass now: advance loops + work AI-owned tasks"
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
            <Play className="h-3 w-3" /> Run now
          </button>
        </div>
      )}

      {/* Controls: owner filter · domain filter · add */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-border">
          {(["all", "me", "ai"] as const).map((o) => (
            <button key={o} onClick={() => setOwnerFilter(o)}
              className={`px-3 py-1 text-xs font-medium capitalize transition-colors ${ownerFilter === o ? "bg-accent-soft text-accent" : "bg-background text-text-muted hover:bg-surface-warm"}`}>
              {o === "all" ? "All" : o === "me" ? "Me" : "AI"}
            </button>
          ))}
        </div>
        <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none">
          <option value="all">All domains</option>
          {domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
        </select>
        <div className="flex overflow-hidden rounded-md border border-border">
          <button onClick={() => setViewMode("board")} title="Board view"
            className={`px-2 py-1 transition-colors ${view === "board" ? "bg-accent-soft text-accent" : "bg-background text-text-muted hover:bg-surface-warm"}`}>
            <Columns3 className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setViewMode("list")} title="List view"
            className={`px-2 py-1 transition-colors ${view === "list" ? "bg-accent-soft text-accent" : "bg-background text-text-muted hover:bg-surface-warm"}`}>
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Needs you: the work that's waiting on your call (folds in the old Decisions page). */}
        <button onClick={() => setView("needs")} title="Work waiting on your decision"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${view === "needs" ? "border-accent-border bg-accent-soft text-accent" : decisionsCount > 0 ? "border-warn/40 text-warn hover:bg-surface-warm" : "border-border text-text-muted hover:bg-surface-warm"}`}>
          <Inbox className="h-3.5 w-3.5" /> Needs you
          {decisionsCount > 0 && (
            <span className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-bold text-background">{decisionsCount}</span>
          )}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <input value={addText} onChange={(e) => setAddText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
            placeholder="Add a task…" className="w-48 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none" />
          {addDomains.length > 0 && (
            <select value={addDomain} onChange={(e) => setAddDomain(e.target.value)} title="Domain"
              className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none">
              {addDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
            </select>
          )}
          <input type="date" value={addDue} onChange={(e) => setAddDue(e.target.value)} title="Due date"
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-text-muted focus:border-accent-border focus:outline-none" />
          <button onClick={addTask} disabled={!addText.trim() || busy === "add"}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
      </div>
      </div>

      <div className="pt-4">
      {view === "needs" ? (
        <DecisionInbox vaultPath={vaultPath} />
      ) : view === "board" ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = byColumn[col.key] ?? [];
            const over = dragCol === col.key && dragId;
            return (
              <section key={col.key}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setDragCol(col.key); } }}
                onDragLeave={() => setDragCol((c) => (c === col.key ? null : c))}
                onDrop={() => onDrop(col.key)}
                className={`rounded-xl border p-2 transition-colors ${over ? "border-accent-border bg-accent-soft/40" : "border-border-subtle bg-surface/40"}`}>
                <div className="mb-2 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  {col.label}<span className="text-text-muted/50">· {items.length}</span>
                </div>
                <div className="flex min-h-[2.5rem] flex-col gap-2">
                  {items.map(renderCard)}
                  {items.length === 0 && <div className="px-1 py-3 text-center text-[11px] text-text-muted/50">{over ? "drop here" : "-"}</div>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {listed.map(renderRow)}
          {listed.length === 0 && (
            <div className="rounded-xl border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
              No tasks yet. Add one above, or hand work to AI.
            </div>
          )}
        </div>
      )}
      </div>
    </>
  );
}
