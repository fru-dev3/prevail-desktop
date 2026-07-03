// Subsystem extracted from App.tsx (encapsulated module state).
import { useEffect, useState } from "react";
import { invoke, listen } from "./bridge";
import { MODELS, MODEL_SEP } from "./constants";
import { titleCase } from "./format";
import { modelLabel } from "./helpers2";
import { isLocalCli } from "./helpers";
import { isBunkerOn, lsGet, lsSet } from "./storage";
import { track } from "./telemetry";
import type { BenchBatch, BenchJob, BenchJobStatus, BenchQuestion, BenchmarkRun } from "./types";
import type { UnlistenFn } from "./bridge";
import { listSchedules, updateSchedule } from "./bench-presets";
import type { BenchSchedule } from "./bench-presets";

export const BENCH_CLI_OPTIONS = [
  { id: "claude",      label: "Claude" },
  { id: "codex",       label: "Codex" },
  { id: "antigravity", label: "Antigravity" },
  { id: "openrouter",  label: "OpenRouter" },
  { id: "ollama",      label: "Ollama" },
] as const;

// ─────────────────────────────────────────────────────────────────────
// BENCHMARK PAGE - run (multi-model, per-domain or global), results
// (by-model leaderboard + model×domain effectiveness matrix), and a
// questions manager. Replaces the old leaderboard+popup. No modals.




// ── Global benchmark-run registry ───────────────────────────────────────────
// A benchmark is a set of engine processes that outlive any one view. This
// module-scope store is the single source of truth for every live run, so
// domain switches, settings navigation, or panel remounts never lose one.
// Panels and the sidebar subscribe via useBenchBatches(); cancelBenchBatch
// signals the engine processes through abort_sessions.

export const benchBatches = new Map<string, BenchBatch>();

export const benchSubs = new Set<() => void>();

export function benchNotify() {
  for (const f of benchSubs) f();
}

export function useBenchBatches(): BenchBatch[] {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    benchSubs.add(f);
    return () => {
      benchSubs.delete(f);
    };
  }, []);
  return Array.from(benchBatches.values());
}

export function benchPatchJob(b: BenchBatch, key: string, patch: Partial<BenchJob>) {
  b.jobs = b.jobs.map((j) => (j.key === key ? { ...j, ...patch } : j));
  benchNotify();
}

export async function cancelBenchBatch(id: string) {
  const b = benchBatches.get(id);
  if (!b || !b.running) return;
  b.cancelled = true;
  b.jobs = b.jobs.map((j) =>
    j.status === "done" || j.status === "error" ? j : { ...j, status: "cancelled" as BenchJobStatus },
  );
  benchNotify();
  // SIGTERM every engine process of this batch; their benchmark:done events
  // unwind the awaits inside executeBenchBatch.
  await Promise.all(b.sessions.map((s) => invoke("abort_sessions", { prefix: s }).catch(() => {})));
}
// Wait for one benchmark:done (matched by session+phase), folding raw chunks
// into the batch's engine log along the way.

// Resolved code when a phase exceeds its watchdog without a `benchmark:done`
// event. Distinct from a real exit code so callers can mark the job timed-out
// instead of silently treating it as success. Without this, a dropped done
// event (engine crash, killed process, lost IPC) hangs the whole batch forever.
export const BENCH_TIMEOUT = -1000;

