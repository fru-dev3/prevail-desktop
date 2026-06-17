// Small prop-driven UI cards extracted from App.tsx: the sidebar's running-
// benchmark progress strip, the framework/lens cycle row, and the Settings
// scheduled-benchmark card.
import { useEffect, useState } from "react";
import { Activity, Archive, CalendarClock, Check, Loader2, RotateCw, SlidersHorizontal } from "lucide-react";
import { useProcesses } from "./processes";
import { Toggle } from "./ui";
import { BACKUP_CFG } from "./backup";
import { invoke } from "./bridge";
import { FRAMEWORKS, LENSES, MODELS, MODEL_SEP } from "./constants";
import { formatFreshness, titleCase } from "./format";
import { isLocalCli } from "./helpers";
import { isBunkerOn, lsGet, lsSet } from "./storage";
import { CycleChip } from "./widgets";
import { useFrameworkLens } from "./hooks";
import { allBenchModelKeys, BENCH_CLI_OPTIONS, benchFreqLabel, benchFreqMs, BENCH_SCHED, cancelBenchBatch, runScheduledBatch, scheduledRunPreview, useBenchBatches } from "./bench";

// B2-7: a concrete next-run label, e.g. "Mon Jun 23, 2:30 PM". Shows the weekday
// + date only when it's not today, so a same-day run reads as just the time.
function nextRunLabel(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = new Date().toDateString() === d.toDateString();
  if (sameDay) return `today, ${time}`;
  const date = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return `${date}, ${time}`;
}

