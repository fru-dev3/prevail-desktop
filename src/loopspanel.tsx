// Loops surface for a domain: the desired state up top, then the standing loops
// that work to close the gap to it. Loops are collapsed by default (the page
// reads as a list of forces); expand one to see its signals, condition, cadence,
// and current actions. The runner daemon (separate) evaluates enabled loops and
// keeps their actions current; here you define and steer them.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Infinity as InfinityIcon, Loader2, ListPlus, Mail, Play, Plus, RefreshCw, ShieldQuestion, Target, Trash2, X, Zap } from "lucide-react";
import { invoke, listen } from "./bridge";
import type { UnlistenFn } from "./bridge";
import { titleCase, relTime } from "./format";
import { PREF, getPref } from "./storage";
import { startProcess, endProcess, updateProcess } from "./processes";
import { Toggle } from "./ui";
import { MODELS, VENDOR_BRAND, isHarnessRuntime } from "./constants";
import { useDetectedClis } from "./hooks";
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
  ensureBriefingLoop,
  ensureModelScoutLoop,
  hasSeed,
  makeLoop,
  readLoops,
  readLoopsRuntime,
  seedLoopsFor,
  writeLoops,
  writeLoopsRuntime,
} from "./loops";

const CADENCES: LoopCadence[] = ["continuous", "daily", "weekly", "monthly"];

// The api a LoopCard exposes to the panel so "Run loops now" can drive each loop
// in turn and stop it. `run` resolves when the loop's run finishes (or is
// stopped); `stop` SIGTERMs the in-flight engine child for this loop.
export type LoopRunnerApi = { run: (silent?: boolean) => Promise<void>; stop: () => void };

// Best-effort native OS notification (loops started / finished). Never throws.
async function notify(title: string, body: string) {
  try { await invoke("notify_user", { title, body }); } catch { /* notifications are best effort */ }
}