export function benchWaitDone(b: BenchBatch, session: string, phase: string, timeoutMs?: number) {
  return new Promise<number | null>((resolve) => {
    let unlisten: UnlistenFn | null = null;
    let chunkUn: UnlistenFn | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelPoll: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => { unlisten?.(); chunkUn?.(); if (timer) clearTimeout(timer); if (cancelPoll) clearInterval(cancelPoll); };
    listen<{ session: string; code: number | null; phase: string }>("benchmark:done", (e) => {
      if (e.payload.session === session && e.payload.phase === phase) {
        cleanup();
        resolve(e.payload.code);
      }
    }).then((u) => {
      unlisten = u;
      // If the batch was already cancelled/torn down before the listener
      // attached, don't leak it.
      if (b.cancelled) { cleanup(); resolve(BENCH_TIMEOUT); }
    });
    // Cancel must unstick an in-flight wait immediately: if the engine never
    // emits `done` (a hung model call), the only way out otherwise is the long
    // watchdog. Poll the batch's cancelled flag so Cancel finalizes right away.
    cancelPoll = setInterval(() => { if (b.cancelled) { cleanup(); resolve(BENCH_TIMEOUT); } }, 400);
    listen<{ session: string; data: string }>("benchmark:chunk", (e) => {
      if (e.payload.session === session) {
        b.log = (b.log + e.payload.data).slice(-8000);
        benchNotify();
      }
    }).then((u) => {
      chunkUn = u;
    });
    // Watchdog: never wait forever on a phase that may never emit `done`.
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => { cleanup(); resolve(BENCH_TIMEOUT); }, timeoutMs);
    }
  });
}

// ── AI question-suggestion registry ─────────────────────────────────────────
// "Suggest with AI" (question drafting) is a long-running engine call that must
// outlive the Questions panel. Mirroring benchBatches, this module-scope store
// is the single source of truth for every in-flight (and finished) suggest job,
// so navigating away from Arena and back never drops one. Panels subscribe via
// useQuestionSuggest(); startQuestionSuggest() runs the engine call from module
// scope with module-scope event listeners, so nothing is tied to a component.

export type QSuggestJob = {
  id: string;
  vault: string;
  domain: string;
  status: "running" | "done" | "error";
  added?: number;
  error?: string;
  tail?: string;
  startedTs: number;
};

// Keyed by vault + "|" + domain: "all domains" runs one job per domain, and
// re-starting a domain replaces its prior (finished) job in place.
const qSuggestJobs = new Map<string, QSuggestJob>();

function qSuggestKey(vault: string, domain: string) {
  return `${vault}|${domain.toLowerCase()}`;
}

function qSuggestNotify() {
  window.dispatchEvent(new Event("prevail:qsuggest-changed"));
}

// Subscribe hook: re-renders on prevail:qsuggest-changed and returns the current
// jobs. Mirrors useBenchBatches (which re-renders through benchSubs); here the
// window event is the notification channel so any mounted panel stays in sync.
export function useQuestionSuggest(): QSuggestJob[] {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    window.addEventListener("prevail:qsuggest-changed", f);
    return () => window.removeEventListener("prevail:qsuggest-changed", f);
  }, []);
  return Array.from(qSuggestJobs.values());
}

