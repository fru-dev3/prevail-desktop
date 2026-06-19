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
    const cleanup = () => { unlisten?.(); chunkUn?.(); if (timer) clearTimeout(timer); };
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

export let benchSchedTimer: number | null = null;

export function startBenchScheduler(vault: string) {
  if (benchSchedTimer !== null) window.clearInterval(benchSchedTimer);
  const tick = async () => {
    try {
      if (lsGet(BENCH_SCHED.enabled, "0") !== "1") return;
      const freq = benchFreqMs(lsGet(BENCH_SCHED.freq, "weekly") || "weekly");
      const last = Number(lsGet(BENCH_SCHED.lastRun, "0")) || 0;
      if (Date.now() - last < freq) return;
      if ([...benchBatches.values()].some((b) => b.running)) return; // never stack
      if (await runScheduledBatch(vault)) {
        lsSet(BENCH_SCHED.lastRun, String(Date.now()));
        window.dispatchEvent(new Event("prevail:bench-sched"));
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
): Promise<void> {
  const now = new Date();
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateLabel = `${MONTHS[now.getMonth()]} ${now.getDate()}`;
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const batchId = `b${now.getTime()}`;
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
  const batchLabel = `${dateLabel} ${hhmm.replace(":", "-")} ${scopeLabel} ${modelPart}`;
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
      // Completed questions are full "  <id>… <info>" lines; the question
      // currently in flight is a trailing "  <id>…" with no info yet.
      const qdone: Record<string, string> = {};
      const lines = buf.split("\n");
      for (const line of lines) {
        const m = line.match(/^ {2}(\S+)…\s*(.+)$/);
        if (m) qdone[m[1]] = m[2].trim();
      }
      const tail = lines[lines.length - 1] ?? "";
      const cm = tail.match(/^ {2}(\S+)…\s*$/);
      benchPatchJob(batch, job.key, {
        done: Math.min(Object.keys(qdone).length, job.total),
        qdone,
        qcur: cm?.[1],
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
      // Watchdog: a single model's run shouldn't be able to hang the batch. 20
      // minutes is generous even for a slow local model on a few questions.
      const code = await benchWaitDone(batch, session, "run", 20 * 60_000);
      if (batch.cancelled) return; // statuses already set by cancelBenchBatch
      if (code === BENCH_TIMEOUT) {
        benchPatchJob(batch, job.key, { status: "error", note: "timed out - no response" });
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
    // ALL jobs run in parallel - each is its own engine process, and
    // waiting serially on a 24-question run per model is far worse than
    // the occasional provider rate-limit (which surfaces as a per-job
    // error you can rerun).
    await Promise.all(plannedJobs.map(runOne));
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
