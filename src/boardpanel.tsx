// Workflows-Kanban (P0) - the cross-domain task board. Tasks are owned by Me or
// AI and flow across columns (To-do / Doing / Review / Done). AI-owned tasks run
// as workflows via the Loop steward; anything consequential surfaces in the
// Decision Inbox. Reads tasks_read_all; moves via tasks_set_status/tasks_set_owner.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Briefcase, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, Columns3, CornerUpLeft, Filter, Flag, Inbox, LayoutGrid, List, Loader2, Play, Plus, RotateCcw, SlidersHorizontal, Snowflake, Trash2, User, X, Zap } from "lucide-react";
import { invoke } from "./bridge";
import { SettingsHeader } from "./sectionutil";
import { titleCase } from "./format";
import { DOMAIN_PALETTE } from "./constants";
import { PREF, getPref } from "./storage";
import { DecisionInbox } from "./decisioninbox";
import { TaskDetailPanel } from "./taskdetail";
import type { BoardTask } from "./types";

// Stable per-domain color (hashed into the shared palette) so each domain reads
// at a glance on the board. Returns the hex; callers tint bg + text from it.
function domainColor(domain: string): string {
  let h = 0;
  for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) >>> 0;
  return DOMAIN_PALETTE[h % DOMAIN_PALETTE.length];
}

type BoardView = "board" | "list" | "horizon" | "needs" | "trash" | "icebox";

const COLUMNS: { key: string; label: string }[] = [
  { key: "todo", label: "To-do" },
  { key: "doing", label: "Doing" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
  { key: "icebox", label: "Icebox" },
];

// Time-horizon buckets by due date, for planning. A task with no due date sits in
// "Someday". Order matters: rendered top-to-bottom, soonest first.
const HORIZONS: { key: string; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "later", label: "Later" },
  { key: "someday", label: "Someday (no date)" },
];
// Classify a due date (YYYY-MM-DD) into a horizon bucket relative to today.
function horizonFor(due?: string | null): string {
  if (!due) return "someday";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(due + "T00:00:00");
  if (isNaN(d.getTime())) return "someday";
  const dayMs = 86_400_000;
  const days = Math.round((d.getTime() - today.getTime()) / dayMs);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  // End of the current week (Sunday-based: through the coming Sunday).
  const endOfWeek = 7 - today.getDay();
  if (days <= endOfWeek) return "week";
  // Rest of this calendar month.
  if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()) return "month";
  // Rest of this calendar quarter.
  const q = Math.floor(today.getMonth() / 3);
  const dq = Math.floor(d.getMonth() / 3);
  if (d.getFullYear() === today.getFullYear() && dq === q) return "quarter";
  // Rest of this calendar year.
  if (d.getFullYear() === today.getFullYear()) return "year";
  return "later";
}
// "blocked" tasks live visually in the Doing column with a flag.
const columnFor = (status: string) => (status === "blocked" ? "doing" : status);

const dueTone = (due?: string | null): string => {
  if (!due) return "text-text-muted/60";
  const today = new Date().toISOString().slice(0, 10);
  if (due < today) return "text-danger";
  if (due === today) return "text-warn";
  return "text-text-muted";
};

// A task is OVERDUE when it has a due date strictly before today and is not done.
// Overdue work gets a loud red alert treatment everywhere it renders so it cannot
// be missed.
const isOverdue = (t: BoardTask): boolean => {
  if (!t.due || t.status === "done" || t.done) return false;
  const today = new Date().toISOString().slice(0, 10);
  return t.due < today;
};

