// Decision Inbox (Workflows-Kanban P0) - one cross-domain list of the things that
// need YOUR call: loop approvals queued in any domain, plus AI tasks that finished
// and want sign-off. The labor is the AI's; the decision is yours. Reads
// decisions_pending; actions reuse the existing loop execute / task plumbing.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, Inbox, Loader2, ListPlus, Play, RotateCcw, Clock, X } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase, relTime } from "./format";
import { PREF, getPref } from "./storage";
import { startProcess, endProcess } from "./processes";
import type { DecisionItem } from "./types";

const SNOOZE_KEY = "prevail:decisions:snoozed";
const DAY_MS = 24 * 60 * 60 * 1000;

function readSnoozed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}"); } catch { return {}; }
}
function writeSnoozed(m: Record<string, number>) {
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

export function DecisionInbox({ vaultPath }: { vaultPath: string }) {
  const [items, setItems] = useState<DecisionItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ text: string; report: string } | null>(null);
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => readSnoozed());
  const [showSnoozed, setShowSnoozed] = useState(false);

  const reload = useCallback(() => {
    invoke<DecisionItem[]>("decisions_pending", { vault: vaultPath })
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch((e) => console.error("decisions_pending", e));
  }, [vaultPath]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const f = () => reload();
    window.addEventListener("prevail:tasks-changed", f);
    window.addEventListener("prevail:loops-advanced", f);
    return () => {
      window.removeEventListener("prevail:tasks-changed", f);
      window.removeEventListener("prevail:loops-advanced", f);
    };
  }, [reload]);

  const now = Date.now();
  const { active, sleeping } = useMemo(() => {
    const a: DecisionItem[] = []; const s: DecisionItem[] = [];
    for (const it of items) ((snoozed[it.id] ?? 0) > now ? s : a).push(it);
    return { active: a, sleeping: s };
  }, [items, snoozed, now]);

  const after = () => { reload(); window.dispatchEvent(new Event("prevail:tasks-changed")); };

  const dropLoop = (it: DecisionItem) =>
    invoke("loop_pending_drop", { vault: vaultPath, domain: it.domain, loopId: it.loopId, text: it.text });

  const approveRun = async (it: DecisionItem) => {
    setBusy(it.id); setReport(null);
    // Show it as a running process so executing an approval is visible system-wide.
    const procId = `exec-${it.id}-${Date.now()}`;
    const short = it.text.length > 48 ? `${it.text.slice(0, 48)}…` : it.text;
    startProcess(procId, "loop", `${titleCase(it.domain || "general")} · Executing: ${short}`, it.domain);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = getPref(PREF.distillModel, "claude-haiku-4-5");
      const rep = await invoke<string>("loop_execute_action", { vault: vaultPath, domain: it.domain, action: it.text, provider, model });
      try {
        await invoke("decision_append", { vault: vaultPath, domain: it.domain, record: { kind: "decision", source: "inbox-exec", action: it.text, report: rep, ts: Date.now() } });
      } catch { /* best effort */ }
      // Clear the source: a loop approval drops from the queue; an AI task that was
      // blocked moves to review now that it's been run.
      if (it.source === "task" && it.taskId) {
        await invoke("tasks_set_status", { vault: vaultPath, domain: it.domain, id: it.taskId, status: "review" });
      } else {
        await dropLoop(it);
      }
      setReport({ text: it.text, report: rep.trim() || "(no report)" });
      after();
    } catch (e) {
      setReport({ text: it.text, report: `Execution failed: ${e}` });
    } finally { setBusy(null); endProcess(procId); }
  };

  // Loop approval → file it as your own task (then clear the approval). Blocked AI
  // task → hand it back to you: owner me, todo (the steward won't re-pick it).
  const makeTask = async (it: DecisionItem) => {
    setBusy(it.id);
    try {
      if (it.source === "task" && it.taskId) {
        await invoke("tasks_set_owner", { vault: vaultPath, domain: it.domain, id: it.taskId, owner: "me" });
        await invoke("tasks_set_status", { vault: vaultPath, domain: it.domain, id: it.taskId, status: "todo" });
      } else {
        await invoke("tasks_add", { vault: vaultPath, domain: it.domain, text: it.text, source: "loop" });
        await dropLoop(it);
      }
      after();
    } catch (e) { console.error("make task", e); } finally { setBusy(null); }
  };

  const dismiss = async (it: DecisionItem) => {
    setBusy(it.id);
    try { await dropLoop(it); after(); }
    catch (e) { console.error("dismiss", e); } finally { setBusy(null); }
  };

  const snooze = (it: DecisionItem) => {
    const next = { ...snoozed, [it.id]: Date.now() + DAY_MS };
    setSnoozed(next); writeSnoozed(next);
  };
  const unsnooze = (it: DecisionItem) => {
    const next = { ...snoozed }; delete next[it.id];
    setSnoozed(next); writeSnoozed(next);
  };

  // Review-task actions (AI finished; accept the result or send it back).
  const reviewSet = async (it: DecisionItem, status: string) => {
    if (!it.taskId) return;
    setBusy(it.id);
    try {
      await invoke("tasks_set_status", { vault: vaultPath, domain: it.domain, id: it.taskId, status });
      after();
    } catch (e) { console.error("review set", e); } finally { setBusy(null); }
  };

  const card = (it: DecisionItem) => {
    const isReview = it.kind === "review";
    const running = busy === it.id;
    const asleep = (snoozed[it.id] ?? 0) > now;
    return (
      <div key={it.id} className="rounded-xl border border-border bg-surface px-3.5 py-3">
        <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
          <span className={isReview ? "text-accent" : "text-warn"}>{isReview ? <Bot className="h-3 w-3" /> : <Play className="h-3 w-3" />}</span>
          {titleCase(it.domain)}
          <span className="text-text-muted/50">· {isReview ? "review" : "approval"}</span>
          {it.ts ? <span className="text-text-muted/50">· queued {relTime(it.ts)}</span> : null}
        </div>
        <div className="text-[13px] leading-snug text-text-primary">{it.text}</div>
        {it.why && <div className="mt-0.5 text-[11px] text-text-muted">{it.why}</div>}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {running && <span className="inline-flex items-center gap-1 text-[11px] text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> working…</span>}
          {!running && isReview && (
            <>
              <button onClick={() => reviewSet(it, "done")} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover">
                <Check className="h-3 w-3" /> Accept
              </button>
              <button onClick={() => reviewSet(it, "doing")} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-border hover:text-accent">
                <RotateCcw className="h-3 w-3" /> Re-run
              </button>
            </>
          )}
          {!running && !isReview && (
            <>
              <button onClick={() => approveRun(it)} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover">
                <Play className="h-3 w-3" /> Approve &amp; run
              </button>
              <button onClick={() => makeTask(it)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-border hover:text-accent">
                <ListPlus className="h-3 w-3" /> {it.source === "task" ? "Hand to me" : "Make a task"}
              </button>
              {asleep
                ? <button onClick={() => unsnooze(it)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary"><Clock className="h-3 w-3" /> Unsnooze</button>
                : <button onClick={() => snooze(it)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary"><Clock className="h-3 w-3" /> Snooze</button>}
              {it.source === "loop" && (
                <button onClick={() => dismiss(it)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:!text-danger"><X className="h-3 w-3" /> Dismiss</button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full">
      {/* Section header matches the board's column headers (compact mono caps). */}
      <div className="mb-2 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
        <Inbox className="h-3 w-3" /> Needs you
        <span className="text-text-muted/50">· {active.length || "0"}</span>
        {sleeping.length > 0 && (
          <button onClick={() => setShowSnoozed((s) => !s)} className="ml-auto normal-case tracking-normal text-text-muted hover:text-text-secondary">
            snoozed ({sleeping.length}) {showSnoozed ? "▾" : "▸"}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {active.length === 0 && (
          <div className="rounded-xl border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
            Nothing needs you right now. AI-owned tasks queue their approvals and sign-offs here.
          </div>
        )}
        {active.map(card)}
      </div>

      {showSnoozed && sleeping.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">Snoozed</div>
          <div className="flex flex-col gap-2.5 opacity-70">{sleeping.map(card)}</div>
        </div>
      )}

      {report && (
        <div className="mt-5 rounded-xl border border-border bg-surface/60 px-3.5 py-3">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">Result · {report.text}</div>
          <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-text-secondary">{report.report}</div>
        </div>
      )}
    </div>
  );
}