// MODULE-SCOPE runner: draft `count` questions for ONE domain via the engine's
// `benchmark_suggest`. Everything (invoke + streaming listeners + recount) lives
// here, not in a component, so an unmount of the Questions panel cannot drop it.
// Guards against double-starting the same vault+domain while one is running.
export async function startQuestionSuggest({
  vault, domain, count, cli, model,
}: {
  vault: string;
  domain: string;
  count: number;
  cli: string;
  model?: string | null;
}): Promise<void> {
  const target = domain.toLowerCase();
  const key = qSuggestKey(vault, target);
  const existing = qSuggestJobs.get(key);
  if (existing && existing.status === "running") return; // already in flight

  // Count from disk, not stale React state, so the "added" delta is honest.
  let before = 0;
  try {
    const pre = await invoke<BenchQuestion[]>("benchmark_questions", { vault });
    before = (pre ?? []).filter((q) => q.domain === target).length;
  } catch { /* fall back to before = 0; exit code still drives success */ }

  const session = `bench-suggest-${target}-${Date.now()}`;
  const job: QSuggestJob = { id: session, vault, domain: target, status: "running", startedTs: Date.now() };
  qSuggestJobs.set(key, job);
  qSuggestNotify();

  // Module-scope streaming + completion listeners (not component-scoped).
  let output = "";
  let chunkUn: UnlistenFn | null = null;
  listen<{ session: string; data: string }>("benchmark:chunk", (e) => {
    if (e.payload.session === session) {
      output = (output + e.payload.data).slice(-2000);
      job.tail = output.trim().split("\n").filter(Boolean).slice(-2).join(" / ");
      qSuggestNotify();
    }
  }).then((u) => { chunkUn = u; });

  const done = new Promise<number | null>((resolve) => {
    let un: UnlistenFn | null = null;
    listen<{ session: string; code: number | null; phase: string }>("benchmark:done", (e) => {
      if (e.payload.session === session && e.payload.phase === "suggest") { un?.(); resolve(e.payload.code); }
    }).then((u) => { un = u; });
  });

  try {
    await invoke("benchmark_suggest", {
      args: { session_id: session, vault, domain: target, count, cli, model: model || null },
    });
    const code = await done;
    (chunkUn as UnlistenFn | null)?.();
    // Let the engine flush new questions to disk before recounting.
    await new Promise((r) => setTimeout(r, 150));
    let added = 0;
    try {
      const fresh = await invoke<BenchQuestion[]>("benchmark_questions", { vault });
      added = (fresh ?? []).filter((q) => q.domain === target).length - before;
    } catch { /* counting is best-effort; exit code still drives success */ }
    if (code === 0 || code === null) {
      job.status = "done";
      job.added = added > 0 ? added : 0;
    } else {
      // Surface WHY it failed: the engine prints a reason on the last line;
      // fall back to a plain-English guess when it's empty.
      const reason = (output.trim().split("\n").filter(Boolean).pop() || "").trim()
        || "the drafting model returned nothing usable (check the model is installed and signed in)";
      job.status = "error";
      job.error = reason;
    }
  } catch (e) {
    (chunkUn as UnlistenFn | null)?.();
    job.status = "error";
    job.error = String(e);
  }
  qSuggestNotify();
  // Tell any mounted questions panel to reload its list, whether or not the user
  // is currently looking at it, so completed drafts appear on return.
  window.dispatchEvent(new Event("prevail:questions-changed"));
}

// ── Scheduled benchmark runs ────────────────────────────────────────────────
// Re-runs the most recent batch (same models, same scope) on a cadence so
// model drift shows up in History without manual runs. Checked every 30
// minutes while the app is open; a due run fires through the same global
// registry as a manual one (sidebar shows it, cancel works).

export const BENCH_SCHED = {
  enabled: "prevail.bench.schedule.enabled",
  freq: "prevail.bench.schedule.freq", // daily | weekly | monthly
  lastRun: "prevail.bench.schedule.lastRun", // epoch ms
  // BENCH-2: the scheduled run's scope is DECOUPLED from the ad-hoc manual Run
  // selection. Mode "latest" repeats the most recent batch (legacy default);
  // "all" runs every model x all domains; "custom" runs an explicit model+domain
  // set the user picks once for the schedule.
  scopeMode: "prevail.bench.schedule.scopeMode",     // "latest" | "all" | "custom"
  scopeModels: "prevail.bench.schedule.scopeModels", // csv of cli::model (custom)
  scopeDomains: "prevail.bench.schedule.scopeDomains", // csv domains, "" = all (custom)
};

// Every benchmarkable model key (cli::model) across the known providers - the
// universe "all models" draws from. Availability + Bunker filtering happens at
// build time (some of these CLIs may not be installed).
export function allBenchModelKeys(): string[] {
  const out: string[] = [];
  for (const c of BENCH_CLI_OPTIONS) for (const m of MODELS[c.id] ?? []) out.push(`${c.id}${MODEL_SEP}${m.id}`);
  return out;
}

export const BENCH_FREQ_MS: Record<string, number> = {
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000,
};

// Resolve a schedule value to milliseconds, supporting an arbitrary "every N
// days" cadence ("custom:N") on top of the named presets. One place so the card
// UI and the background scheduler agree.
export function benchFreqMs(freq: string): number {
  const m = /^custom:(\d+)$/.exec(freq);
  if (m) return Math.max(1, parseInt(m[1], 10)) * 86_400_000;
  return BENCH_FREQ_MS[freq] ?? BENCH_FREQ_MS.weekly;
}

