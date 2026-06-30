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

// A queued Google Workspace WRITE action, awaiting your approval. Reads run
// automatically inside chat; anything that writes (send an email, change or
// delete something) is queued by the CLI to <vault>/_meta/pending_gws.json and
// surfaced here under "Needs you". Shape matches the CLI contract.
type GwsPending = { id: string; domain: string; summary: string; args?: string[]; ts?: number };

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
  // Queued Google Workspace writes awaiting approval, plus ids dismissed locally
  // (v1 has no CLI drop command, so a dismiss just hides the card; the item stays
  // in pending_gws.json until run).
  const [gws, setGws] = useState<GwsPending[]>([]);
  const [gwsDismissed, setGwsDismissed] = useState<Record<string, boolean>>({});

  const reload = useCallback(() => {
    invoke<DecisionItem[]>("decisions_pending", { vault: vaultPath })
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch((e) => console.error("decisions_pending", e));
    invoke<GwsPending[]>("engine_gws_pending_list", { vault: vaultPath })
      .then((d) => setGws(Array.isArray(d) ? d : []))
      .catch((e) => console.error("engine_gws_pending_list", e));
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
      // Mint a single-use approval token bound to this exact action (C1/O16),
      // then execute with it — the backend verifies approval, not UI trust.
      const approval = await invoke<string>("loop_request_approval", { domain: it.domain, action: it.text });
      const rep = await invoke<string>("loop_execute_action", { vault: vaultPath, domain: it.domain, action: it.text, approval, provider, model });
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

  // The visible gws queue (locally dismissed ones hidden).
  const gwsVisible = useMemo(() => gws.filter((g) => !gwsDismissed[g.id]), [gws, gwsDismissed]);

  // Approve & run ONE queued Google Workspace write. Mints a single-use token
  // bound to this exact (domain, summary), then hands it to the backend, which
  // re-verifies it before running the exact stored command. Same token spine as
  // loop approvals, so a UI bug can't drive a gws write without real approval.
  const gwsApprove = async (g: GwsPending) => {
    setBusy(g.id); setReport(null);
    const procId = `gws-${g.id}-${Date.now()}`;
    const short = g.summary.length > 48 ? `${g.summary.slice(0, 48)}…` : g.summary;
    startProcess(procId, "loop", `${titleCase(g.domain || "google")} · Running: ${short}`, g.domain);
    try {
      const approval = await invoke<string>("loop_request_approval", { domain: g.domain, action: g.summary });
      const res = await invoke<{ ok?: boolean; output?: string; error?: string }>("engine_gws_approve", { vault: vaultPath, id: g.id, domain: g.domain, summary: g.summary, approval });
      const text = (res?.error || res?.output || (res?.ok ? "Done." : "(no output)")).trim();
      setReport({ text: g.summary, report: text });
      // Remove the card: it has run (or errored). Drop it from the queue locally.
      setGws((prev) => prev.filter((x) => x.id !== g.id));
    } catch (e) {
      setReport({ text: g.summary, report: `Execution failed: ${e}` });
    } finally { setBusy(null); endProcess(procId); }
  };

  // Dismiss: v1 has no CLI drop, so just hide it locally (the item stays in
  // pending_gws.json until it is actually run).
  const gwsDismiss = (g: GwsPending) => setGwsDismissed((m) => ({ ...m, [g.id]: true }));

  const gwsCard = (g: GwsPending) => {
    const running = busy === g.id;
    const cmd = Array.isArray(g.args) ? g.args.join(" ") : "";
    return (
      <div key={g.id} className="rounded-xl border border-border bg-surface px-3.5 py-3">
        <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
          <span className="text-warn"><Play className="h-3 w-3" /></span>
          {titleCase(g.domain || "google")}
          <span className="text-text-muted/50">· google</span>
          {g.ts ? <span className="text-text-muted/50">· queued {relTime(g.ts)}</span> : null}
        </div>
        <div className="text-[13px] leading-snug text-text-primary">{g.summary}</div>
        {cmd && <div className="mt-0.5 break-all font-mono text-[11px] text-text-muted">{cmd}</div>}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {running && <span className="inline-flex items-center gap-1 text-[11px] text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> working…</span>}
          {!running && (
            <>
              <button onClick={() => gwsApprove(g)} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover">
                <Play className="h-3 w-3" /> Approve &amp; run
              </button>
              <button onClick={() => gwsDismiss(g)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:!text-err">
                <X className="h-3 w-3" /> Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    );
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
                <button onClick={() => dismiss(it)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:!text-err"><X className="h-3 w-3" /> Dismiss</button>
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
        <span className="text-text-muted/50">· {active.length + gwsVisible.length || "0"}</span>
        {sleeping.length > 0 && (
          <button onClick={() => setShowSnoozed((s) => !s)} className="ml-auto normal-case tracking-normal text-text-muted hover:text-text-secondary">
            snoozed ({sleeping.length}) {showSnoozed ? "▾" : "▸"}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {active.length === 0 && gwsVisible.length === 0 && (
          <div className="rounded-xl border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
            Nothing needs you right now. AI-owned tasks queue their approvals and sign-offs here.
          </div>
        )}
        {gwsVisible.map(gwsCard)}
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