export function BoardPanel({ vaultPath, initialDomain }: { vaultPath: string; initialDomain?: string }) {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<"all" | "me" | "ai">("all");
  // When opened scoped to a domain (the in-domain Work tab), pre-filter to it.
  const [domainFilter, setDomainFilter] = useState<string>(initialDomain || "all");
  const [view, setView] = useState<BoardView>(() => {
    const v = localStorage.getItem("prevail.board.view");
    return v === "list" || v === "horizon" ? v : "board";
  });
  const [decisionsCount, setDecisionsCount] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  // The task opened in the detail panel (full "task object" view).
  const [openId, setOpenId] = useState<string | null>(null);
  const [addText, setAddText] = useState("");
  const [addDomain, setAddDomain] = useState("");
  const [addDue, setAddDue] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [running, setRunning] = useState(false);
  // Collapsed board columns - free real estate for the columns you care about.
  // Persisted; Icebox starts collapsed since it's a rarely-touched parking lot.
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(() => {
    try { const r = localStorage.getItem("prevail.board.collapsedCols"); return new Set(r !== null ? r.split(",").filter(Boolean) : ["icebox"]); } catch { return new Set(["icebox"]); }
  });
  const toggleCol = (key: string) => setCollapsedCols((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    localStorage.setItem("prevail.board.collapsedCols", [...next].join(","));
    return next;
  });
  // Performance: render at most PAGE cards per column (and per list view) so a
  // domain with hundreds of tasks stays fast and never floods the DOM. The rest
  // lazy-load via "Show more". Per-column visible cap, reset when tasks reload.
  const PAGE = 10;
  const [colLimits, setColLimits] = useState<Record<string, number>>({});
  const showMore = (key: string) => setColLimits((c) => ({ ...c, [key]: (c[key] ?? PAGE) + PAGE }));
  const [listLimit, setListLimit] = useState(PAGE);
  // Secondary toolbar controls live behind "More", collapsed by default, so the
  // bar stays compact. Persisted.
  const [moreOpen, setMoreOpen] = useState<boolean>(() => localStorage.getItem("prevail.board.moreOpen") === "1");
  const toggleMore = () => setMoreOpen((v) => { const n = !v; localStorage.setItem("prevail.board.moreOpen", n ? "1" : "0"); return n; });

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
      if (v === "needs" || v === "board" || v === "list" || v === "horizon" || v === "trash") setView(v);
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
      !t.trashed && // trashed tasks live in the Trash view, not the normal board
      t.status !== "icebox" && // iceboxed tasks are set aside; they live in the Icebox view
      (ownerFilter === "all" || t.owner === ownerFilter) &&
      (domainFilter === "all" || t.domain === domainFilter)),
    [tasks, ownerFilter, domainFilter],
  );
  // Set-aside tasks: not done, not trashed, just parked. Recoverable from the Icebox view.
  const iceboxed = useMemo(
    () => tasks.filter((t) =>
      t.status === "icebox" && !t.trashed &&
      (ownerFilter === "all" || t.owner === ownerFilter) &&
      (domainFilter === "all" || t.domain === domainFilter)),
    [tasks, ownerFilter, domainFilter],
  );
  // Soft-deleted tasks, newest first, honoring the same owner/domain filters.
  const trashed = useMemo(
    () => tasks.filter((t) =>
      t.trashed &&
      (ownerFilter === "all" || t.owner === ownerFilter) &&
      (domainFilter === "all" || t.domain === domainFilter))
      .sort((a, b) => (b.trashed || "").localeCompare(a.trashed || "")),
    [tasks, ownerFilter, domainFilter],
  );
  // Board columns. "shown" excludes icebox (it is parked, hidden from list/horizon),
  // so the Icebox column draws from the separate "iceboxed" list. "blocked" tasks
  // fold into Doing with a flag via columnFor, so they never vanish.
  const byColumn = useMemo(() => {
    const m: Record<string, BoardTask[]> = { todo: [], doing: [], review: [], done: [], icebox: [] };
    for (const t of shown) (m[columnFor(t.status)] ??= []).push(t);
    for (const t of iceboxed) (m.icebox ??= []).push(t);
    return m;
  }, [shown, iceboxed]);
  // Horizon view groups OPEN tasks by due-date bucket (done tasks drop out - the
  // horizon is about what's ahead). Critical/high first, then by due date.
  const byHorizon = useMemo(() => {
    const m: Record<string, BoardTask[]> = {};
    for (const h of HORIZONS) m[h.key] = [];
    const prioRank = (p?: string | null) => (p === "critical" ? 0 : p === "high" ? 1 : 2);
    for (const t of shown) {
      if (t.status === "done" || t.done) continue;
      (m[horizonFor(t.due)] ??= []).push(t);
    }
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => prioRank(a.priority) - prioRank(b.priority) || (a.due || "9999").localeCompare(b.due || "9999"));
    }
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
  // Bulk hand-off: assign every currently-shown, me-owned, open task to the agent
  // at once - so you do not have to click "hand to AI" on each one. Skips anything
  // that needs the human (blocked = awaiting a decision, or in Review), and skips
  // done tasks. Respects the active owner/domain filters via "shown".
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const needsHuman = (t: BoardTask) => t.status === "blocked" || t.status === "review";
  const assignAllToAgent = async () => {
    const targets = shown.filter((t) => t.id && t.owner === "me" && t.status !== "done" && !needsHuman(t));
    setBulkMsg(null);
    if (targets.length === 0) { setBulkMsg("Nothing to assign - no eligible tasks owned by you."); window.setTimeout(() => setBulkMsg(null), 4000); return; }
    setBusy("bulk-assign");
    try {
      await Promise.all(targets.map((t) =>
        invoke("tasks_set_owner", { vault: vaultPath, domain: t.domain, id: t.id, owner: "ai" })
          // Move queued todo work into Doing so the steward picks it up, mirroring toggleOwner.
          .then(() => (t.status === "todo" ? invoke("tasks_set_status", { vault: vaultPath, domain: t.domain, id: t.id, status: "doing" }) : null))));
      reload();
      window.dispatchEvent(new Event("prevail:tasks-changed"));
      setBulkMsg(`Handed ${targets.length} task${targets.length === 1 ? "" : "s"} to the agent.`);
    } catch (e) {
      console.error("assign all to agent", e);
      setBulkMsg(`Failed to assign: ${String(e)}`);
    } finally {
      setBusy(null);
      window.setTimeout(() => setBulkMsg(null), 4000);
    }
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
  // Cycle priority normal -> high -> critical -> normal (the importance signal
  // that drives due/critical alerting).
  const cyclePriority = async (t: BoardTask) => {
    if (!t.id) return;
    const next = t.priority === "critical" ? null : t.priority === "high" ? "critical" : "high";
    await act(`pr:${t.id}`, async () => {
      const cur = await invoke<BoardTask[]>("tasks_read", { vault: vaultPath, domain: t.domain });
      await invoke("tasks_set", { vault: vaultPath, domain: t.domain, tasks: cur.map((x) => (x.id === t.id ? { ...x, priority: next } : x)) });
    });
  };
  // Delete = soft-delete: tag the task ~trashed:<today> so it moves to Trash
  // (recoverable), never silently lost. Honors the "never delete user data" rule.
  const del = async (t: BoardTask) => {
    if (!t.id) return;
    const today = new Date().toISOString().slice(0, 10);
    await act(`d:${t.id}`, async () => {
      const cur = await invoke<BoardTask[]>("tasks_read", { vault: vaultPath, domain: t.domain });
      await invoke("tasks_set", { vault: vaultPath, domain: t.domain, tasks: cur.map((x) => (x.id === t.id ? { ...x, trashed: today } : x)) });
    });
  };
  // Restore a trashed task back to the board (clear the marker).
  const restore = async (t: BoardTask) => {
    if (!t.id) return;
    await act(`r:${t.id}`, async () => {
      const cur = await invoke<BoardTask[]>("tasks_read", { vault: vaultPath, domain: t.domain });
      await invoke("tasks_set", { vault: vaultPath, domain: t.domain, tasks: cur.map((x) => (x.id === t.id ? { ...x, trashed: null } : x)) });
    });
  };
  // Delete forever: actually remove the line. Only from the Trash view, with confirm.
  const purge = async (t: BoardTask) => {
    if (!t.id) return;
    if (!window.confirm(`Permanently delete "${t.text.slice(0, 60)}"? This cannot be undone.`)) return;
    await act(`p:${t.id}`, async () => {
      const cur = await invoke<BoardTask[]>("tasks_read", { vault: vaultPath, domain: t.domain });
      await invoke("tasks_set", { vault: vaultPath, domain: t.domain, tasks: cur.filter((x) => x.id !== t.id) });
    });
  };
  const setViewMode = (v: "board" | "list" | "horizon") => { setView(v); localStorage.setItem("prevail.board.view", v); };

  const renderCard = (t: BoardTask) => {
    const ai = t.owner === "ai";
    const blocked = t.status === "blocked";
    const overdue = isOverdue(t);
    const editing = editId != null && editId === t.id;
    return (
      <div key={`${t.domain}:${t.id ?? t.text}`}
        draggable={!editing && !!t.id}
        onDragStart={(e) => {
          if (!t.id) return;
          setDragId(t.id);
          // WKWebView (Tauri) only starts a drag if dataTransfer carries something.
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", t.id);
        }}
        onDragEnd={() => { setDragId(null); setDragCol(null); }}
        className={`rounded-lg border px-2.5 py-2 transition-opacity ${overdue ? "border-l-2 border-l-danger border-danger/40 bg-danger/5" : blocked ? "border-warn/40 bg-surface" : "border-border bg-surface"} ${dragId === t.id ? "opacity-40" : ""} ${editing ? "" : "cursor-grab active:cursor-grabbing"}`}>
        <div className="flex items-start gap-1.5">
          <span title={ai ? "Owned by the agent" : "Owned by you"} className={`mt-0.5 inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 font-mono text-[9px] font-bold uppercase tracking-wide ${ai ? "bg-accent text-background" : "bg-surface-warm text-text-muted"}`}>
            {ai ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}{ai ? "Agent" : "Me"}
          </span>
          {editing ? (
            <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)}
              onBlur={() => saveEdit(t)}
              onKeyDown={(e) => { if (e.key === "Enter") saveEdit(t); if (e.key === "Escape") setEditId(null); }}
              className="min-w-0 flex-1 rounded border border-accent-border bg-background px-1 py-0.5 text-[13px] text-text-primary focus:outline-none" />
          ) : (
            <span onClick={() => t.id && setOpenId(t.id)} title="Open task"
              className="min-w-0 flex-1 cursor-pointer text-[13px] leading-snug text-text-primary hover:text-accent">{t.text}</span>
          )}
          <button onClick={() => cyclePriority(t)} title={`Priority: ${t.priority || "normal"} - click to change`} disabled={busy === `pr:${t.id}`}
            className={`shrink-0 transition-colors ${t.priority === "critical" ? "text-danger" : t.priority === "high" ? "text-warn" : "text-text-muted/30 hover:text-text-muted"}`}>
            <Flag className="h-3.5 w-3.5" fill={t.priority === "critical" || t.priority === "high" ? "currentColor" : "none"} />
          </button>
          <button onClick={() => del(t)} title="Delete task" disabled={busy === `d:${t.id}`} className="shrink-0 text-text-muted/40 transition-colors hover:text-danger">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5 font-mono text-[10px]">
          <span className="rounded-full px-1.5 py-px font-semibold" style={{ color: domainColor(t.domain), backgroundColor: `${domainColor(t.domain)}1f` }}>{titleCase(t.domain)}</span>
          {t.due && <span className={`${dueTone(t.due)} ${overdue ? "font-bold" : ""}`}>{t.due}</span>}
          {overdue && <span className="rounded-full bg-danger/15 px-1.5 py-px font-bold uppercase tracking-wide text-danger">overdue</span>}
          {t.priority === "critical" && <span className="text-danger">critical</span>}
          {t.priority === "high" && <span className="text-warn">important</span>}
          {blocked && <span className="text-warn">⏸ needs decision</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 pl-5">
          <select value={t.status} onChange={(e) => setStatus(t, e.target.value)} disabled={busy === `s:${t.id}`}
            className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-text-secondary focus:border-accent-border focus:outline-none">
            {["todo", "doing", "review", "blocked", "done", "icebox"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <button onClick={() => toggleOwner(t)} disabled={busy === `o:${t.id}`}
            title={ai ? "Take it back from the agent (hand to me)" : "Hand to the agent to run as a workflow"}
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-50 ${ai ? "border-border text-text-muted hover:border-accent-border hover:text-text-primary" : "border-accent-border text-accent hover:bg-accent hover:text-background"}`}>
            {ai ? <CornerUpLeft className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
          </button>
        </div>
      </div>
    );
  };

  // List view: a full-width horizontal row (text grows, controls sit on the right).
  const renderRow = (t: BoardTask) => {
    const ai = t.owner === "ai";
    const blocked = t.status === "blocked";
    const overdue = isOverdue(t);
    const editing = editId != null && editId === t.id;
    return (
      <div key={`row:${t.domain}:${t.id ?? t.text}`}
        className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${overdue ? "border-l-2 border-l-danger border-danger/40 bg-danger/5" : blocked ? "border-warn/40 bg-surface" : "border-border bg-surface"}`}>
        <span title={ai ? "Owned by the agent" : "Owned by you"} className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 font-mono text-[9px] font-bold uppercase tracking-wide ${ai ? "bg-accent text-background" : "bg-surface-warm text-text-muted"}`}>
          {ai ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}{ai ? "Agent" : "Me"}
        </span>
        {editing ? (
          <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)}
            onBlur={() => saveEdit(t)}
            onKeyDown={(e) => { if (e.key === "Enter") saveEdit(t); if (e.key === "Escape") setEditId(null); }}
            className="min-w-0 flex-1 rounded border border-accent-border bg-background px-1.5 py-0.5 text-[13px] text-text-primary focus:outline-none" />
        ) : (
          <span onClick={() => t.id && setOpenId(t.id)} title="Open task"
            className={`min-w-0 flex-1 cursor-pointer truncate text-[13px] hover:text-accent ${t.status === "done" ? "text-text-muted line-through" : "text-text-primary"}`}>{t.text}</span>
        )}
        <span className="hidden shrink-0 rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-muted sm:inline">{titleCase(t.domain)}</span>
        {blocked && <span className="shrink-0 font-mono text-[10px] text-warn">⏸ decision</span>}
        {overdue && <span className="shrink-0 rounded-full bg-danger/15 px-1.5 py-px font-mono text-[10px] font-bold uppercase tracking-wide text-danger">overdue</span>}
        <span className={`hidden w-20 shrink-0 text-right font-mono text-[10px] md:inline ${dueTone(t.due)} ${overdue ? "font-bold" : ""}`}>{t.due || ""}</span>
        <button onClick={() => cyclePriority(t)} title={`Priority: ${t.priority || "normal"} - click to change`} disabled={busy === `pr:${t.id}`}
          className={`shrink-0 transition-colors ${t.priority === "critical" ? "text-danger" : t.priority === "high" ? "text-warn" : "text-text-muted/30 hover:text-text-muted"}`}>
          <Flag className="h-3.5 w-3.5" fill={t.priority === "critical" || t.priority === "high" ? "currentColor" : "none"} />
        </button>
        <select value={t.status} onChange={(e) => setStatus(t, e.target.value)} disabled={busy === `s:${t.id}`}
          className="shrink-0 rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-text-secondary focus:border-accent-border focus:outline-none">
          {["todo", "doing", "review", "blocked", "done", "icebox"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </select>
        <button onClick={() => toggleOwner(t)} disabled={busy === `o:${t.id}`}
          title={ai ? "Take it back from the agent (hand to me)" : "Hand to the agent to run as a workflow"}
          className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-50 ${ai ? "border-border text-text-muted hover:border-accent-border hover:text-text-primary" : "border-accent-border text-accent hover:bg-accent hover:text-background"}`}>
          {ai ? <CornerUpLeft className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
        </button>
        <button onClick={() => del(t)} title="Delete task" disabled={busy === `d:${t.id}`} className="shrink-0 text-text-muted/40 transition-colors hover:text-danger">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  // List view ordering: open work first (by column order), done last; then by due.
  const ORDER: Record<string, number> = { todo: 0, doing: 1, blocked: 1, review: 2, done: 3, icebox: 4 };
  const listed = useMemo(
    () => [...shown].sort((a, b) =>
      (ORDER[a.status] ?? 0) - (ORDER[b.status] ?? 0) ||
      (a.due || "9999").localeCompare(b.due || "9999")),
    [shown],
  );
  const [addErr, setAddErr] = useState<string | null>(null);
  // Brief auto-dismissing "Added" confirmation shown near the add bar.
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const addTask = () => {
    const text = addText.trim();
    const domain = (addDomain || addDomains[0] || "").trim();
    setAddErr(null);
    setAddMsg(null);
    if (!text) { setAddErr("Type a task first."); return; }
    if (!domain) { setAddErr("Create a domain first (no domain to add to)."); return; }
    const withDue = addDue ? `${text} @${addDue}` : text;
    setBusy("add");
    invoke("tasks_add", { vault: vaultPath, domain, text: withDue, source: "user" })
      .then(() => {
        setAddText("");
        setAddDue("");
        reload();
        window.dispatchEvent(new Event("prevail:tasks-changed"));
        // Make the new task visible. If the active domain filter would hide it,
        // switch the filter to its domain so the user immediately sees it land.
        const hidden = domainFilter !== "all" && domainFilter !== domain;
        if (hidden) {
          setDomainFilter(domain);
          setAddMsg(`Added to ${titleCase(domain)} - switched filter so you can see it`);
        } else {
          setAddMsg(`Added to ${titleCase(domain)}`);
        }
        setAddModalOpen(false);
        // Also make sure we are on a view that lists tasks (not Trash/Icebox/Needs).
        if (view === "trash" || view === "icebox" || view === "needs") setViewMode("list");
        window.setTimeout(() => setAddMsg(null), 4000);
      })
      .catch((e) => setAddErr(String(e)))
      .finally(() => setBusy(null));
  };

  return (
    <>
      {/* Pinned header: title, AI status, and all controls stay visible while the
          board/list scrolls. Negative margins cancel the page's px-8/py-10 so the
          backdrop goes edge-to-edge and flush to the top. */}
      <div className="sticky top-0 z-20 -mx-8 -mt-10 border-b border-border-subtle bg-background px-8 pb-3 pt-8">
      <SettingsHeader title="Work Board" icon={Briefcase}
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

      {/* Controls: compact. Key controls always visible (owner + view + Needs you
          + Add); secondary ones (Assign all, domain filter, Trash, Icebox) tuck
          behind "More", collapsed by default, to keep the bar uncluttered. */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {/* Owner filter (icon segmented) */}
        <div className="flex items-center overflow-hidden rounded-lg border border-border">
          {([["all", "All tasks", LayoutGrid], ["me", "Mine", User], ["ai", "AI-owned", Bot]] as const).map(([k, label, Icon], i) => (
            <button key={k} onClick={() => setOwnerFilter(k)}
              aria-pressed={ownerFilter === k} title={label}
              className={`inline-flex items-center justify-center px-2.5 py-1 transition-colors ${i > 0 ? "border-l border-border" : ""} ${
                ownerFilter === k
                  ? "bg-accent text-background shadow-inner"
                  : "bg-background text-text-secondary hover:bg-surface-warm hover:text-text-primary"
              }`}>
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        {/* View toggle (icons) */}
        <div className="flex items-center overflow-hidden rounded-lg border border-border">
          <button onClick={() => setViewMode("board")} title="Board view"
            className={`px-2.5 py-1 transition-colors ${view === "board" ? "bg-accent-soft text-accent" : "bg-background text-text-muted hover:bg-surface-warm"}`}>
            <Columns3 className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setViewMode("list")} title="List view"
            className={`px-2.5 py-1 transition-colors ${view === "list" ? "bg-accent-soft text-accent" : "bg-background text-text-muted hover:bg-surface-warm"}`}>
            <List className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setViewMode("horizon")} title="Horizon view: tasks by due date (today / week / month / quarter / year)"
            className={`px-2.5 py-1 transition-colors ${view === "horizon" ? "bg-accent-soft text-accent" : "bg-background text-text-muted hover:bg-surface-warm"}`}>
            <CalendarRange className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Needs you: the work that's waiting on your call (always visible). */}
        <button onClick={() => setView("needs")} title="Work waiting on your decision"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-colors ${view === "needs" ? "border-accent-border bg-accent-soft text-accent" : decisionsCount > 0 ? "border-warn/40 text-warn hover:bg-surface-warm" : "border-border text-text-muted hover:bg-surface-warm"}`}>
          <Inbox className="h-3.5 w-3.5" /> Needs you
          {decisionsCount > 0 && (
            <span className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-bold text-background">{decisionsCount}</span>
          )}
        </button>
        {/* More: reveal the secondary controls (collapsed by default). */}
        <button onClick={toggleMore} aria-pressed={moreOpen} title={moreOpen ? "Hide extra controls" : "More controls"}
          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 transition-colors ${moreOpen ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:bg-surface-warm"}`}>
          <SlidersHorizontal className="h-3.5 w-3.5" /> More <ChevronDown className={`h-3 w-3 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
        </button>
        {moreOpen && (
          <>
            {/* Bulk hand-off: assign every shown, me-owned, open task to the agent. */}
            <button onClick={assignAllToAgent} disabled={busy === "bulk-assign"}
              title="Hand every shown task you own to the agent at once (skips tasks awaiting your decision)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-2.5 py-1 font-medium text-accent transition-colors hover:bg-accent hover:text-background disabled:opacity-50">
              {busy === "bulk-assign" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Assign all to Agent
            </button>
            {/* Domain filter (icon + native select) */}
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background pl-2.5 text-text-muted focus-within:border-accent-border">
              <Filter className="h-3.5 w-3.5" />
              <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}
                className="cursor-pointer appearance-none bg-transparent py-1 pr-2 text-text-secondary focus:outline-none">
                <option value="all">All domains</option>
                {domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
              </select>
            </div>
            {/* Trash: soft-deleted tasks, recoverable. */}
            <button onClick={() => setView("trash")} title="Deleted tasks (recoverable)"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-colors ${view === "trash" ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:bg-surface-warm"}`}>
              <Trash2 className="h-3.5 w-3.5" /> Trash
              {trashed.length > 0 && (
                <span className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-surface-warm px-1 font-mono text-[9px] font-bold text-text-secondary">{trashed.length}</span>
              )}
            </button>
            {/* Icebox: tasks set aside (won't do, not done) - recoverable. */}
            <button onClick={() => setView("icebox")} title="Set-aside tasks (recoverable)"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-colors ${view === "icebox" ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:bg-surface-warm"}`}>
              <Snowflake className="h-3.5 w-3.5" /> Icebox
              {iceboxed.length > 0 && (
                <span className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-surface-warm px-1 font-mono text-[9px] font-bold text-text-secondary">{iceboxed.length}</span>
              )}
            </button>
          </>
        )}
        {/* Add task (always visible) - opens a popup so the toolbar stays clean. */}
        <button onClick={() => { setAddErr(null); setAddModalOpen(true); }} title="Add a task"
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1 font-semibold text-background hover:bg-accent-hover">
          <Plus className="h-3.5 w-3.5" /> Add task
        </button>
      </div>
      {/* Add-task popup modal: task text, domain, optional due date. */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => setAddModalOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">Add a task</span>
              <button onClick={() => setAddModalOpen(false)} className="rounded p-1 text-text-muted hover:bg-surface-warm hover:text-text-primary"><X className="h-4 w-4" /></button>
            </div>
            <input autoFocus value={addText} onChange={(e) => { setAddText(e.target.value); if (addErr) setAddErr(null); }} onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
              placeholder="What needs doing?" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none" />
            <div className="mt-2 flex items-center gap-2">
              {addDomains.length > 0 && (
                <select value={addDomain} onChange={(e) => setAddDomain(e.target.value)} title="Domain"
                  className="min-w-0 flex-1 cursor-pointer rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-secondary focus:border-accent-border focus:outline-none">
                  {addDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
                </select>
              )}
              <input type="date" value={addDue} onChange={(e) => setAddDue(e.target.value)} title="Due date (optional)"
                className="cursor-pointer rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-muted focus:border-accent-border focus:outline-none" />
            </div>
            {addErr && <div className="mt-2 text-[12px] text-danger">{addErr}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setAddModalOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
              <button onClick={addTask} disabled={busy === "add"} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add task
              </button>
            </div>
          </div>
        </div>
      )}
      {bulkMsg && (
        <div className="mt-1.5 flex justify-start">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${bulkMsg.startsWith("Failed") ? "bg-danger/15 text-danger" : "bg-accent-soft text-accent"}`}>
            <Bot className="h-3 w-3" /> {bulkMsg}
          </span>
        </div>
      )}
      {addErr && <div className="mt-1.5 text-right text-[11px] text-danger">{addErr}</div>}
      {addMsg && !addErr && (
        <div className="mt-1.5 flex justify-end">
          <span className="inline-flex items-center gap-1 rounded-md bg-ok/15 px-2 py-0.5 text-[11px] font-medium text-ok">
            <Check className="h-3 w-3" /> {addMsg}
          </span>
        </div>
      )}
      </div>

      <div className="pt-4">
      {view === "needs" ? (
        <DecisionInbox vaultPath={vaultPath} />
      ) : view === "trash" ? (
        <div className="flex flex-col gap-1.5">
          <div className="mb-1 flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-text-muted" />
            <span className="font-semibold text-text-primary">Trash</span>
            <span className="text-xs text-text-muted">{trashed.length === 0 ? "empty" : `${trashed.length} deleted - restore or delete forever`}</span>
          </div>
          {trashed.map((t) => (
            <div key={`${t.domain}:${t.id ?? t.text}`} className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary line-through">{t.text}</span>
              <span className="shrink-0 rounded-full bg-surface-warm px-1.5 py-px font-mono text-[10px] text-text-muted">{titleCase(t.domain)}</span>
              {t.trashed && <span className="shrink-0 font-mono text-[10px] text-text-muted/60">deleted {t.trashed}</span>}
              <button onClick={() => restore(t)} disabled={busy === `r:${t.id}`} title="Restore to board"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
                <RotateCcw className="h-3 w-3" /> Restore
              </button>
              <button onClick={() => purge(t)} disabled={busy === `p:${t.id}`} title="Delete permanently (cannot be undone)"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-danger hover:text-danger disabled:opacity-50">
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>
          ))}
          {trashed.length === 0 && (
            <div className="rounded-xl border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
              Trash is empty. Deleted tasks land here and can be restored.
            </div>
          )}
        </div>
      ) : view === "icebox" ? (
        <div className="flex flex-col gap-1.5">
          <div className="mb-1 flex items-center gap-2">
            <Snowflake className="h-4 w-4 text-text-muted" />
            <span className="font-semibold text-text-primary">Icebox</span>
            <span className="text-xs text-text-muted">{iceboxed.length === 0 ? "empty" : `${iceboxed.length} set aside - change status to bring back`}</span>
          </div>
          {iceboxed.map((t) => (
            <div key={`ice:${t.domain}:${t.id ?? t.text}`} className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2">
              <span onClick={() => t.id && setOpenId(t.id)} title="Open task"
                className="min-w-0 flex-1 cursor-pointer truncate text-[13px] text-text-secondary hover:text-accent">{t.text}</span>
              <span className="shrink-0 rounded-full bg-surface-warm px-1.5 py-px font-mono text-[10px] text-text-muted">{titleCase(t.domain)}</span>
              <select value={t.status} onChange={(e) => setStatus(t, e.target.value)} disabled={busy === `s:${t.id}`}
                className="shrink-0 rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-text-secondary focus:border-accent-border focus:outline-none">
                {["todo", "doing", "review", "blocked", "done", "icebox"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </div>
          ))}
          {iceboxed.length === 0 && (
            <div className="rounded-xl border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
              Icebox is empty. Set a task's status to icebox to park it here without marking it done.
            </div>
          )}
        </div>
      ) : view === "horizon" ? (
        <div className="flex flex-col gap-4">
          {HORIZONS.map((h) => {
            const items = byHorizon[h.key] ?? [];
            if (items.length === 0) return null; // only show buckets that have work
            const isOverdueBucket = h.key === "overdue";
            const tone = isOverdueBucket ? "text-danger" : h.key === "today" ? "text-warn" : "text-text-muted";
            return (
              <section key={h.key}>
                <div className={`mb-2 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.16em] ${tone} ${isOverdueBucket ? "font-bold" : ""}`}>
                  {isOverdueBucket && <Flag className="h-3 w-3" fill="currentColor" />}
                  {h.label}<span className="opacity-50">· {items.length}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {items.map(renderRow)}
                </div>
              </section>
            );
          })}
          {HORIZONS.every((h) => (byHorizon[h.key] ?? []).length === 0) && (
            <div className="rounded-xl border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
              No open tasks with due dates. Add due dates to plan by horizon.
            </div>
          )}
        </div>
      ) : view === "board" ? (
        // Flex (not a fixed 5-col grid) so a collapsed column shrinks to a slim
        // strip and the expanded ones flex-grow to fill the freed space.
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-stretch xl:flex-nowrap">
          {COLUMNS.map((col) => {
            const items = byColumn[col.key] ?? [];
            const over = dragCol === col.key && dragId;
            // Icebox is a parking lot, not an active stage - set it apart with a
            // dashed border + snowflake so it reads as "set aside" at a glance.
            const isIcebox = col.key === "icebox";
            const collapsed = collapsedCols.has(col.key);
            const tone = over ? "border-accent-border bg-accent-soft/40" : isIcebox ? "border-dashed border-border-subtle bg-surface/20" : "border-border-subtle bg-surface/40";
            if (collapsed) {
              // A slim vertical strip: click anywhere (or the chevron) to expand;
              // still a drop target so you can drag a card onto a collapsed column.
              return (
                <section key={col.key}
                  onDragOver={(e) => { if (dragId) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragCol(col.key); } }}
                  onDragLeave={() => setDragCol((c) => (c === col.key ? null : c))}
                  onDrop={(e) => { e.preventDefault(); onDrop(col.key); }}
                  onClick={() => toggleCol(col.key)}
                  title={`${col.label} (${items.length}) - click to expand`}
                  className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border p-2 transition-colors hover:bg-surface-warm sm:w-10 sm:flex-col ${tone}`}>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted sm:mt-1 sm:[writing-mode:vertical-rl]">
                    {isIcebox && <Snowflake className="h-3 w-3" />}
                    {col.label}<span className="text-text-muted/50">· {items.length}</span>
                  </div>
                </section>
              );
            }
            return (
              <section key={col.key}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragCol(col.key); } }}
                onDragLeave={() => setDragCol((c) => (c === col.key ? null : c))}
                onDrop={(e) => { e.preventDefault(); onDrop(col.key); }}
                className={`rounded-xl border p-2 transition-colors sm:min-w-[200px] sm:flex-1 ${tone}`}>
                {(() => { const limit = colLimits[col.key] ?? PAGE; const more = items.length - limit; return (
                <>
                <div className="mb-2 flex items-center gap-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  {isIcebox && <Snowflake className="h-3 w-3" />}
                  {col.label}<span className="text-text-muted/50">· {Math.min(items.length, limit)}{items.length > limit ? "+" : ""}</span>
                  <button onClick={() => toggleCol(col.key)} title="Collapse column"
                    className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex min-h-[2.5rem] flex-col gap-2">
                  {items.slice(0, limit).map(renderCard)}
                  {items.length === 0 && <div className="px-1 py-3 text-center text-[11px] text-text-muted/50">{over ? "drop here" : "-"}</div>}
                  {more > 0 && (
                    <button onClick={() => showMore(col.key)}
                      className="mt-0.5 rounded-md border border-dashed border-border-subtle px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-wider text-text-muted transition-colors hover:border-accent-border hover:text-accent">
                      Show {Math.min(PAGE, more)} more
                    </button>
                  )}
                </div>
                </>
                ); })()}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {listed.slice(0, listLimit).map(renderRow)}
          {listed.length > listLimit && (
            <button onClick={() => setListLimit((n) => n + PAGE)}
              className="mt-0.5 rounded-md border border-dashed border-border-subtle px-2 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-text-muted transition-colors hover:border-accent-border hover:text-accent">
              Show {Math.min(PAGE, listed.length - listLimit)} more ({listed.length - listLimit} not shown)
            </button>
          )}
          {listed.length === 0 && (
            <div className="rounded-xl border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
              No tasks yet. Add one above, or hand work to AI.
            </div>
          )}
        </div>
      )}
      </div>
      {openId && (() => {
        const t = tasks.find((x) => x.id === openId);
        return t ? (
          <TaskDetailPanel
            task={t}
            vaultPath={vaultPath}
            onClose={() => setOpenId(null)}
            onChanged={reload}
          />
        ) : null;
      })()}
    </>
  );
}