// Human label for a schedule value (presets + "every N days").
export function benchFreqLabel(freq: string): string {
  const m = /^custom:(\d+)$/.exec(freq);
  if (m) { const n = parseInt(m[1], 10); return `every ${n} day${n === 1 ? "" : "s"}`; }
  return freq;
}

export async function rerunLatestBatch(vault: string): Promise<boolean> {
  const runs = await invoke<BenchmarkRun[]>("benchmark_runs", { vault }).catch(() => [] as BenchmarkRun[]);
  if (runs.length === 0) return false;
  const newest = runs[0];
  // The batch = everything sharing the newest run's batch id, or (pre-batch
  // runs) whatever was created within five minutes of it.
  const group = newest.batch_id
    ? runs.filter((r) => r.batch_id === newest.batch_id)
    : runs.filter((r) => Math.abs(r.created_ms - newest.created_ms) < 5 * 60_000);
  const questions = await invoke<BenchQuestion[]>("benchmark_questions", { vault }).catch(() => [] as BenchQuestion[]);
  const jobs: BenchJob[] = [];
  let council = false;
  const seen = new Set<string>();
  for (const r of group) {
    if (r.council) { council = true; continue; }
    if (!r.cli) continue; // pre-meta run: can't rebuild it reliably
    if (isBunkerOn() && !isLocalCli(r.cli)) continue;
    const k = `${r.cli}::${r.model ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const domSet = new Set(r.domains.map((d) => d.toLowerCase()));
    const qids = questions
      .filter((q) => domSet.size === 0 || domSet.has(q.domain.toLowerCase()))
      .map((q) => q.id)
      .sort();
    const ml = modelLabel(r.cli, r.model ?? "") || "default";
    jobs.push({
      key: `sched-${k}-${Date.now()}`,
      cli: r.cli,
      model: r.model ?? "",
      label: `${titleCase(r.cli)} · ${ml}`,
      status: "queued",
      done: 0,
      total: qids.length || r.questions,
      qids,
      qdone: {},
    });
  }
  if (council && jobs.length === 0) {
    if (isBunkerOn()) return false;
    const qids = questions.map((q) => q.id).sort();
    jobs.push({ key: `sched-council-${Date.now()}`, cli: "", model: "", label: "Council", status: "queued", done: 0, total: qids.length, qids, qdone: {} });
  }
  if (jobs.length === 0) return false;
  void executeBenchBatch(vault, jobs, council && jobs.length === 1 && !jobs[0].cli, newest.domains.join(","));
  return true;
}

function modelKeyLabel(k: string): string {
  const [cli, model] = k.split(MODEL_SEP);
  const ml = modelLabel(cli, model) || "default";
  return `${titleCase(cli)} ${ml}`;
}
function domainScopeLabel(domains: string[]): string {
  return domains.length === 0 ? "All domains" : domains.length <= 2 ? domains.map(titleCase).join(", ") : `${domains.length} domains`;
}

// BENCH-2: a scope-aware preview of EXACTLY what the scheduled run will execute.
// "latest" repeats the most recent batch (derived from benchmark_runs, so we can
// also flag the single-model trap); "all"/"custom" reflect the decoupled scope.
export async function scheduledRunPreview(vault: string): Promise<{ models: string[]; scopeLabel: string; council: boolean; empty: boolean; mode: string }> {
  const mode = lsGet(BENCH_SCHED.scopeMode, "latest");
  if (mode === "all") {
    return { models: [`all models (${allBenchModelKeys().length})`], scopeLabel: "All domains", council: false, empty: false, mode };
  }
  if (mode === "custom") {
    const keys = lsGet(BENCH_SCHED.scopeModels, "").split(",").map((s) => s.trim()).filter(Boolean);
    const doms = lsGet(BENCH_SCHED.scopeDomains, "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return { models: keys.map(modelKeyLabel), scopeLabel: domainScopeLabel(doms), council: false, empty: keys.length === 0, mode };
  }
  const runs = await invoke<BenchmarkRun[]>("benchmark_runs", { vault }).catch(() => [] as BenchmarkRun[]);
  if (runs.length === 0) return { models: [], scopeLabel: "", council: false, empty: true, mode };
  const newest = runs[0];
  const group = newest.batch_id
    ? runs.filter((r) => r.batch_id === newest.batch_id)
    : runs.filter((r) => Math.abs(r.created_ms - newest.created_ms) < 5 * 60_000);
  const models: string[] = [];
  let council = false;
  const seen = new Set<string>();
  for (const r of group) {
    if (r.council) { council = true; continue; }
    if (!r.cli) continue;
    const k = `${r.cli}::${r.model ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    models.push(modelKeyLabel(`${r.cli}${MODEL_SEP}${r.model ?? ""}`));
  }
  return { models, scopeLabel: domainScopeLabel(newest.domains ?? []), council, empty: false, mode };
}

// BENCH-2: build jobs from the DECOUPLED scheduled scope (all / custom). Returns
// null for "latest" mode (the caller falls back to rerunLatestBatch). Filters to
// installed CLIs + Bunker-permitted models at build time.
export async function buildScheduledJobs(vault: string): Promise<{ jobs: BenchJob[]; scopeStr: string } | null> {
  const mode = lsGet(BENCH_SCHED.scopeMode, "latest");
  if (mode !== "all" && mode !== "custom") return null;
  let keys = mode === "all"
    ? allBenchModelKeys()
    : lsGet(BENCH_SCHED.scopeModels, "").split(",").map((s) => s.trim()).filter(Boolean);
  if (keys.length === 0) return null;
  const clis = await invoke<{ id: string; available?: boolean }[]>("detect_clis").catch(() => [] as { id: string; available?: boolean }[]);
  const avail = new Set((clis ?? []).filter((c) => c.available !== false).map((c) => c.id));
  keys = keys.filter((k) => { const cli = k.split(MODEL_SEP)[0]; return avail.has(cli) && (!isBunkerOn() || isLocalCli(cli)); });
  if (keys.length === 0) return null;
  const domStr = mode === "custom" ? lsGet(BENCH_SCHED.scopeDomains, "") : "";
  const domSet = new Set(domStr.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const questions = await invoke<BenchQuestion[]>("benchmark_questions", { vault }).catch(() => [] as BenchQuestion[]);
  const qids = questions.filter((q) => domSet.size === 0 || domSet.has(q.domain.toLowerCase())).map((q) => q.id).sort();
  const jobs: BenchJob[] = keys.map((k) => {
    const [cli, model] = k.split(MODEL_SEP);
    const ml = modelLabel(cli, model) || model;
    return { key: `sched-${k}-${Date.now()}`, cli, model, label: `${titleCase(cli)} · ${ml}`, status: "queued", done: 0, total: qids.length, qids, qdone: {} };
  });
  return { jobs, scopeStr: [...domSet].join(",") };
}

// BENCH-2: the single entry point the scheduler + "Run now" use. Honors the
// decoupled scope (all/custom); falls back to repeating the latest batch.
export async function runScheduledBatch(vault: string): Promise<boolean> {
  const built = await buildScheduledJobs(vault).catch(() => null);
  if (built && built.jobs.length > 0) {
    void executeBenchBatch(vault, built.jobs, false, built.scopeStr);
    return true;
  }
  return rerunLatestBatch(vault);
}

// Build + run a batch from an EXPLICIT model + domain scope (a schedule entry).
// Mirrors buildScheduledJobs, but takes its scope from arguments instead of the
// legacy global keys, so each schedule entry runs its own independent set.
// Filters to installed CLIs + Bunker-permitted models at build time.
export async function runBenchModels(vault: string, models: string[], domains: string[]): Promise<boolean> {
  let keys = models.map((s) => s.trim()).filter(Boolean);
  if (keys.length === 0) return false;
  const clis = await invoke<{ id: string; available?: boolean }[]>("detect_clis").catch(() => [] as { id: string; available?: boolean }[]);
  const avail = new Set((clis ?? []).filter((c) => c.available !== false).map((c) => c.id));
  keys = keys.filter((k) => { const cli = k.split(MODEL_SEP)[0]; return avail.has(cli) && (!isBunkerOn() || isLocalCli(cli)); });
  if (keys.length === 0) return false;
  const domSet = new Set(domains.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const questions = await invoke<BenchQuestion[]>("benchmark_questions", { vault }).catch(() => [] as BenchQuestion[]);
  const qids = questions.filter((q) => domSet.size === 0 || domSet.has(q.domain.toLowerCase())).map((q) => q.id).sort();
  const jobs: BenchJob[] = keys.map((k) => {
    const [cli, model] = k.split(MODEL_SEP);
    const ml = modelLabel(cli, model) || model;
    return { key: `sched-${k}-${Date.now()}`, cli, model, label: `${titleCase(cli)} · ${ml}`, status: "queued", done: 0, total: qids.length, qids, qdone: {} };
  });
  void executeBenchBatch(vault, jobs, false, [...domSet].join(","));
  return true;
}

export let benchSchedTimer: number | null = null;

// Fire ONE schedule entry: build + run its explicit scope and stamp its lastRun.
// Isolated so one entry failing (or having nothing runnable) never blocks the
// others in the tick loop.
async function runScheduleEntry(vault: string, entry: BenchSchedule): Promise<void> {
  try {
    if (await runBenchModels(vault, entry.models, entry.domains)) {
      updateSchedule(entry.id, { lastRun: Date.now() });
      window.dispatchEvent(new Event("prevail:bench-sched"));
    }
  } catch (e) {
    console.error("bench schedule entry", entry.id, e);
  }
}

export function startBenchScheduler(vault: string) {
  if (benchSchedTimer !== null) window.clearInterval(benchSchedTimer);
  const tick = async () => {
    try {
      // ITERATE every enabled entry independently: each fires when its own
      // cadence has elapsed, and updates only its own lastRun. One entry being
      // due (or failing) has no bearing on the others.
      const now = Date.now();
      const due = listSchedules().filter((s) => s.enabled && s.models.length > 0 && now - (s.lastRun || 0) >= benchFreqMs(s.freq));
      // Legacy single-global fallback: if there are NO list entries at all yet
      // and the old global schedule is still enabled, honor it once so an
      // un-migrated user keeps their scheduled runs.
      if (listSchedules().length === 0 && lsGet(BENCH_SCHED.enabled, "0") === "1") {
        const freq = benchFreqMs(lsGet(BENCH_SCHED.freq, "weekly") || "weekly");
        const last = Number(lsGet(BENCH_SCHED.lastRun, "0")) || 0;
        if (now - last >= freq && ![...benchBatches.values()].some((b) => b.running)) {
          if (await runScheduledBatch(vault)) {
            lsSet(BENCH_SCHED.lastRun, String(Date.now()));
            window.dispatchEvent(new Event("prevail:bench-sched"));
          }
        }
      }
      // Fire due entries one at a time, never while another benchmark is running,
      // so runs never stack. Remaining due entries fire on subsequent ticks.
      for (const entry of due) {
        if ([...benchBatches.values()].some((b) => b.running)) break;
        await runScheduleEntry(vault, entry);
      }
    } catch (e) {
      console.error("bench scheduler", e);
    }
  };
  void tick();
  benchSchedTimer = window.setInterval(() => void tick(), 30 * 60 * 1000);
}

// Run a batch of benchmark jobs to completion (all jobs in parallel, then one
// scoring pass). Lives at module scope, mutating the registry - NOT component
// state - so the run survives whatever the user navigates to.

export async function executeBenchBatch(
  vault: string,
  plannedJobs: BenchJob[],
  councilMode: boolean,
  scopeStr: string,
  // CONTINUE/RESUME. When set, reuse this batch id (instead of minting a fresh
  // one) so the engine resumes INTO the existing run directories: it skips the
  // questions each model already answered and re-runs only the missing/errored
  // ones. Persisted answers are never regenerated, questions are never
  // recreated. Omit for a brand-new batch.
  resumeBatchId?: string,
): Promise<void> {
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  // Numeric, sortable stamp: YYYY-MM-DD HH:MM (no spelled-out month).
  const dateLabel = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  const hhmm = `${p2(now.getHours())}:${p2(now.getMinutes())}`;
  const batchId = resumeBatchId ?? `b${now.getTime()}`;
  // T18 (inert until keys exist; default-OFF, allowlist-scrubbed to counts only -
  // no model ids, no domain names, no question text).
  track("benchmark_run", { models: plannedJobs.length, domains: scopeStr ? scopeStr.split(",").filter(Boolean).length : 0 });
  const scopeDomains = scopeStr ? scopeStr.split(",").map((d) => titleCase(d.trim())).filter(Boolean) : [];
  const scopeLabel =
    scopeDomains.length === 0 ? "All domains"
    : scopeDomains.length <= 2 ? scopeDomains.join(", ")
    : `${scopeDomains.length} domains`;
  // Compact model label: "Claude Opus 4.7" instead of "Claude · Opus (latest)"
  const shortModel = (j: BenchJob) =>
    `${titleCase(j.cli)} ${(MODELS[j.cli]?.find((m) => m.id === j.model)?.label ?? j.model).replace(/\s*\(.*?\)/, "")}`.trim();
  const modelPart = plannedJobs.length === 1 ? shortModel(plannedJobs[0]) : `${plannedJobs.length} models`;
  // Numeric, sortable, compact label leading with the timestamp, then what was
  // tested. No spelled-out month, minimal punctuation.
  //   "2026-06-19 14:52 · Wealth · 4 models"
  //   "2026-06-19 14:52 · 3 domains · Claude Opus 4.8"
  const batchLabel = `${dateLabel} ${hhmm} · ${scopeLabel} · ${modelPart}`;
  // Drop stale finished batches so the registry never accumulates.
  for (const [k, v] of benchBatches) if (!v.running && v.consumed) benchBatches.delete(k);
  const batch: BenchBatch = {
    id: batchId,
    label: batchLabel,
    scopeLabel,
    scopeKey: scopeStr.toLowerCase(),
    scopeDomains,
    vault,
    councilMode,
    jobs: plannedJobs,
    running: true,
    log: "",
    sessions: [],
    cancelled: false,
    consumed: false,
  };
  benchBatches.set(batchId, batch);
  benchNotify();

  // Run one job: start the model, track per-question progress from its
  // output stream, wait for it, mark scoring.
  const runOne = async (job: BenchJob) => {
    if (batch.cancelled) return;
    benchPatchJob(batch, job.key, { status: "running" });
    const session = `bench-${job.key.replace(/[^a-z0-9]/gi, "")}-${Date.now()}`;
    batch.sessions.push(session);
    // The engine prints one "  <id>… <result>" line per finished question;
    // recount completed lines on every chunk for a live progress bar.
    let buf = "";
    const chunkUnlisten = listen<{ session: string; data: string }>("benchmark:chunk", (e) => {
      if (e.payload.session !== session) return;
      buf += e.payload.data;
      // The CLI emits one "> <id>" line when a question STARTS and one
      // "  <id>… <info>" line when it FINISHES. Count completions for the bar;
      // surface the most recent start (not yet finished) as the live question so
      // the run never looks frozen while a slow model is answering.
      const qdone: Record<string, string> = {};
      let lastStart: string | undefined;
      for (const line of buf.split("\n")) {
        const done = line.match(/^ {2}(\S+)…\s*(.+)$/);
        if (done) { qdone[done[1]] = done[2].trim(); continue; }
        const start = line.match(/^> (\S+)/);
        if (start) lastStart = start[1];
      }
      benchPatchJob(batch, job.key, {
        done: Math.min(Object.keys(qdone).length, job.total),
        qdone,
        qcur: lastStart && !qdone[lastStart] ? lastStart : undefined,
      });
    });
    try {
      await invoke("benchmark_start", {
        args: {
          session_id: session,
          vault,
          cli: job.cli || "claude",
          model: job.model || null,
          council: councilMode,
          domain: scopeStr || null,
          batch_id: batchId,
          batch_label: batchLabel,
        },
      });
      // Watchdog: a single model's run shouldn't be able to hang the batch, but
      // the ceiling must SCALE with how many questions the model answers - a flat
      // 20 minutes would wrongly kill a legitimately-progressing large run (100
      // questions at ~40-60s each is well past 20 min). Budget generously per
      // question on top of a floor, capped so a truly stuck run still unwinds.
      // Because answers now persist incrementally, even a watchdog kill loses no
      // completed work: Continue resumes from what landed on disk.
      const qCount = Math.max(1, job.qids.length || job.total || 1);
      const runWatchdogMs = Math.min(6 * 60 * 60_000, 5 * 60_000 + qCount * 3 * 60_000);
      const code = await benchWaitDone(batch, session, "run", runWatchdogMs);
      if (batch.cancelled) return; // statuses already set by cancelBenchBatch
      if (code === BENCH_TIMEOUT) {
        // Not necessarily lost: partial answers are on disk. Mark it errored so
        // the user can Continue the batch to finish the remaining questions.
        benchPatchJob(batch, job.key, { status: "error", note: "timed out - continue to resume" });
        return;
      }
      if (code !== 0 && code !== null) {
        benchPatchJob(batch, job.key, { status: "error", note: `exit ${code}` });
        return;
      }
      benchPatchJob(batch, job.key, { status: "scoring", done: job.total });
    } catch (e) {
      benchPatchJob(batch, job.key, { status: "error", note: String(e) });
    } finally {
      void chunkUnlisten.then((u) => u());
    }
  };

  try {
    // Bounded concurrency so a big multi-model run can't exhaust memory and trip
    // the memory watchdog (which would SIGKILL the largest model mid-run). Each
    // job is its own engine + model process; local models (Ollama / LM Studio /
    // MLX) are the memory hogs - a single one can be several GB - so we run at
    // most ONE local model at a time, and cap the overall pool too. Cloud models
    // (thin API-backed CLIs) are cheap, so the pool still keeps the run fast.
    // Running all N at once (the old behavior) is what pushed a 16 GB Mac past
    // the ~65%-RAM kill line with 13 models.
    const MAX_CONCURRENT = 4;
    let localBusy = false;
    const pending = [...plannedJobs];
    const worker = async (): Promise<void> => {
      while (!batch.cancelled) {
        // Pick the next job we're allowed to start: any cloud job, or a local
        // job only when no local model is currently running.
        const idx = pending.findIndex((j) => !isLocalCli(j.cli) || !localBusy);
        if (idx === -1) {
          if (pending.length === 0) return; // nothing left this worker can take
          await new Promise((r) => setTimeout(r, 250)); // only local jobs left + one busy
          continue;
        }
        const job = pending.splice(idx, 1)[0]!;
        const local = isLocalCli(job.cli);
        if (local) localBusy = true;
        try { await runOne(job); }
        finally { if (local) localBusy = false; }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT, plannedJobs.length) }, worker),
    );
    if (!batch.cancelled) {
      // Score ONLY this batch's runs (fast) - not every historical run, which
      // would re-score dozens of old runs and stall the fresh scores from landing.
      const scoreSession = `bench-score-${Date.now()}`;
      batch.sessions.push(scoreSession);
      // Scoring itself shouldn't be able to wedge the batch. If the score pass
      // never reports done (crash, lost event), give up after 10 minutes and
      // finalize anyway - the runs are on disk and can be re-scored from History.
      try {
        await invoke("benchmark_score", { args: { session_id: scoreSession, vault, batch: batchId } });
        await benchWaitDone(batch, scoreSession, "score", 10 * 60_000);
      } catch { /* finalize regardless - never leave the batch hung */ }
      if (!batch.cancelled) {
        // Runs that completed move to done; a run still "running" at this point
        // never reported done (timed out) - mark it errored, not stuck-scoring.
        batch.jobs = batch.jobs.map((j) =>
          j.status === "scoring" ? { ...j, status: "done" }
          : j.status === "running" ? { ...j, status: "error", note: j.note ?? "timed out" }
          : j,
        );
      }
    }
  } finally {
    batch.running = false;
    benchNotify();
  }
}
