// Workflows-Kanban (P0) — the cross-domain task board. Tasks are owned by Me or
// AI and flow across columns (To-do / Doing / Review / Done). AI-owned tasks run
// as workflows via the Loop steward; anything consequential surfaces in the
// Decision Inbox. Reads tasks_read_all; moves via tasks_set_status/tasks_set_owner.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, Plus, User, X } from "lucide-react";
import { invoke } from "./bridge";
import { SettingsHeader } from "./sectionutil";
import { titleCase } from "./format";
import type { BoardTask } from "./types";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [addText, setAddText] = useState("");
  const [addDomain, setAddDomain] = useState("");
  const [addDue, setAddDue] = useState("");

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

  const domains = useMemo(() => [...new Set(tasks.map((t) => t.domain))].sort(), [tasks]);
  useEffect(() => { if (!addDomain && domains.length) setAddDomain(domains[0]); }, [domains, addDomain]);

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

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); reload(); window.dispatchEvent(new Event("prevail:tasks-changed")); }
    catch (e) { console.error("board action", e); }
    finally { setBusy(null); }
  };
  const setStatus = (t: BoardTask, status: string) =>
    t.id && act(`s:${t.id}`, () => invoke("tasks_set_status", { vault: vaultPath, domain: t.domain, id: t.id, status }));
  const setOwner = (t: BoardTask, owner: string) =>
    t.id && act(`o:${t.id}`, () => invoke("tasks_set_owner", { vault: vaultPath, domain: t.domain, id: t.id, owner }));
  const del = async (t: BoardTask) => {
    if (!t.id) return;
    await act(`d:${t.id}`, async () => {
      const cur = await invoke<{ id?: string | null }[]>("tasks_read", { vault: vaultPath, domain: t.domain });
      await invoke("tasks_set", { vault: vaultPath, domain: t.domain, tasks: cur.filter((x) => x.id !== t.id) });
    });
  };
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
      <SettingsHeader title="Board" icon={Check}
        subtitle="Your tasks as a board — owned by you or handed to AI. AI-owned tasks run as workflows and ask you to decide anything consequential in the Decision Inbox." />

      {/* Controls: owner filter · domain filter · add */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
        <div className="ml-auto flex items-center gap-1.5">
          <input value={addText} onChange={(e) => setAddText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
            placeholder="Add a task…" className="w-48 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none" />
          {domains.length > 0 && (
            <select value={addDomain} onChange={(e) => setAddDomain(e.target.value)} title="Domain"
              className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none">
              {domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
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

      {/* Columns */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = byColumn[col.key] ?? [];
          return (
            <section key={col.key} className="rounded-xl border border-border-subtle bg-surface/40 p-2">
              <div className="mb-2 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                {col.label}<span className="text-text-muted/50">· {items.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {items.map((t) => {
                  const ai = t.owner === "ai";
                  const blocked = t.status === "blocked";
                  return (
                    <div key={`${t.domain}:${t.id ?? t.text}`} className={`group rounded-lg border bg-surface px-2.5 py-2 ${blocked ? "border-warn/40" : "border-border"}`}>
                      <div className="flex items-start gap-1.5">
                        <span title={ai ? "AI" : "Me"} className={`mt-0.5 shrink-0 ${ai ? "text-accent" : "text-text-muted"}`}>
                          {ai ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1 text-[13px] leading-snug text-text-primary">{t.text}</span>
                        <button onClick={() => del(t)} title="Delete" className="shrink-0 text-text-muted/0 transition-colors group-hover:text-text-muted hover:!text-danger">
                          <X className="h-3 w-3" />
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
                        <button onClick={() => setOwner(t, ai ? "me" : "ai")} disabled={busy === `o:${t.id}`}
                          title={ai ? "Take it back" : "Hand to AI to run as a workflow"}
                          className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50">
                          {ai ? "→ Me" : "→ AI"}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && <div className="px-1 py-3 text-center text-[11px] text-text-muted/50">—</div>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
