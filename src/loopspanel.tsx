// Loops surface for a domain: the desired state up top, then the standing loops
// that work to close the gap to it. Loops are collapsed by default (the page
// reads as a list of forces); expand one to see its signals, condition, cadence,
// and current actions. The runner daemon (separate) evaluates enabled loops and
// keeps their actions current; here you define and steer them.
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, Infinity as InfinityIcon, Loader2, ListPlus, Play, Plus, RefreshCw, ShieldQuestion, Target, Trash2, X, Zap } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { PREF, getPref } from "./storage";
import { startProcess, endProcess } from "./processes";
import { Toggle } from "./ui";
import { CollapsibleSection } from "./collapsible";
import {
  AUTONOMY_BLURB,
  AUTONOMY_LABEL,
  CADENCE_LABEL,
  type Loop,
  type LoopAutonomy,
  type LoopCadence,
  type LoopRtEntry,
  type LoopType,
  type LoopsDoc,
  type LoopsRuntime,
  hasSeed,
  makeLoop,
  readLoops,
  readLoopsRuntime,
  seedLoopsFor,
  writeLoops,
  writeLoopsRuntime,
} from "./loops";

const CADENCES: LoopCadence[] = ["continuous", "daily", "weekly", "monthly"];

export function LoopsPanel({ domain, vaultPath, domainPath }: { domain: string; vaultPath: string; domainPath: string }) {
  const [doc, setDoc] = useState<LoopsDoc | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<LoopType>("open");
  const [newCadence, setNewCadence] = useState<LoopCadence>("weekly");
  const [newPurpose, setNewPurpose] = useState("");
  const [newAutonomy, setNewAutonomy] = useState<LoopAutonomy>("ask");
  const [savedAt, setSavedAt] = useState(0);
  const [runtime, setRuntime] = useState<LoopsRuntime>({ schema: 1, loops: {} });
  // The per-domain Ideal State is EDITED in Context now (S4), not here. Loops only
  // READ it to measure the gap. Load it and auto-mirror into the loops doc's
  // desiredState so the engine (which reads desiredState) keeps working without an
  // editor on this page.
  const [ideal, setIdeal] = useState<string>("");
  useEffect(() => {
    invoke<string>("read_domain_ideal", { vault: vaultPath, domain }).then((s) => setIdeal(s || "")).catch(() => setIdeal(""));
  }, [vaultPath, domain]);
  // Keep the engine mirror in sync (read-only): if the domain ideal differs from
  // the loops doc's desiredState, write it through once loaded.
  useEffect(() => {
    if (doc && ideal && doc.desiredState !== ideal) persist({ ...doc, desiredState: ideal });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideal, doc]);

  useEffect(() => {
    let alive = true;
    readLoops(domainPath).then((d) => { if (alive) setDoc(d); });
    readLoopsRuntime(domainPath).then((rt) => { if (alive) setRuntime(rt); });
    // The background loop runner advances loops + queues approvals; refresh when
    // it reports a pass so new actions/proposals appear without a manual reload.
    const onAdvanced = () => {
      readLoops(domainPath).then((d) => { if (alive) setDoc(d); });
      readLoopsRuntime(domainPath).then((rt) => { if (alive) setRuntime(rt); });
    };
    window.addEventListener("prevail:loops-advanced", onAdvanced);
    return () => { alive = false; window.removeEventListener("prevail:loops-advanced", onAdvanced); };
  }, [domainPath]);

  // Pending approvals across all of this domain's loops (the steps a loop is
  // ASKING the user to OK before it acts).
  const pending = doc
    ? doc.loops.flatMap((l) =>
        (runtime.loops[l.id]?.pending ?? []).map((p) => ({ loopId: l.id, loopName: l.name, text: p.text, ts: p.ts })),
      )
    : [];

  const dropPending = useCallback(async (loopId: string, text: string) => {
    // Re-read fresh from disk before writing: the background loop daemon rewrites
    // the whole runtime doc, so basing the write on stale in-memory state could
    // clobber a just-added pending/history entry. Narrows the race to ~ms.
    const fresh = await readLoopsRuntime(domainPath);
    const entry = fresh.loops[loopId];
    if (!entry) { setRuntime(fresh); return; }
    const next: LoopsRuntime = { ...fresh, loops: { ...fresh.loops, [loopId]: { ...entry, pending: entry.pending.filter((p) => p.text !== text) } } };
    await writeLoopsRuntime(domainPath, next);
    setRuntime(next);
  }, [domainPath]);

  const resolvePending = useCallback(async (loopId: string, text: string, approve: boolean) => {
    if (approve) {
      try { await invoke("tasks_add", { vault: vaultPath, domain, text, source: "loop" }); }
      catch (e) { console.error("approve loop action → task", e); return; }
    }
    dropPending(loopId, text);
  }, [vaultPath, domain, dropPending]);

  // Execute a pending action FOR REAL via the agent's connectors/tools. Records
  // the outcome as a decision (provenance) and removes it from the queue.
  const [execBusy, setExecBusy] = useState<string | null>(null);
  const [execReport, setExecReport] = useState<{ action: string; report: string } | null>(null);
  const executePending = useCallback(async (loopId: string, text: string) => {
    setExecBusy(text);
    setExecReport(null);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = getPref(PREF.distillModel, "claude-haiku-4-5");
      const report = await invoke<string>("loop_execute_action", { vault: vaultPath, domain, action: text, provider, model });
      // Record what was done as a domain decision (provenance the loop learns from).
      try {
        await invoke("decision_append", { vault: vaultPath, domain, record: { kind: "decision", source: "loop-exec", action: text, report, ts: Date.now() } });
      } catch { /* best effort */ }
      setExecReport({ action: text, report: report.trim() || "(no report)" });
      dropPending(loopId, text);
    } catch (e) {
      setExecReport({ action: text, report: `Execution failed: ${e}` });
    } finally {
      setExecBusy(null);
    }
  }, [vaultPath, domain, dropPending]);

  // Single persistence path: update local state, then write the whole doc.
  const persist = useCallback(async (next: LoopsDoc) => {
    setDoc(next);
    try { await writeLoops(domainPath, next); setSavedAt(Date.now()); }
    catch (e) { console.error("write loops", e); }
  }, [domainPath]);

  const mutateLoop = useCallback((id: string, patch: Partial<Loop>) => {
    if (!doc) return;
    persist({ ...doc, loops: doc.loops.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }, [doc, persist]);

  const removeLoop = useCallback((id: string) => {
    if (!doc) return;
    persist({ ...doc, loops: doc.loops.filter((l) => l.id !== id) });
  }, [doc, persist]);

  const addLoop = useCallback(() => {
    if (!doc || !newName.trim()) return;
    const loop = makeLoop({ name: newName.trim(), type: newType, cadence: newCadence, autonomy: newAutonomy, purpose: newPurpose.trim(), status: "active", enabled: true });
    persist({ ...doc, loops: [...doc.loops, loop] });
    setNewName(""); setNewType("open"); setNewCadence("weekly"); setNewPurpose(""); setNewAutonomy("ask"); setAdding(false);
    setOpenIds((s) => new Set(s).add(loop.id));
  }, [doc, newName, newType, newCadence, newPurpose, newAutonomy, persist]);

  const toggleOpen = (id: string) => setOpenIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Trigger one engine pass over this domain's due loops, then reload so the
  // refreshed actions show up. The same runner also runs in the background.
  const [running, setRunning] = useState(false);
  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      await invoke("loops_run_once", { vault: vaultPath });
      setDoc(await readLoops(domainPath));
      setRuntime(await readLoopsRuntime(domainPath));
    } catch (e) { console.error("run loops", e); }
    finally { setRunning(false); }
  }, [vaultPath, domainPath]);

  if (!doc) return <div className="text-sm text-text-muted">loading loops…</div>;

  const active = doc.loops.filter((l) => l.status !== "done");
  const done = doc.loops.filter((l) => l.status === "done");

  return (
    <div className="w-full space-y-4">
      {/* Header - L1 (Monday feedback): full-width like every other page. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">Loops</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Standing forces on {titleCase(domain)}, not one-off tasks. Each loop watches signals and works to close the gap to your desired state. Open loops run forever; closed loops finish when their condition is met.
          </p>
        </div>
        {doc.loops.length > 0 && (
          <button
            onClick={runNow}
            disabled={running}
            title="Run every due loop now: the engine measures the gap and refreshes each loop's actions. Also runs in the background on each loop's cadence."
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} /> {running ? "Running…" : "Run loops now"}
          </button>
        )}
      </div>

      {/* How loops work - make the agentic model explicit (Monday feedback: the
          founder couldn't tell what a loop does on enable). Collapsed by default. */}
      <CollapsibleSection icon={InfinityIcon} title="How loops work" summary="agentic · goal-driven · guardrailed">
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-text-secondary">
            A loop is a <span className="font-semibold text-text-primary">standing agent</span> for this domain. It learns from its own run history, so it doesn't repeat itself and escalates when a gap stalls.
          </p>
          {/* The cadence → gap → act mini-flow, as three steps, not prose. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { n: "1", h: "Reads", b: "the domain's state + your Ideal State, on each cadence or Run now." },
              { n: "2", h: "Measures", b: "the gap between where you are and where you want to be." },
              { n: "3", h: "Acts", b: "decides the next concrete steps to close it, within its guardrail." },
            ].map((s) => (
              <div key={s.n} className="rounded-lg border border-border-subtle bg-background px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft font-mono text-[10px] font-bold text-accent">{s.n}</span>
                  <span className="text-sm font-semibold text-text-primary">{s.h}</span>
                </div>
                <div className="mt-1 text-xs leading-relaxed text-text-muted">{s.b}</div>
              </div>
            ))}
          </div>
          {/* Guardrail tiers as a clean two-column list with accent keys. */}
          <div>
            <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Each loop's guardrail · what it may DO</div>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-2">
              {(["suggest", "tasks", "ask", "auto"] as LoopAutonomy[]).map((a) => (
                <div key={a} className="bg-surface px-3 py-2">
                  <div className="font-mono text-[11px] font-semibold text-accent">{AUTONOMY_LABEL[a]}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-text-muted">{AUTONOMY_BLURB[a]}</div>
                </div>
              ))}
            </div>
          </div>
          <p className="rounded-lg border border-accent-border/40 bg-accent-soft/20 px-3 py-2 text-xs leading-relaxed text-text-secondary">
            <ShieldQuestion className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-accent" />
            Anything consequential (spend, contacting someone, irreversible) always queues under <span className="font-semibold text-text-primary">Needs your approval</span> first, regardless of guardrail. Every run is recorded in each loop's <span className="font-semibold text-text-primary">Run history</span>.
          </p>
        </div>
      </CollapsibleSection>

      {/* Needs your approval - steps a loop wants to take but that need your OK
          first (spend money, contact someone, irreversible, or a decision only
          you can make). This is the loop "asking for permission". */}
      {pending.length > 0 && (
        <section className="rounded-xl border border-accent-border bg-accent-soft/30 p-4">
          <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
            <ShieldQuestion className="h-3.5 w-3.5" /> Needs your approval · {pending.length}
          </div>
          <ul className="space-y-1.5">
            {pending.map((p, i) => (
              <li key={`${p.loopId}-${i}`} className="flex items-start gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary">{p.text}</div>
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">{p.loopName}</div>
                </div>
                {(() => {
                  const thisRunning = execBusy === p.text;
                  const otherRunning = execBusy !== null && !thisRunning;
                  return (
                    <button onClick={() => executePending(p.loopId, p.text)} disabled={execBusy !== null}
                      title={otherRunning ? "Another action is running - only one at a time" : "Execute now via your connectors (email, calendar, etc.) - the agent actually does it"}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                        otherRunning
                          ? "cursor-not-allowed border-border-subtle bg-surface-warm text-text-muted/60"
                          : "border-accent-border bg-accent text-background hover:opacity-90"
                      }`}>
                      {thisRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} {thisRunning ? "running…" : "execute"}
                    </button>
                  );
                })()}
                <button onClick={() => resolvePending(p.loopId, p.text, true)} disabled={execBusy !== null} title="Approve: file it as a task to do later"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
                  <Check className="h-3 w-3" /> task
                </button>
                <button onClick={() => resolvePending(p.loopId, p.text, false)} disabled={execBusy !== null} title="Dismiss this proposal"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-warn hover:text-warn disabled:opacity-50">
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-text-muted"><span className="text-accent">Execute</span> does it now via your connectors; <span className="text-text-secondary">task</span> files it for later; dismiss drops it. Loops keep running other steps automatically.</p>
          {execReport && (
            <div className="mt-2 rounded-lg border border-border-subtle bg-background px-3 py-2">
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Executed: {execReport.action}</div>
              <div className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">{execReport.report}</div>
            </div>
          )}
        </section>
      )}

      {/* S4: the Ideal State EDITOR was removed from Loops - it's context, not a
          loop concern, and editing it lives in the Context panel / Ideals. Loops
          still MEASURE the gap to it; the ideal is auto-mirrored into the loops doc
          on load (read-only here), so the engine keeps reading desiredState. This
          is just a quiet pointer to where it's edited. */}
      <section className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-2.5">
        <Target className="h-4 w-4 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1 text-xs text-text-secondary">
          Loops measure the gap to your <span className="font-semibold text-text-primary">{titleCase(domain)} ideal state</span>.
          {" "}Edit it in the domain's Context panel{ideal.trim() ? "." : " - none set yet, so loops have no target to aim at."}
        </div>
      </section>

      {/* Empty state → seed */}
      {doc.loops.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
          <p className="text-sm text-text-secondary">No loops yet for {titleCase(domain)}.</p>
          <button
            onClick={() => persist(seedLoopsFor(domain))}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
          >
            <Plus className="h-3.5 w-3.5" /> Generate starter loops
          </button>
          <p className="mt-2 text-[11px] text-text-muted">
            {hasSeed(domain) ? `Seeds a tailored steward for ${titleCase(domain)}.` : "Seeds a general steward you can shape."}
          </p>
        </div>
      )}

      {/* Active loops */}
      {active.length > 0 && (
        <section className="space-y-2">
          {active.map((l) => (
            <LoopCard
              key={l.id}
              loop={l}
              rt={runtime.loops[l.id]}
              open={openIds.has(l.id)}
              onToggleOpen={() => toggleOpen(l.id)}
              onChange={(patch) => mutateLoop(l.id, patch)}
              onRemove={() => removeLoop(l.id)}
              vaultPath={vaultPath}
              domain={domain}
            />
          ))}
        </section>
      )}

      {/* Add loop */}
      {doc.loops.length > 0 && (
        adding ? (
          <div className="rounded-xl border border-border-subtle bg-surface-warm/40 p-3">
            <input
              autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addLoop(); if (e.key === "Escape") { setAdding(false); setNewName(""); } }}
              placeholder="Loop name (e.g. Opportunity Detection)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-border"
            />
            {/* L2 (Monday feedback): capture the GOAL + GUARDRAIL on create, not
                just a name. The engine reads purpose to drive what the loop does. */}
            <textarea
              value={newPurpose} onChange={(e) => setNewPurpose(e.target.value)}
              placeholder="Goal: what should this loop work toward? (e.g. surface networking opportunities that match my career direction and prep the outreach)"
              rows={2}
              className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-border"
            />
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="block">
                <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">Kind</div>
                <select value={newType} onChange={(e) => setNewType(e.target.value as LoopType)} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs">
                  <option value="open">Open (never ends)</option>
                  <option value="closed">Closed (has a finish line)</option>
                </select>
              </label>
              <label className="block">
                <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">Checks</div>
                <select value={newCadence} onChange={(e) => setNewCadence(e.target.value as LoopCadence)} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs">
                  {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
                </select>
              </label>
              <label className="block">
                <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">Guardrail</div>
                <select value={newAutonomy} onChange={(e) => setNewAutonomy(e.target.value as LoopAutonomy)} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs" title={AUTONOMY_BLURB[newAutonomy]}>
                  {(["suggest", "tasks", "ask", "auto"] as LoopAutonomy[]).map((a) => <option key={a} value={a}>{AUTONOMY_LABEL[a]}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-1 text-[11px] text-text-muted">{AUTONOMY_BLURB[newAutonomy]}</div>
            <div className="mt-2 flex items-center gap-2">
              <button onClick={addLoop} disabled={!newName.trim()} className="rounded-md border border-accent-border bg-accent px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-background hover:opacity-90 disabled:opacity-40">Add loop</button>
              <button onClick={() => { setAdding(false); setNewName(""); setNewPurpose(""); }} className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-primary">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
            <Plus className="h-3.5 w-3.5" /> add loop
          </button>
        )
      )}

      {/* Completed (closed) loops, collapsed at the bottom */}
      {done.length > 0 && (
        <section className="space-y-2 pt-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Completed · {done.length}</div>
          {done.map((l) => (
            <LoopCard key={l.id} loop={l} rt={runtime.loops[l.id]} open={openIds.has(l.id)} onToggleOpen={() => toggleOpen(l.id)} onChange={(patch) => mutateLoop(l.id, patch)} onRemove={() => removeLoop(l.id)} vaultPath={vaultPath} domain={domain} />
          ))}
        </section>
      )}

      {savedAt > 0 && <div className="text-right font-mono text-[10px] text-text-muted/60">saved</div>}
    </div>
  );
}

function LoopCard({ loop, rt, open, onToggleOpen, onChange, onRemove, vaultPath, domain }: {
  loop: Loop;
  rt?: LoopRtEntry;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (patch: Partial<Loop>) => void;
  onRemove: () => void;
  vaultPath: string;
  domain: string;
}) {
  const done = loop.status === "done";
  const autonomy = loop.autonomy ?? "ask";
  const history = (rt?.history ?? []).slice().reverse();

  // Per-loop "Run now": run this one loop immediately, apply per its autonomy, and
  // show exactly what it did (actions + dispositions, tasks created, approvals).
  type RunResult = { ok: boolean; note: string; done: boolean; actions: { text: string; disposition: "task" | "approval" | "suggested" }[]; tasksCreated: string[]; pending: string[]; error?: string };
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const runNow = async () => {
    setRunning(true); setResult(null);
    // Register a global process so the run is visible on the sidebar AND survives
    // navigating away (the engine run continues regardless; this keeps the UI in
    // sync). endProcess fires in finally even if this card unmounts mid-run.
    const procId = `loop-${loop.id}-${Date.now()}`;
    startProcess(procId, "loop", `${titleCase(domain || "general")} · ${loop.name}`, domain);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = getPref(PREF.distillModel, "claude-haiku-4-5");
      const r = await invoke<RunResult>("loop_run_now", { vault: vaultPath, domain, loopId: loop.id, provider, model });
      setResult(r);
      window.dispatchEvent(new Event("prevail:loops-advanced"));
      window.dispatchEvent(new Event("prevail:tasks-changed"));
    } catch (e) { setResult({ ok: false, note: "", done: false, actions: [], tasksCreated: [], pending: [], error: String(e) }); }
    finally { setRunning(false); endProcess(procId); }
  };

  // Next scheduled run = last run + cadence interval (continuous ≈ hourly).
  const CADENCE_MS: Record<LoopCadence, number> = { continuous: 3600e3, daily: 864e5, weekly: 6048e5, monthly: 2592e6 };
  const nextRun = loop.enabled && loop.status === "active" && loop.lastRunTs
    ? new Date(loop.lastRunTs + (CADENCE_MS[loop.cadence] ?? 6048e5))
    : null;
  const dot = done ? "#9aa0a6" : loop.status === "paused" ? "#d9a441" : "#0d7a6e";
  return (
    <div className={`overflow-hidden rounded-xl border bg-surface ${done ? "border-border-subtle opacity-70" : "border-border"}`}>
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={onToggleOpen} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
          <span className={`truncate text-sm font-semibold ${done ? "text-text-muted line-through" : "text-text-primary"}`}>{loop.name}</span>
          {loop.type === "open"
            ? <span className="inline-flex items-center gap-1 rounded-full bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted" title="Open loop: never ends"><InfinityIcon className="h-2.5 w-2.5" /> open</span>
            : <span className="rounded-full bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted" title="Closed loop: finishes when its condition is met">closed</span>}
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-muted/70">{CADENCE_LABEL[loop.cadence]}</span>
          <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent" title={AUTONOMY_BLURB[autonomy]}>{AUTONOMY_LABEL[autonomy]}</span>
        </button>
        {!done && (
          <Toggle on={loop.enabled} onChange={(v) => onChange({ enabled: v })} label={`${loop.name} enabled`} />
        )}
      </div>
      {open && (
        <div className="space-y-4 border-t border-border-subtle px-4 py-4 text-[13px]">
          {loop.purpose && <p className="leading-relaxed text-text-secondary">{loop.purpose}</p>}

          {/* Signals + condition - compact "what it watches" metadata row. */}
          {(loop.signals.length > 0 || loop.condition) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {loop.signals.length > 0 && (
                <Field label="Watches">
                  <div className="flex flex-wrap gap-1.5">
                    {loop.signals.map((s, i) => <span key={i} className="rounded-md border border-border-subtle bg-background px-2 py-0.5 font-mono text-[10px] text-text-secondary">{s}</span>)}
                  </div>
                </Field>
              )}
              {loop.condition && (
                <Field label="Closes when">
                  <span className="inline-block rounded-md bg-surface-warm px-2 py-0.5 font-mono text-[11px] text-text-secondary">{loop.condition}</span>
                </Field>
              )}
            </div>
          )}

          {/* The target - highlighted, since the whole loop exists to reach it. */}
          {loop.evaluation && (
            <div className="rounded-lg border-l-2 border-accent bg-accent-soft/20 py-2 pl-3 pr-3">
              <div className="mb-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-accent"><Target className="h-3 w-3" /> What good looks like</div>
              <div className="leading-relaxed text-text-secondary">{loop.evaluation}</div>
            </div>
          )}

          {/* Current actions - each a distinct card, not a bullet wall. */}
          {loop.actions.length > 0 && (
            <Field label={`Current actions · ${loop.actions.length}`}>
              <ul className="space-y-1.5">
                {loop.actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2 leading-relaxed text-text-secondary">
                    <span className="mt-0.5 shrink-0 font-mono text-[11px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </Field>
          )}

          {/* L3: run history - a left-railed timeline of what the loop did. */}
          {history.length > 0 && (
            <Field label="Run history">
              <ul className="space-y-0 border-l border-border-subtle pl-4">
                {history.slice(0, 8).map((r, i) => (
                  <li key={i} className="relative pb-3 last:pb-0">
                    <span className={`absolute -left-[21px] top-1 h-2 w-2 rounded-full ring-2 ring-surface ${r.done ? "bg-ok" : "bg-accent"}`} />
                    <div className="flex items-center gap-2 font-mono text-[10px] text-text-muted">
                      <span className={r.done ? "text-ok" : "text-accent"}>{r.done ? "closed" : "ran"}</span>
                      <span>{new Date(r.ts).toLocaleString()}</span>
                      {r.tasksCreated?.length > 0 && <span className="rounded-full bg-surface-warm px-1.5 text-text-secondary">{r.tasksCreated.length} task{r.tasksCreated.length === 1 ? "" : "s"}</span>}
                    </div>
                    {r.note && <div className="mt-0.5 text-[12px] leading-relaxed text-text-secondary">{r.note}</div>}
                  </li>
                ))}
              </ul>
            </Field>
          )}
          {/* Run-now result: exactly what this pass did. */}
          {result && (
            <div className={`rounded-lg border px-3 py-2.5 ${result.ok ? "border-accent-border bg-accent-soft/30" : "border-danger/40 bg-danger/10"}`}>
              {result.ok ? (
                <>
                  <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-accent"><Play className="h-3 w-3" /> Ran just now</div>
                  {result.note && <div className="mb-2 text-[12px] leading-relaxed text-text-secondary">{result.note}</div>}
                  {result.actions.length > 0 ? (
                    <ul className="space-y-1">
                      {result.actions.map((a, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12px] text-text-secondary">
                          <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider ${a.disposition === "task" ? "bg-accent-soft text-accent" : a.disposition === "approval" ? "bg-warn/15 text-warn" : "bg-surface-warm text-text-muted"}`}>
                            {a.disposition === "task" ? <><ListPlus className="h-2.5 w-2.5" /> task</> : a.disposition === "approval" ? <><ShieldQuestion className="h-2.5 w-2.5" /> approval</> : "idea"}
                          </span>
                          <span>{a.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <div className="text-[12px] text-text-muted">No new actions this pass — the gap looks handled.</div>}
                  <div className="mt-2 font-mono text-[10px] text-text-muted">{result.tasksCreated.length} task{result.tasksCreated.length === 1 ? "" : "s"} filed · {result.pending.length} awaiting approval</div>
                </>
              ) : <div className="text-[12px] text-danger">Run failed: {result.error}</div>}
            </div>
          )}
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2.5">
            <button onClick={runNow} disabled={running} title="Run this loop now: measure the gap, then apply per its autonomy" className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {running ? "Running…" : "Run now"}
            </button>
            {nextRun && <span className="font-mono text-[10px] text-text-muted" title="Next scheduled run">next ~{nextRun.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
            <span className="mx-0.5 text-text-muted/40">·</span>
            <select value={loop.cadence} onChange={(e) => onChange({ cadence: e.target.value as LoopCadence })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" title="How often the runner evaluates this loop">
              {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
            </select>
            <select value={autonomy} onChange={(e) => onChange({ autonomy: e.target.value as LoopAutonomy })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" title={AUTONOMY_BLURB[autonomy]}>
              {(["suggest", "tasks", "ask", "auto"] as LoopAutonomy[]).map((a) => <option key={a} value={a}>{AUTONOMY_LABEL[a]}</option>)}
            </select>
            <select value={loop.status} onChange={(e) => onChange({ status: e.target.value as Loop["status"] })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" title="Loop status">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="done">Done</option>
            </select>
            <button onClick={onRemove} title="Delete this loop" className="ml-auto flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-warn">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      {children}
    </div>
  );
}
