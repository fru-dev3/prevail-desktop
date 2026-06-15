// Small prop-driven UI cards extracted from App.tsx: the sidebar's running-
// benchmark progress strip, the framework/lens cycle row, and the Settings
// scheduled-benchmark card.
import { useEffect, useState } from "react";
import { CalendarClock, RotateCw } from "lucide-react";
import { FRAMEWORKS, LENSES } from "./constants";
import { formatDuration, formatFreshness } from "./format";
import { lsGet, lsSet } from "./storage";
import { CycleChip } from "./widgets";
import { useFrameworkLens } from "./hooks";
import { benchFreqLabel, benchFreqMs, BENCH_SCHED, cancelBenchBatch, rerunLatestBatch, scheduledRunPreview, useBenchBatches } from "./bench";

// BENCH-1: a persistent indicator that a benchmark is ARMED to run on a
// schedule (distinct from one actively running — SidebarBenchmarkRuns owns
// that). The founder must never have a nightly benchmark running without being
// aware of it. Mirrors the SidebarMcpLive / SidebarGatewayLive "live" pattern,
// but with a steady (non-pulsing) dot + calendar icon to read as "armed".
export function SidebarBenchScheduled({ collapsed }: { collapsed: boolean }) {
  const [on, setOn] = useState(() => lsGet(BENCH_SCHED.enabled, "0") === "1");
  const [freq, setFreq] = useState(() => lsGet(BENCH_SCHED.freq, "weekly") || "weekly");
  const running = useBenchBatches().some((b) => b.running);
  useEffect(() => {
    const sync = () => { setOn(lsGet(BENCH_SCHED.enabled, "0") === "1"); setFreq(lsGet(BENCH_SCHED.freq, "weekly") || "weekly"); };
    window.addEventListener("prevail:bench-sched", sync);
    const id = window.setInterval(sync, 30_000);
    return () => { window.removeEventListener("prevail:bench-sched", sync); window.clearInterval(id); };
  }, []);
  if (!on || running) return null; // a live run already shows in SidebarBenchmarkRuns
  const open = () => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "benchmark" }));
  const title = `A benchmark is scheduled to run ${benchFreqLabel(freq)} in the background. Click for Benchmark settings.`;
  if (collapsed) {
    return (
      <button onClick={open} title={title} className="flex w-full justify-center border-t border-border-subtle px-2 py-2 text-text-muted hover:text-accent">
        <CalendarClock className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <button onClick={open} title={title} className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-2 text-left hover:bg-surface-warm">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span className="flex-1 truncate font-mono text-[10px] uppercase tracking-wide text-text-secondary">Benchmark · {benchFreqLabel(freq)}</span>
      <CalendarClock className="h-3 w-3 shrink-0 text-text-muted" />
    </button>
  );
}

// BENCH-1: the same awareness on the home landing — a compact pill so a
// scheduled run is visible without opening the Benchmark page.
export function HomeBenchScheduledBadge() {
  const [on, setOn] = useState(() => lsGet(BENCH_SCHED.enabled, "0") === "1");
  const [freq, setFreq] = useState(() => lsGet(BENCH_SCHED.freq, "weekly") || "weekly");
  useEffect(() => {
    const sync = () => { setOn(lsGet(BENCH_SCHED.enabled, "0") === "1"); setFreq(lsGet(BENCH_SCHED.freq, "weekly") || "weekly"); };
    window.addEventListener("prevail:bench-sched", sync);
    const id = window.setInterval(sync, 30_000);
    return () => { window.removeEventListener("prevail:bench-sched", sync); window.clearInterval(id); };
  }, []);
  if (!on) return null;
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "benchmark" }))}
      title={`A benchmark runs ${benchFreqLabel(freq)} in the background. Click for Benchmark settings.`}
      className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-text-secondary hover:border-accent-border hover:text-accent"
    >
      <CalendarClock className="h-3.5 w-3.5 text-accent" />
      <span className="font-mono text-[11px] uppercase tracking-wider">Benchmark scheduled · {benchFreqLabel(freq)}</span>
    </button>
  );
}

