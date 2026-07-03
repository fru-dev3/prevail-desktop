// Retrospect — where your attention went, over time. A cross-domain read-over of
// the intent ledger (retrospect_rollup): a vantage switch (day/week/month/year),
// a spine of periods, and per period a headline, an attention breakdown by
// domain, and the threads of work underneath. Counts + threads are REAL; the
// headline is a plain data summary for now (AI theme headline is a later phase).
import { useEffect, useMemo, useState } from "react";
import { invoke } from "./bridge";
import { titleCase } from "./format";

type Vantage = "day" | "week" | "month" | "year";
interface Thread { domain: string; message: string; ts: number; count: number }
interface DomCount { domain: string; count: number }
interface Period { key: string; label: string; total: number; byDomain: DomCount[]; threads: Thread[] }
interface Rollup { vantage: string; periods: Period[] }

// A small warm palette; a domain always maps to the same color (stable hash).
const PALETTE = ["#e0913f", "#7ba0c4", "#6fb0a6", "#c98a8a", "#66a67e", "#a98fc4", "#d0a94e", "#8aa0b8"];
function domColor(d: string): string {
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const VANTAGES: { id: Vantage; label: string }[] = [
  { id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "month", label: "Month" }, { id: "year", label: "Year" },
];

export function RetrospectPanel({ vaultPath }: { vaultPath: string }) {
  const [vantage, setVantage] = useState<Vantage>("month");
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    invoke<Rollup>("retrospect_rollup", { vault: vaultPath, vantage, tzOffsetMinutes: new Date().getTimezoneOffset() })
      .then((r) => { if (!alive) return; setRollup(r); setSelKey((cur) => r.periods.some((p) => p.key === cur) ? cur : (r.periods[0]?.key ?? null)); })
      .catch(() => { if (alive) setRollup({ vantage, periods: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [vaultPath, vantage]);

  const sel = useMemo(() => rollup?.periods.find((p) => p.key === selKey) ?? rollup?.periods[0] ?? null, [rollup, selKey]);
  const maxTotal = useMemo(() => Math.max(1, ...(rollup?.periods.map((p) => p.total) ?? [1])), [rollup]);
  const domains = sel?.byDomain ?? [];
  const shownThreads = useMemo(() => (sel?.threads ?? []).filter((t) => !filter || t.domain === filter), [sel, filter]);
  const shownDomains = useMemo(() => domains.filter((d) => !filter || d.domain === filter), [domains, filter]);
  const domTotal = shownDomains.reduce((a, d) => a + d.count, 0) || 1;
  const top = domains[0];

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Bar: vantage switch + domain filter */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <div className="flex items-center gap-2 font-display text-lg font-semibold text-text-primary">
          <span className="flex h-6 w-6 items-center justify-center rounded-md border border-accent-border bg-accent-soft text-accent">↺</span>
          Retrospect
        </div>
        <div className="ml-2 inline-flex overflow-hidden rounded-lg border border-border">
          {VANTAGES.map((v) => (
            <button key={v.id} onClick={() => setVantage(v.id)}
              className={`px-3 py-1.5 font-mono text-[11px] tracking-wide transition-colors ${vantage === v.id ? "bg-accent font-bold text-background" : "text-text-muted hover:bg-surface-warm hover:text-text-secondary"}`}>
              {v.label}
            </button>
          ))}
        </div>
        {domains.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button onClick={() => setFilter(null)}
              className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${!filter ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:text-text-secondary"}`}>
              All domains
            </button>
            {domains.slice(0, 6).map((d) => (
              <button key={d.domain} onClick={() => setFilter(filter === d.domain ? null : d.domain)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${filter === d.domain ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:text-text-secondary"}`}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: domColor(d.domain) }} /> {titleCase(d.domain)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Spine: periods */}
        <div className="w-56 shrink-0 overflow-y-auto border-r border-border bg-surface/40 p-2">
          <div className="px-2.5 pb-2 pt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">{vantage === "year" ? "years" : `${vantage}s`}</div>
          {(rollup?.periods ?? []).map((p) => {
            const on = p.key === (sel?.key ?? "");
            const t = p.byDomain[0];
            return (
              <button key={p.key} onClick={() => setSelKey(p.key)}
                className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-[13px] ${on ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{p.label}</div>
                  <div className="font-mono text-[10px] text-text-muted">{p.total} prompt{p.total === 1 ? "" : "s"}{t ? ` · ${titleCase(t.domain)}` : ""}</div>
                </div>
                <span className="h-6 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t ? domColor(t.domain) : "var(--border)", opacity: 0.3 + 0.7 * (p.total / maxTotal) }} />
              </button>
            );
          })}
          {(rollup?.periods.length ?? 0) === 0 && !loading && (
            <div className="px-2.5 py-4 text-[12px] leading-snug text-text-muted">No prompts recorded yet. Retrospect fills in as you use Prevail.</div>
          )}
        </div>

        {/* Main */}
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="font-mono text-[12px] text-text-muted">reading your intents…</div>
          ) : !sel ? (
            <div className="max-w-md text-sm text-text-muted">Nothing to look back on yet. As you chat day to day, Retrospect shows where your attention went — by day, week, month, and year.</div>
          ) : (
            <>
              <div className="font-display text-2xl font-semibold text-text-primary" style={{ textWrap: "balance" } as React.CSSProperties}>
                {top ? (<>In {sel.label}, you were mostly in <span className="text-accent">{titleCase(top.domain)}</span>.</>) : (<>In {sel.label}.</>)}
              </div>
              {/* The biggest thread as a plain-language "what you were working on"
                  theme — data-driven from the ledger, no model needed. */}
              {sel.threads[0]?.message && (
                <div className="mt-1.5 text-[14px] leading-snug text-text-secondary">
                  Mostly: <span className="text-text-primary">{sel.threads[0].message}</span>
                  {sel.threads[1]?.message && (top && sel.threads[1].domain !== top.domain) ? (
                    <span className="text-text-muted"> · also {titleCase(sel.threads[1].domain)}: {sel.threads[1].message}</span>
                  ) : null}
                </div>
              )}
              <div className="mt-1.5 font-mono text-[11px] text-text-muted">{sel.total} prompt{sel.total === 1 ? "" : "s"} · {domains.length} domain{domains.length === 1 ? "" : "s"} touched</div>

              {/* Attention bars */}
              <div className="mt-6">
                <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">Where your attention went</div>
                {shownDomains.map((d) => {
                  const pct = Math.round((d.count / domTotal) * 100);
                  return (
                    <div key={d.domain} className="mb-2 flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-right text-[13px] text-text-secondary">{titleCase(d.domain)}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded-md bg-surface">
                        <div className="flex h-full items-center rounded-md pl-2 font-mono text-[10px] font-bold text-background" style={{ width: `${Math.max(pct, 6)}%`, backgroundColor: domColor(d.domain) }}>{d.count}</div>
                      </div>
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] text-text-muted">{pct}%</span>
                    </div>
                  );
                })}
              </div>

              {/* Threads */}
              <div className="mt-7">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">The threads · most-worked first</div>
                {shownThreads.length === 0 ? (
                  <div className="py-2 text-[13px] text-text-muted">No threads for this filter.</div>
                ) : shownThreads.map((t, i) => (
                  <div key={i} className="flex gap-3 border-b border-border-subtle py-2.5 last:border-b-0">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: domColor(t.domain) }} />
                    <div className="min-w-0">
                      <div className="text-[14px] leading-snug text-text-primary">{t.message}</div>
                      <div className="mt-0.5 font-mono text-[10.5px] text-text-muted">{titleCase(t.domain)} · {t.count} prompt{t.count === 1 ? "" : "s"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