// The real stages a single loop run moves through, in order. The engine streams
// one phase event per stage so the card can show a live stepper (which step it's
// on + elapsed) instead of a blank spinner.
const RUN_PHASES: { key: string; label: string }[] = [
  { key: "resolve", label: "Locate" },
  { key: "read", label: "Read state" },
  { key: "think", label: "Measure gap" },
  { key: "apply", label: "Apply" },
];

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
    // Every domain always has a built-in Briefing loop. Provision it on load if
    // missing (and persist once), so it's present in the panel and the runner.
    readLoops(domainPath).then((d) => {
      if (!alive) return;
      const { doc: withBrief, added: addedB } = ensureBriefingLoop(d, domain);
      // General also gets the built-in Model Scout (web-searches models for the Arena).
      const { doc: withScout, added: addedS } = ensureModelScoutLoop(withBrief, domain);
      setDoc(withScout);
      if (addedB || addedS) writeLoops(domainPath, withScout).catch((e) => console.error("seed built-in loops", e));
    });
    readLoopsRuntime(domainPath).then((rt) => { if (alive) setRuntime(rt); });
    // The background loop runner advances loops + queues approvals; refresh when
    // it reports a pass so new actions/proposals appear without a manual reload.
    const onAdvanced = () => {
      readLoops(domainPath).then((d) => { if (alive) setDoc(ensureModelScoutLoop(ensureBriefingLoop(d, domain).doc, domain).doc); });
      readLoopsRuntime(domainPath).then((rt) => { if (alive) setRuntime(rt); });
    };
    window.addEventListener("prevail:loops-advanced", onAdvanced);
    return () => { alive = false; window.removeEventListener("prevail:loops-advanced", onAdvanced); };
  }, [domainPath, domain]);

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
    // Register a global process so executing an approval shows in the sidebar's
    // "processes running" indicator (it actually runs the agent + connectors, so
    // it's a real background process the user should see).
    const procId = `exec-${loopId}-${Date.now()}`;
    const short = text.length > 48 ? `${text.slice(0, 48)}…` : text;
    startProcess(procId, "loop", `${titleCase(domain || "general")} · Executing: ${short}`, domain);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = getPref(PREF.distillModel, "claude-haiku-4-5");
      // Mint a single-use approval token bound to this exact action (C1/O16),
      // then execute with it — the backend verifies approval, not UI trust.
      const approval = await invoke<string>("loop_request_approval", { domain, action: text });
      const report = await invoke<string>("loop_execute_action", { vault: vaultPath, domain, action: text, approval, provider, model });
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
      endProcess(procId);
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

  // "Run loops now" runs every active, enabled loop in turn via the streamed
  // per-loop runner. Each loop visibly runs (header spinner + live progress + a
  // sidebar dot on the domain), is individually stoppable, and the whole batch
  // can be stopped. A notification bookends the run. Each LoopCard registers its
  // run/stop api here so the panel can drive it.
  const [running, setRunning] = useState(false);
  const [runningLoopId, setRunningLoopId] = useState<string | null>(null);
  const runnersRef = useRef<Map<string, LoopRunnerApi>>(new Map());
  const stopAllRef = useRef(false);
  const registerRunner = useCallback((id: string, api: LoopRunnerApi | null) => {
    if (api) runnersRef.current.set(id, api);
    else runnersRef.current.delete(id);
  }, []);

  const runNow = useCallback(async () => {
    const targets = (doc?.loops ?? []).filter((l) => l.status !== "done" && l.enabled);
    if (targets.length === 0) return;
    stopAllRef.current = false;
    setRunning(true);
    notify(`Running ${targets.length} loop${targets.length === 1 ? "" : "s"} · ${titleCase(domain)}`, "Prevail is working through them now.");
    let ran = 0;
    for (const l of targets) {
      if (stopAllRef.current) break;
      setRunningLoopId(l.id);
      const api = runnersRef.current.get(l.id);
      if (api) { try { await api.run(true); } catch { /* one loop failing must not abort the batch */ } }
      ran++;
    }
    const stopped = stopAllRef.current;
    setRunningLoopId(null);
    setRunning(false);
    try {
      setDoc(ensureBriefingLoop(await readLoops(domainPath), domain).doc);
      setRuntime(await readLoopsRuntime(domainPath));
    } catch (e) { console.error("reload loops", e); }
    notify(
      stopped ? `Loops stopped · ${titleCase(domain)}` : `Loops finished · ${titleCase(domain)}`,
      stopped ? `Stopped after ${ran} of ${targets.length}.` : `Ran ${ran} loop${ran === 1 ? "" : "s"}.`,
    );
  }, [doc, domainPath, domain]);

  // Stop the whole run: flag the queue to stop and SIGTERM the loop running now.
  // Runs are sequential, so stopping the current loop is enough.
  const stopAll = useCallback(() => {
    stopAllRef.current = true;
    if (runningLoopId) runnersRef.current.get(runningLoopId)?.stop();
  }, [runningLoopId]);

  if (!doc) return <div className="text-sm text-text-muted">loading loops…</div>;

  const active = doc.loops.filter((l) => l.status !== "done");
  const done = doc.loops.filter((l) => l.status === "done");
  // The built-in Briefing loop is always present, so "no loops yet" means no
  // steward loops beyond it.
  const hasStewardLoops = doc.loops.some((l) => l.kind !== "briefing");

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
          running ? (
            <button
              onClick={stopAll}
              title="Stop the whole run: the loop running now is stopped and no further loops start."
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-danger hover:bg-danger/20"
            >
              <X className="h-3.5 w-3.5" /> Stop run
            </button>
          ) : (
            <button
              onClick={runNow}
              title="Run every active loop now, one at a time: each measures the gap and refreshes its actions. Also runs in the background on each loop's cadence."
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Run loops now
            </button>
          )
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
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">{p.loopName}{p.ts ? ` · queued ${relTime(p.ts)}` : ""}</div>
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

      {/* Empty state → seed (the built-in Briefing loop is always present, so this
          shows when there are no steward loops beyond it). */}
      {!hasStewardLoops && (
        <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
          <p className="text-sm text-text-secondary">No steward loops yet for {titleCase(domain)} - just the built-in briefing.</p>
          <button
            onClick={() => persist(ensureBriefingLoop(seedLoopsFor(domain), domain).doc)}
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
              registerRunner={registerRunner}
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

function LoopCard({ loop, rt, open, onToggleOpen, onChange, onRemove, vaultPath, domain, registerRunner }: {
  loop: Loop;
  rt?: LoopRtEntry;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (patch: Partial<Loop>) => void;
  onRemove: () => void;
  vaultPath: string;
  domain: string;
  // Lets the panel's "Run loops now" drive this card's run + stop it. The card
  // registers its live api under its loop id; the panel runs each in turn.
  registerRunner?: (id: string, api: LoopRunnerApi | null) => void;
}) {
  const done = loop.status === "done";
  const autonomy = loop.autonomy ?? "ask";
  const history = (rt?.history ?? []).slice().reverse();

  // Installed runtimes for the executor picker — only ones actually on the
  // machine (plus the current selection, so a since-uninstalled executor still
  // shows rather than silently reverting to the default).
  const installedRuntimes = useDetectedClis().filter((c) => c.available);
  const installedIds = installedRuntimes.map((c) => c.id);
  const execModels = installedIds.filter((id) => !isHarnessRuntime(id));
  const execHarnesses = installedIds.filter((id) => isHarnessRuntime(id));
  const execMissing = loop.executor && loop.executor.trim() && !installedIds.includes(loop.executor) ? loop.executor : null;

  // Per-loop "Run now": run this one loop immediately, apply per its autonomy, and
  // show exactly what it did (actions + dispositions, tasks created, approvals).
  type RunResult = { ok: boolean; note: string; done: boolean; actions: { text: string; disposition: "task" | "approval" | "suggested" }[]; tasksCreated: string[]; pending: string[]; briefing?: string; error?: string };
  const isBriefing = loop.kind === "briefing";
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  // Live progress so the run isn't a black box: the engine streams a phase per
  // real step (resolve → read → think → apply), which we render as a stepper
  // with an elapsed timer; the current phase also rides the sidebar label.
  const [phase, setPhase] = useState<string>("");
  const [phaseLabel, setPhaseLabel] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    setElapsed(0);
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(iv);
  }, [running]);

  // The live engine session for this card's in-flight run, held in a ref so Stop
  // can target it without re-rendering. Stop SIGTERMs the child (abort_sessions);
  // the engine's loop_run:done then fires and the normal cleanup runs.
  const runSessionRef = useRef<string | null>(null);
  const stopRun = useCallback(() => {
    const s = runSessionRef.current;
    if (s) { invoke("abort_sessions", { prefix: s }).catch(() => { /* already gone */ }); }
  }, []);

  // Run this one loop. Resolves when the run finishes (or is stopped), so the
  // panel's "Run loops now" can await each loop in turn. `silent` suppresses the
  // per-loop notification when the panel is running a batch (it notifies once).
  const runNow = useCallback((opts?: { silent?: boolean }) => new Promise<void>((resolve) => {
    setRunning(true); setResult(null); setPhase("resolve"); setPhaseLabel("Starting");
    // session keys the stream; procId registers a global process so the run shows
    // on the sidebar AND survives navigating away (the engine keeps going).
    const session = `loop-${loop.id}-${Date.now()}`;
    runSessionRef.current = session;
    const baseLabel = `${titleCase(domain || "general")} · ${loop.name}`;
    startProcess(session, "loop", baseLabel, domain);
    let captured: RunResult | null = null;
    let unline: UnlistenFn | undefined;
    let undone: UnlistenFn | undefined;
    let settled = false;
    const cleanup = () => { try { unline?.(); } catch { /* */ } try { undone?.(); } catch { /* */ } };
    const finish = () => { if (settled) return; settled = true; runSessionRef.current = null; resolve(); };
    (async () => {
      try {
        const provider = (loop.executor && loop.executor.trim()) || getPref(PREF.memoryProvider, "claude");
        const model = (loop.model && loop.model.trim()) || getPref(PREF.distillModel, "claude-haiku-4-5");
        unline = await listen<{ session: string; data: unknown }>("loop_run:line", (e) => {
          if (e.payload.session !== session) return;
          const d = e.payload.data as { type?: string; phase?: string; label?: string; result?: RunResult };
          if (d && typeof d === "object" && d.type === "phase") {
            setPhase(d.phase || ""); setPhaseLabel(d.label || "");
            updateProcess(session, d.label ? `${baseLabel}: ${d.label}` : baseLabel);
          } else if (d && typeof d === "object" && d.type === "result" && d.result) {
            captured = d.result;
          }
        });
        undone = await listen<{ session: string; code: number | null }>("loop_run:done", (e) => {
          if (e.payload.session !== session) return;
          const res = captured ?? { ok: false, note: "", done: false, actions: [], tasksCreated: [], pending: [], error: `loop exited (code ${e.payload.code ?? "?"})` };
          setResult(res);
          setRunning(false); setPhase(""); setPhaseLabel("");
          cleanup(); endProcess(session);
          if (!opts?.silent) {
            notify(`${loop.name} · ${titleCase(domain || "general")}`, res.ok ? (res.note || "Loop run finished.") : `Loop run stopped or failed.`);
          }
          window.dispatchEvent(new Event("prevail:loops-advanced"));
          window.dispatchEvent(new Event("prevail:tasks-changed"));
          finish();
        });
        // Returns immediately; the run proceeds via the streamed events above.
        await invoke("loop_run_now_stream", { session, vault: vaultPath, domain, loopId: loop.id, provider, model });
      } catch (e) {
        setResult({ ok: false, note: "", done: false, actions: [], tasksCreated: [], pending: [], error: String(e) });
        setRunning(false); setPhase(""); setPhaseLabel("");
        cleanup(); endProcess(session);
        finish();
      }
    })();
  }), [loop.id, loop.name, loop.model, domain, vaultPath]);

  // Expose this card's run/stop to the panel so "Run loops now" can drive it.
  const apiRef = useRef<LoopRunnerApi>({ run: async () => {}, stop: () => {} });
  apiRef.current = { run: (silent) => runNow({ silent }), stop: stopRun };
  useEffect(() => {
    if (!registerRunner) return;
    registerRunner(loop.id, { run: (silent) => apiRef.current.run(silent), stop: () => apiRef.current.stop() });
    return () => registerRunner(loop.id, null);
  }, [loop.id, registerRunner]);

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
          {running
            ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />
            : <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
          <span className={`truncate text-sm font-semibold ${done ? "text-text-muted line-through" : "text-text-primary"}`}>{loop.name}</span>
          {running && <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-accent">running…</span>}
          {isBriefing ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent" title="Built-in briefing loop: synthesizes + delivers a digest of this domain"><Mail className="h-2.5 w-2.5" /> briefing</span>
          ) : loop.type === "open"
            ? <span className="inline-flex items-center gap-1 rounded-full bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted" title="Open loop: never ends"><InfinityIcon className="h-2.5 w-2.5" /> open</span>
            : <span className="rounded-full bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted" title="Closed loop: finishes when its condition is met">closed</span>}
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-muted/70">{CADENCE_LABEL[loop.cadence]}</span>
          {isBriefing
            ? <span className="shrink-0 rounded-full bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-secondary" title="Delivery channel">{loop.channel ?? "gmail"}</span>
            : <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent" title={AUTONOMY_BLURB[autonomy]}>{AUTONOMY_LABEL[autonomy]}</span>}
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
          {/* Live run progress: which real stage the loop is on + elapsed, so a
              run is observable instead of a black box. */}
          {running && (
            <div className="rounded-lg border border-accent-border bg-accent-soft/20 px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                  <Loader2 className="h-3 w-3 animate-spin" /> Running
                </div>
                <span className="font-mono text-[10px] tabular-nums text-text-muted">{elapsed}s</span>
              </div>
              <div className="flex items-stretch gap-1">
                {RUN_PHASES.map((p, i) => {
                  const ci = RUN_PHASES.findIndex((x) => x.key === phase);
                  const st = ci < 0 ? (i === 0 ? "current" : "todo") : i < ci ? "done" : i === ci ? "current" : "todo";
                  return (
                    <div key={p.key} className="flex flex-1 flex-col items-center gap-1">
                      <div className={`h-1 w-full rounded-full ${st === "done" ? "bg-accent" : st === "current" ? "bg-accent/60 animate-pulse" : "bg-border-subtle"}`} />
                      <span className={`font-mono text-[9px] ${st === "todo" ? "text-text-muted/50" : st === "current" ? "text-accent" : "text-text-muted"}`}>{p.label}</span>
                    </div>
                  );
                })}
              </div>
              {phaseLabel && <div className="mt-2 text-[12px] text-text-secondary">{phaseLabel}…</div>}
            </div>
          )}
          {/* Run-now result: exactly what this pass did. */}
          {!running && result && (
            <div className={`rounded-lg border px-3 py-2.5 ${result.ok ? "border-accent-border bg-accent-soft/30" : "border-danger/40 bg-danger/10"}`}>
              {result.ok ? (
                <>
                  <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-accent">{result.briefing ? <Mail className="h-3 w-3" /> : <Play className="h-3 w-3" />} {result.briefing ? "Briefing ready" : "Ran just now"}</div>
                  {result.note && <div className="mb-2 text-[12px] leading-relaxed text-text-secondary">{result.note}</div>}
                  {result.briefing ? (
                    <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-background px-3 py-2 text-[12px] leading-relaxed text-text-secondary">{result.briefing}</div>
                  ) : result.actions.length > 0 ? (
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
                  ) : <div className="text-[12px] text-text-muted">No new actions this pass. The gap looks handled.</div>}
                  {!result.briefing && <div className="mt-2 font-mono text-[10px] text-text-muted">{result.tasksCreated.length} task{result.tasksCreated.length === 1 ? "" : "s"} filed · {result.pending.length} awaiting approval</div>}
                </>
              ) : <div className="text-[12px] text-danger">Run failed: {result.error}</div>}
            </div>
          )}
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2.5">
            <button onClick={() => runNow()} disabled={running} title="Run this loop now: measure the gap, then apply per its autonomy" className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {running ? "Running…" : "Run now"}
            </button>
            {running && (
              <button onClick={stopRun} title="Stop this loop's run" className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/20">
                <X className="h-3.5 w-3.5" /> Stop
              </button>
            )}
            {nextRun && <span className="font-mono text-[10px] text-text-muted" title="Next scheduled run">next ~{nextRun.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
            <span className="mx-0.5 text-text-muted/40">·</span>
            <select value={loop.cadence} onChange={(e) => onChange({ cadence: e.target.value as LoopCadence })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" title="How often the runner evaluates this loop">
              {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
            </select>
            {isBriefing ? (
              <select value={loop.channel ?? "gmail"} onChange={(e) => onChange({ channel: e.target.value as Loop["channel"] })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" title="Where to deliver this briefing">
                <option value="gmail">Send to Gmail</option>
                <option value="telegram">Send to Telegram</option>
                <option value="log">Journal only</option>
              </select>
            ) : (
              <select value={autonomy} onChange={(e) => onChange({ autonomy: e.target.value as LoopAutonomy })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" title={AUTONOMY_BLURB[autonomy]}>
                {(["suggest", "tasks", "ask", "auto"] as LoopAutonomy[]).map((a) => <option key={a} value={a}>{AUTONOMY_LABEL[a]}</option>)}
              </select>
            )}
            <select value={loop.status} onChange={(e) => onChange({ status: e.target.value as Loop["status"] })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" title="Loop status">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="done">Done</option>
            </select>
            <select value={loop.executor ?? ""} onChange={(e) => onChange({ executor: e.target.value })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" title="Which runtime runs this loop (default = the global loops provider in Settings). Harnesses run the loop as an agent.">
              <option value="">Agent: default</option>
              {execModels.length > 0 && (
                <optgroup label="Models">
                  {execModels.map((id) => <option key={id} value={id}>{VENDOR_BRAND[id]?.name ?? id}</option>)}
                </optgroup>
              )}
              {execHarnesses.length > 0 && (
                <optgroup label="Harnesses (agent)">
                  {execHarnesses.map((id) => <option key={id} value={id}>{VENDOR_BRAND[id]?.name ?? id}</option>)}
                </optgroup>
              )}
              {execMissing && <option value={execMissing}>{VENDOR_BRAND[execMissing]?.name ?? execMissing} (not installed)</option>}
            </select>
            <select value={loop.model ?? ""} onChange={(e) => onChange({ model: e.target.value })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" title="Model this loop runs on (default = the global loops model in Settings)">
              <option value="">Model: default</option>
              {(MODELS.claude ?? []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            {/* The built-in briefing loop can't be deleted (it would just re-provision); steward loops can. */}
            {!isBriefing && (
              <button onClick={onRemove} title="Delete this loop" className="ml-auto flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-warn">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
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