export function SidebarBenchmarkRuns({ collapsed }: { collapsed: boolean }) {
  const runningBatches = useBenchBatches().filter((b) => b.running);
  if (runningBatches.length === 0) return null;
  if (collapsed) {
    return (
      <div
        className="flex items-center justify-center gap-1 border-t border-border-subtle px-2 py-2"
        title={runningBatches.map((b) => `Benchmarking ${b.scopeLabel}`).join("\n")}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        {runningBatches.length > 1 && (
          <span className="font-mono text-[10px] text-accent">{runningBatches.length}</span>
        )}
      </div>
    );
  }
  return (
    <div className="border-t border-border-subtle">
      {runningBatches.map((b) => {
        const done = b.jobs.reduce(
          (a, j) => a + (j.status === "done" || j.status === "scoring" ? j.total : j.done),
          0,
        );
        const total = b.jobs.reduce((a, j) => a + j.total, 0);
        return (
          <div key={b.id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              <span
                className="flex-1 truncate font-mono text-[10px] uppercase tracking-wide text-accent"
                title={b.label}
              >
                {b.scopeLabel}
              </span>
              <span className="font-mono text-[10px] text-text-muted">{done}/{total}</span>
              <button
                onClick={() => void cancelBenchBatch(b.id)}
                title="Cancel this benchmark run"
                className="shrink-0 rounded px-1 font-mono text-[10px] text-text-muted hover:bg-surface-strong hover:text-danger"
              >
                ✗
              </button>
            </div>
            <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-surface-strong">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FwLensRow({
  fwLens,
  inline = false,
}: {
  fwLens: ReturnType<typeof useFrameworkLens>;
  inline?: boolean;
}) {
  const fw = FRAMEWORKS.find((f) => f.id === fwLens.framework);
  const ln = LENSES.find((l) => l.id === fwLens.lens);
  if (inline) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <CycleChip
          label="◆"
          value={fw?.label ?? "OFF"}
          active={fwLens.framework !== "none"}
          title={`Framework: ${fw?.blurb ?? "(off)"}`}
          onClick={() => {
            const idx = FRAMEWORKS.findIndex((f) => f.id === fwLens.framework);
            fwLens.setFramework(FRAMEWORKS[(idx + 1) % FRAMEWORKS.length].id);
          }}
        />
        <CycleChip
          label="◇"
          value={ln?.label ?? "OFF"}
          active={fwLens.lens !== "none"}
          title={`Lens: ${ln?.blurb ?? "(off)"}`}
          onClick={() => {
            const idx = LENSES.findIndex((l) => l.id === fwLens.lens);
            fwLens.setLens(LENSES[(idx + 1) % LENSES.length].id);
          }}
        />
      </div>
    );
  }
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">defaults</span>

      <CycleChip
        label="◆ Framework"
        value={fw?.label ?? "OFF"}
        active={fwLens.framework !== "none"}
        title={fw?.blurb ?? ""}
        onClick={() => {
          const idx = FRAMEWORKS.findIndex((f) => f.id === fwLens.framework);
          fwLens.setFramework(FRAMEWORKS[(idx + 1) % FRAMEWORKS.length].id);
        }}
      />
      <CycleChip
        label="◇ Lens"
        value={ln?.label ?? "OFF"}
        active={fwLens.lens !== "none"}
        title={ln?.blurb ?? ""}
        onClick={() => {
          const idx = LENSES.findIndex((l) => l.id === fwLens.lens);
          fwLens.setLens(LENSES[(idx + 1) % LENSES.length].id);
        }}
      />
      <span className="ml-auto text-[10px] text-text-muted">
        click chips to cycle · these prepend to every prompt
      </span>
    </div>
  );
}


export function BenchScheduleCard({ vault }: { vault: string }) {
  const [enabled, setEnabled] = useState(() => lsGet(BENCH_SCHED.enabled, "0") === "1");
  const [freq, setFreq] = useState(() => lsGet(BENCH_SCHED.freq, "weekly") || "weekly");
  const [, force] = useState(0);
  // "Run now" used to call rerunLatestBatch and silently do nothing when it
  // returned false (no prior batch, bunker filtered everything out, etc.) — so
  // it looked dead. Track busy + a result message so every click reports back.
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // BENCH-2: show exactly what the scheduled run will execute (models + scope).
  const [preview, setPreview] = useState<{ models: string[]; scopeLabel: string; council: boolean; empty: boolean } | null>(null);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    window.addEventListener("prevail:bench-sched", f);
    return () => window.removeEventListener("prevail:bench-sched", f);
  }, []);
  useEffect(() => {
    let alive = true;
    void scheduledRunPreview(vault).then((p) => { if (alive) setPreview(p); }).catch(() => {});
    return () => { alive = false; };
    // re-derive when a run finishes (the "latest batch" may have changed)
  }, [vault, busy]);
  const last = Number(lsGet(BENCH_SCHED.lastRun, "0")) || 0;
  const isCustom = /^custom:/.test(freq);
  const customDays = isCustom ? (/^custom:(\d+)$/.exec(freq)?.[1] ?? "3") : "3";
  const freqMs = benchFreqMs(freq);
  const next = last ? last + freqMs : Date.now();
  const setFreqPersist = (v: string) => { setFreq(v); lsSet(BENCH_SCHED.freq, v); };
  const runNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const started = await rerunLatestBatch(vault);
      if (started) {
        lsSet(BENCH_SCHED.lastRun, String(Date.now()));
        window.dispatchEvent(new Event("prevail:bench-sched"));
        setMsg("Re-running your latest batch now: watch progress in the sidebar and on the leaderboard.");
      } else {
        setMsg("No previous batch to re-run yet. Run a benchmark once (pick models + scope), then Run now repeats it.");
      }
    } catch (e) {
      setMsg(`Couldn't start the run: ${e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-5 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <RotateCw className={`h-4 w-4 shrink-0 text-accent ${busy ? "animate-spin" : ""}`} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-semibold tracking-tight">Scheduled runs</div>
          <div className="text-xs text-text-secondary">
            Re-runs your most recent batch (same models, same scope) so drift shows up in the leaderboard and History without manual runs. Runs while the app is open.
            {enabled && last > 0 && ` Last ran ${formatFreshness(Math.max(0, (Date.now() - last) / 1000))}.`}
            {enabled && ` Next ${next <= Date.now() ? "within 30 minutes" : `in ~${formatDuration(Math.max(0, (next - Date.now()) / 1000))}`}.`}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={isCustom ? "custom" : freq}
            onChange={(e) => setFreqPersist(e.target.value === "custom" ? `custom:${customDays}` : e.target.value)}
            disabled={!enabled}
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary disabled:opacity-40"
          >
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
            <option value="custom">every N days</option>
          </select>
          {isCustom && (
            <div className="flex items-center gap-1">
              <input
                type="number" min={1} max={365} value={customDays} disabled={!enabled}
                onChange={(e) => setFreqPersist(`custom:${Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1))}`)}
                className="w-14 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-[11px] text-text-secondary disabled:opacity-40"
              />
              <span className="font-mono text-[10px] text-text-muted">days</span>
            </div>
          )}
        </div>
        <button
          onClick={() => { const v = !enabled; setEnabled(v); lsSet(BENCH_SCHED.enabled, v ? "1" : "0"); }}
          className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${
            enabled ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"
          }`}
        >
          {enabled ? "On" : "Off"}
        </button>
        <button
          onClick={runNow}
          disabled={busy}
          title="Re-run the latest batch right now"
          className="rounded-md border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40"
        >
          {busy ? "Starting…" : "Run now"}
        </button>
      </div>
      {/* BENCH-2: exactly what the scheduled run will execute, + the
          single-model trap warning the founder flagged. */}
      {preview && !preview.empty && (
        <div className="mt-2 rounded-lg border border-border-subtle bg-background px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Will run (repeats your latest batch)</div>
          <div className="mt-0.5 text-xs text-text-secondary">
            {[preview.council ? "Council" : null, ...preview.models].filter(Boolean).join(" · ") || "—"}
            {" · "}<span className="text-text-primary">{preview.scopeLabel}</span>
          </div>
          {preview.models.length === 1 && !preview.council && (
            <div className="mt-1 text-[11px] text-warn">
              Only 1 model in your last run, so the schedule only tracks that one. Run a benchmark with every model you want tracked, then the schedule repeats that set.
            </div>
          )}
        </div>
      )}
      {preview?.empty && enabled && (
        <div className="mt-2 text-[11px] text-text-muted">No previous batch yet: run a benchmark once (pick the models + domains you want tracked) and the schedule repeats exactly that.</div>
      )}
      {msg && <div className="mt-2 text-xs text-text-secondary">{msg}</div>}
    </div>
  );
}