// BENCH-1: a persistent indicator that a benchmark is ARMED to run on a
// schedule (distinct from one actively running - SidebarBenchmarkRuns owns
// that). The founder must never have a nightly benchmark running without being
// aware of it. Mirrors the SidebarMcpLive / SidebarGatewayLive "live" pattern,
// but with a steady (non-pulsing) dot + calendar icon to read as "armed".
// P2: a live "N processes" indicator. Lists every long-running thing (chat,
// council, benchmark, loop) so the user can see work continuing while they move
// around, and click to jump back to it.
export function SidebarProcesses({ collapsed, setTab }: { collapsed: boolean; setTab?: (t: "chat" | "council" | "benchmark" | "settings") => void }) {
  const procs = useProcesses();
  if (procs.length === 0) return null;
  const n = procs.length;
  const jump = (p: { kind: string }) => {
    if (p.kind === "council") setTab?.("council");
    else if (p.kind === "benchmark") setTab?.("benchmark");
    else setTab?.("chat");
  };
  if (collapsed) {
    return (
      <div title={`${n} process${n === 1 ? "" : "es"} running`} className="flex w-full flex-col items-center gap-0.5 border-t border-border-subtle px-2 py-2 text-accent">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="font-mono text-[9px]">{n}</span>
      </div>
    );
  }
  return (
    <div className="border-t border-border-subtle">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />
        <span className="flex-1 font-mono text-[10px] uppercase tracking-wide text-accent">{n} process{n === 1 ? "" : "es"} running</span>
        <Activity className="h-3 w-3 shrink-0 text-text-muted" />
      </div>
      <div className="pb-1">
        {procs.slice(0, 4).map((p) => (
          <button key={p.id} onClick={() => jump(p)} title="Jump to this process" className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-surface-warm">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span className="flex-1 truncate font-mono text-[10px] text-text-secondary">{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

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

// W2 (Monday feedback): a clear sidebar indicator when automatic backups are ON,
// so the user always knows their vault is being snapshotted. Same pattern as the
// scheduled-benchmark indicator.
export function SidebarBackupActive({ collapsed }: { collapsed: boolean }) {
  const [on, setOn] = useState(() => lsGet(BACKUP_CFG.enabled, "0") === "1");
  const [freq, setFreq] = useState(() => lsGet(BACKUP_CFG.freq, "weekly") || "weekly");
  useEffect(() => {
    const sync = () => { setOn(lsGet(BACKUP_CFG.enabled, "0") === "1"); setFreq(lsGet(BACKUP_CFG.freq, "weekly") || "weekly"); };
    window.addEventListener("prevail:backup-done", sync);
    const id = window.setInterval(sync, 30_000);
    return () => { window.removeEventListener("prevail:backup-done", sync); window.clearInterval(id); };
  }, []);
  if (!on) return null;
  const label = /^custom:/.test(freq) ? "every N days" : freq;
  const open = () => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "workspace" }));
  const title = `Automatic vault backups are ON (${label}). Click for Workspace.`;
  if (collapsed) {
    return (
      <button onClick={open} title={title} className="flex w-full justify-center border-t border-border-subtle px-2 py-2 text-text-muted hover:text-accent">
        <Archive className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <button onClick={open} title={title} className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-2 text-left hover:bg-surface-warm">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
      <span className="flex-1 truncate font-mono text-[10px] uppercase tracking-wide text-text-secondary">Backups · {label}</span>
      <Archive className="h-3 w-3 shrink-0 text-text-muted" />
    </button>
  );
}

// BENCH-1: the same awareness on the home landing - a compact pill so a
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
  // returned false (no prior batch, bunker filtered everything out, etc.) - so
  // it looked dead. Track busy + a result message so every click reports back.
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // BENCH-2: show exactly what the scheduled run will execute (models + scope).
  const [preview, setPreview] = useState<{ models: string[]; scopeLabel: string; council: boolean; empty: boolean; mode: string } | null>(null);
  // BENCH-2: the DECOUPLED scheduled scope (independent of the manual Run picker).
  const [scopeMode, setScopeMode] = useState(() => lsGet(BENCH_SCHED.scopeMode, "latest"));
  const [scopeModels, setScopeModels] = useState<Set<string>>(() => new Set(lsGet(BENCH_SCHED.scopeModels, "").split(",").map((s) => s.trim()).filter(Boolean)));
  const [scopeDomains, setScopeDomains] = useState<Set<string>>(() => new Set(lsGet(BENCH_SCHED.scopeDomains, "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)));
  const [vaultDomains, setVaultDomains] = useState<string[]>([]);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    window.addEventListener("prevail:bench-sched", f);
    return () => window.removeEventListener("prevail:bench-sched", f);
  }, []);
  useEffect(() => {
    let alive = true;
    void scheduledRunPreview(vault).then((p) => { if (alive) setPreview(p); }).catch(() => {});
    return () => { alive = false; };
    // re-derive when a run finishes or the scope changes.
  }, [vault, busy, scopeMode, scopeModels, scopeDomains]);
  useEffect(() => {
    if (scopeMode === "custom" && vaultDomains.length === 0) {
      void invoke<{ name: string }[]>("scan_vault", { path: vault })
        .then((ds) => setVaultDomains((ds ?? []).map((d) => d.name.toLowerCase()).sort()))
        .catch(() => {});
    }
  }, [scopeMode, vault, vaultDomains.length]);
  const setMode = (m: string) => { setScopeMode(m); lsSet(BENCH_SCHED.scopeMode, m); window.dispatchEvent(new Event("prevail:bench-sched")); };
  const toggleScopeModel = (k: string) => setScopeModels((cur) => { const n = new Set(cur); n.has(k) ? n.delete(k) : n.add(k); lsSet(BENCH_SCHED.scopeModels, [...n].join(",")); return n; });
  const toggleScopeDomain = (d: string) => setScopeDomains((cur) => { const n = new Set(cur); n.has(d) ? n.delete(d) : n.add(d); lsSet(BENCH_SCHED.scopeDomains, [...n].join(",")); return n; });
  const selectAllModels = () => { const all = new Set(allBenchModelKeys()); setScopeModels(all); lsSet(BENCH_SCHED.scopeModels, [...all].join(",")); };
  const clearModels = () => { setScopeModels(new Set()); lsSet(BENCH_SCHED.scopeModels, ""); };
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
      const started = await runScheduledBatch(vault);
      if (started) {
        lsSet(BENCH_SCHED.lastRun, String(Date.now()));
        window.dispatchEvent(new Event("prevail:bench-sched"));
        setMsg("Started the scheduled run now: watch progress in the sidebar and on the leaderboard.");
      } else {
        setMsg("Nothing to run yet. Pick a scope below (or run a benchmark once so 'Repeat latest run' has something to repeat).");
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
            Runs a benchmark on a cadence so drift shows up in the leaderboard and History without manual runs (while the app is open). Its scope is set below, independent of your manual Run selection.
            {enabled && last > 0 && ` Last ran ${formatFreshness(Math.max(0, (Date.now() - last) / 1000))}.`}
          </div>
          {/* B2-7: show the concrete next-run date + time, not just a cadence. */}
          {enabled && (
            <div className="mt-1 font-mono text-[10px] text-accent">
              Next run: {next <= Date.now() ? "within 30 minutes" : nextRunLabel(next)}
            </div>
          )}
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
        {/* B2-6: pill toggle, not On/Off text. */}
        <Toggle on={enabled} onChange={(v) => { setEnabled(v); lsSet(BENCH_SCHED.enabled, v ? "1" : "0"); }} label="Scheduled runs" />
        <button
          onClick={runNow}
          disabled={busy}
          title="Re-run the latest batch right now"
          className="rounded-md border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40"
        >
          {busy ? "Starting…" : "Run now"}
        </button>
      </div>

      {/* BENCH-2: the DECOUPLED scheduled scope - independent of the manual Run
          picker. "All" tracks every model x all domains even if a manual run was
          a single model; "Custom" pins an explicit set. */}
      <div className="mt-3 border-t border-border-subtle pt-3">
        <div className="mb-2 flex items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 text-text-muted" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-text-secondary">Scheduled scope</span>
          <span className="text-[11px] text-text-muted">independent of your manual Run selection</span>
        </div>
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-background p-1 text-xs">
          {([["latest", "Repeat latest run"], ["all", "All models × all domains"], ["custom", "Custom"]] as const).map(([m, l]) => (
            <button key={m} onClick={() => setMode(m)} disabled={!enabled}
              className={`rounded px-2.5 py-1 transition-colors disabled:opacity-40 ${scopeMode === m ? "bg-accent text-background shadow-sm" : "text-text-secondary hover:bg-surface-warm"}`}>
              {l}
            </button>
          ))}
        </div>
        {scopeMode === "custom" && enabled && (
          <div className="mt-3 space-y-3 rounded-lg border border-border-subtle bg-background p-3">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Models · {scopeModels.size}</span>
                <button onClick={selectAllModels} className="font-mono text-[10px] uppercase tracking-wider text-accent hover:underline">all</button>
                <button onClick={clearModels} className="font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary">none</button>
              </div>
              <div className="space-y-2">
                {BENCH_CLI_OPTIONS.map((c) => {
                  const models = MODELS[c.id] ?? [];
                  if (models.length === 0) return null;
                  const blocked = isBunkerOn() && !isLocalCli(c.id);
                  return (
                    <div key={c.id}>
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary">{c.label}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {models.map((m) => {
                          const k = `${c.id}${MODEL_SEP}${m.id}`;
                          const on = scopeModels.has(k);
                          return (
                            <button key={m.id} onClick={() => toggleScopeModel(k)} disabled={blocked}
                              title={blocked ? "Blocked by Bunker Mode" : m.blurb}
                              className={`rounded-full border px-2 py-0.5 text-[11px] disabled:opacity-40 ${on ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-surface text-text-muted hover:border-accent-border"}`}>
                              {on && <Check className="mr-1 inline h-2.5 w-2.5" />}{m.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Domains · {scopeDomains.size === 0 ? "all" : scopeDomains.size}</div>
              <div className="flex flex-wrap gap-1.5">
                {vaultDomains.length === 0 ? <span className="text-[11px] text-text-muted">loading domains…</span> :
                  vaultDomains.map((d) => {
                    const on = scopeDomains.has(d);
                    return (
                      <button key={d} onClick={() => toggleScopeDomain(d)}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-surface text-text-muted hover:border-accent-border"}`}>
                        {on && <Check className="mr-1 inline h-2.5 w-2.5" />}{titleCase(d)}
                      </button>
                    );
                  })}
              </div>
              <div className="mt-1 text-[10px] text-text-muted">None selected = all domains.</div>
            </div>
          </div>
        )}
      </div>

      {/* BENCH-2: exactly what the scheduled run will execute, + the
          single-model trap warning (only meaningful in "repeat latest" mode). */}
      {preview && !preview.empty && (
        <div className="mt-2 rounded-lg border border-border-subtle bg-background px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            Will run {preview.mode === "all" ? "(all models × all domains)" : preview.mode === "custom" ? "(your scheduled selection)" : "(repeats your latest batch)"}
          </div>
          <div className="mt-0.5 text-xs text-text-secondary">
            {[preview.council ? "Council" : null, ...preview.models].filter(Boolean).join(" · ") || "-"}
            {" · "}<span className="text-text-primary">{preview.scopeLabel}</span>
          </div>
          {preview.mode === "latest" && preview.models.length === 1 && !preview.council && (
            <div className="mt-1 text-[11px] text-warn">
              Only 1 model in your last run, so "Repeat latest run" only tracks that one. Switch to "All models" or "Custom" above to track drift across models.
            </div>
          )}
        </div>
      )}
      {preview?.empty && enabled && (
        <div className="mt-2 text-[11px] text-text-muted">
          {scopeMode === "custom"
            ? "Pick at least one model above for the scheduled run."
            : "No previous batch yet: run a benchmark once, or switch the scope to \"All models × all domains\"."}
        </div>
      )}
      {msg && <div className="mt-2 text-xs text-text-secondary">{msg}</div>}
    </div>
  );
}
