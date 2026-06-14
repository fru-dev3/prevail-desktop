// Small prop-driven UI cards extracted from App.tsx: the sidebar's running-
// benchmark progress strip, the framework/lens cycle row, and the Settings
// scheduled-benchmark card.
import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { FRAMEWORKS, LENSES } from "./constants";
import { formatFreshness } from "./format";
import { lsGet, lsSet } from "./storage";
import { CycleChip } from "./widgets";
import { useFrameworkLens } from "./hooks";
import { BENCH_FREQ_MS, BENCH_SCHED, cancelBenchBatch, rerunLatestBatch, useBenchBatches } from "./bench";

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
  useEffect(() => {
    const f = () => force((n) => n + 1);
    window.addEventListener("prevail:bench-sched", f);
    return () => window.removeEventListener("prevail:bench-sched", f);
  }, []);
  const last = Number(lsGet(BENCH_SCHED.lastRun, "0")) || 0;
  const freqMs = BENCH_FREQ_MS[freq] ?? BENCH_FREQ_MS.weekly;
  const next = last ? last + freqMs : Date.now();
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <RotateCw className="h-4 w-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="font-display text-sm font-semibold tracking-tight">Scheduled runs</div>
        <div className="text-xs text-text-secondary">
          Re-runs your most recent batch (same models, same scope) so drift shows up in the leaderboard and History without manual runs. Runs while the app is open.
          {enabled && last > 0 && ` Last ran ${formatFreshness(Math.max(0, (Date.now() - last) / 1000))} ago.`}
          {enabled && ` Next ${next <= Date.now() ? "within 30 minutes" : `in ~${formatFreshness(Math.max(0, (next - Date.now()) / 1000))}`}.`}
        </div>
      </div>
      <select
        value={freq}
        onChange={(e) => { setFreq(e.target.value); lsSet(BENCH_SCHED.freq, e.target.value); }}
        disabled={!enabled}
        className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary disabled:opacity-40"
      >
        <option value="daily">daily</option>
        <option value="weekly">weekly</option>
        <option value="monthly">monthly</option>
      </select>
      <button
        onClick={() => { const v = !enabled; setEnabled(v); lsSet(BENCH_SCHED.enabled, v ? "1" : "0"); }}
        className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${
          enabled ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"
        }`}
      >
        {enabled ? "On" : "Off"}
      </button>
      <button
        onClick={async () => { if (await rerunLatestBatch(vault)) { lsSet(BENCH_SCHED.lastRun, String(Date.now())); window.dispatchEvent(new Event("prevail:bench-sched")); } }}
        title="Re-run the latest batch right now"
        className="rounded-md border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
      >
        Run now
      </button>
    </div>
  );
}
