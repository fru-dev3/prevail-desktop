// Components extracted from App.tsx.
import { useEffect, useState } from "react";
import { Activity, Coins, Cpu, Layers, Loader2, LucideIcon, MessageSquare, MessagesSquare, RefreshCw, TrendingUp, Users } from "lucide-react";
import { invoke } from "./bridge";
import { formatFreshness, titleCase } from "./format";
import { compactNum, fmtCost } from "./helpers";
import { InsightsDisclosure } from "./widgets";
import { PreambleCard, SurfacePanel, TasksPanel, UsageBreakdown } from "./panels";
import type { PreambleOption, UsageSummary } from "./types";

export function InsightsPanel({ vaultPath, domain, onSeed }: { vaultPath: string; domain: string; onSeed: (t: string) => void }) {
  const [taskNonce, setTaskNonce] = useState(0);
  const [intents, setIntents] = useState<{ message?: string; cli?: string; model?: string; ts?: number }[]>([]);
  useEffect(() => {
    invoke<{ message?: string; cli?: string; model?: string; ts?: number }[]>("intents_read", { vault: vaultPath, domain, limit: 15 })
      .then((v) => setIntents(Array.isArray(v) ? v : []))
      .catch(() => setIntents([]));
  }, [vaultPath, domain, taskNonce]);
  return (
    <div className="flex flex-col gap-6">
      <SurfacePanel
        vaultPath={vaultPath}
        domain={domain}
        onPick={onSeed}
        onAddTask={async (t) => { try { await invoke("tasks_add", { vault: vaultPath, domain, text: t, source: "surface" }); setTaskNonce((n) => n + 1); } catch (e) { console.error("tasks_add", e); } }}
      />
      <TasksPanel vaultPath={vaultPath} domain={domain} nonce={taskNonce} />
      {/* I6: the intents ledger, collapsed like everything else on this page. */}
      <InsightsDisclosure title="Recent intents" icon={MessageSquare} count={intents.length}>
        <p className="mb-2 text-xs leading-relaxed text-text-secondary">
          Every question you send is logged as an intent: the exact ask plus the settings in effect, so a future, better model can replay it. These stay on your machine. Click one to ask it again. The full cross-domain ledger lives in Settings → Intents.
        </p>
        {intents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-text-muted">No intents captured yet: ask something in chat.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {intents.map((it, i) => (
              <li key={i}>
                <button
                  onClick={() => onSeed(String(it.message ?? ""))}
                  className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-left hover:-translate-y-px hover:border-accent-border hover:shadow-sm"
                >
                  <div className="line-clamp-2 text-sm text-text-primary">{String(it.message ?? "(no text)")}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-text-muted">
                    {it.cli ?? ""}{it.model ? ` · ${it.model}` : ""}{it.ts ? ` · ${formatFreshness((Date.now() - it.ts) / 1000)}` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </InsightsDisclosure>
    </div>
  );
}

export function UsageDashboard({
  vault,
  domain,
  nonce,
  hideWhenEmpty,
}: {
  vault: string;
  domain?: string | null;
  nonce?: number;
  hideWhenEmpty?: boolean;
}) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  // S2: refresh when a chat turn appends usage (event from chatpanel), so the
  // panel populates ~realtime instead of only on a thread/domain/nonce change.
  // A manual Refresh button bumps the same nonce so the user can force a re-read
  // (usage is appended async; a button gives an immediate "show me now").
  const [usageNonce, setUsageNonce] = useState(0);
  const reload = () => setUsageNonce((n) => n + 1);
  useEffect(() => {
    const h = () => setUsageNonce((n) => n + 1);
    window.addEventListener("prevail:usage-updated", h);
    return () => window.removeEventListener("prevail:usage-updated", h);
  }, []);
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    (async () => {
      try {
        const s = domain
          ? await invoke<UsageSummary>("usage_summary_domain", { vault, domain })
          : await invoke<UsageSummary>("usage_summary", { vault });
        if (alive) setSummary(s);
      } catch (e) {
        console.error("usage_summary failed", e);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [vault, domain, nonce, usageNonce]);

  if (!summary || summary.total_turns === 0) {
    if (hideWhenEmpty || !loaded) return null;
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
        <span>
          No usage recorded {domain ? `for ${titleCase(domain)} ` : ""}yet. Token and cost
          stats appear here once you start chatting.
        </span>
        <button onClick={reload} title="Check for usage now"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent">
          {loaded ? <RefreshCw className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />} Refresh
        </button>
      </div>
    );
  }

  const inTok = summary.total_input_tokens;
  const outTok = summary.total_output_tokens;
  const avgCost = summary.total_turns > 0 ? summary.total_cost_usd / summary.total_turns : 0;
  // Per-day activity strip - last 14 days of recorded turns.
  const days = summary.by_day.slice(-14);
  const dayMax = Math.max(1, ...days.map((d) => d.turns));
  const stats: { label: string; value: string; sub: string; icon: LucideIcon }[] = [
    {
      label: "Turns",
      value: summary.total_turns.toLocaleString(),
      sub: days.length > 1 ? `over ${days.length} days` : "recorded",
      icon: MessagesSquare,
    },
    {
      label: "Tokens",
      value: compactNum(inTok + outTok),
      sub: `${compactNum(inTok)} in · ${compactNum(outTok)} out`,
      icon: TrendingUp,
    },
    {
      label: "Cost",
      value: fmtCost(summary.total_cost_usd),
      sub: `${fmtCost(avgCost)} / turn avg`,
      icon: Coins,
    },
  ];
  // Short label for an activity bar (key is YYYY-MM-DD → MM/DD).
  const shortDay = (key: string) => (key.length >= 10 ? key.slice(5).replace("-", "/") : key);

  return (
    <div className="mt-3 w-full">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
        <Activity className="h-3.5 w-3.5" />
        Usage
        <button onClick={reload} title="Refresh usage now"
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-text-muted hover:border-accent-border hover:text-accent">
          {loaded ? <RefreshCw className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />} Refresh
        </button>
      </div>

      {/* hero totals - icon chip + big value + context sub, filling each card */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-3.5 rounded-xl border border-border-subtle bg-surface p-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <s.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{s.label}</div>
              <div className="font-display text-2xl font-semibold leading-tight tabular-nums text-text-primary">
                {s.value}
              </div>
              <div className="truncate font-mono text-[10px] text-text-muted">{s.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* per-day activity strip - taller bars with date labels for context */}
      {days.length > 1 && (
        <div className="mt-3 rounded-xl border border-border-subtle bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
              Activity · last {days.length} day{days.length === 1 ? "" : "s"}
            </div>
            <div className="font-mono text-[10px] text-text-muted">
              {summary.total_turns} turn{summary.total_turns === 1 ? "" : "s"} total
            </div>
          </div>
          <div className="flex h-20 items-end gap-1.5">
            {days.map((d) => (
              <div
                key={d.key}
                className="group h-full flex-1 rounded-t bg-accent/15"
                title={`${d.key} · ${d.turns} turn${d.turns === 1 ? "" : "s"} · ${fmtCost(d.cost_usd)}`}
              >
                <div className="flex h-full flex-col justify-end">
                  <div
                    className="rounded-t bg-accent/70 transition-colors group-hover:bg-accent"
                    style={{ height: `${Math.max(4, (d.turns / dayMax) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {days.length <= 14 && (
            <div className="mt-1.5 flex gap-1.5">
              {days.map((d) => (
                <div key={d.key} className="flex-1 truncate text-center font-mono text-[10px] text-text-muted">
                  {shortDay(d.key)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* breakdowns - three equal columns, each row filling the card width */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <UsageBreakdown title="By agent" icon={Cpu} rows={summary.by_cli} />
        <UsageBreakdown title="By model" icon={Layers} rows={summary.by_model} />
        <UsageBreakdown title="By domain" icon={Users} rows={summary.by_domain} />
      </div>
    </div>
  );
}

export function PreambleColumn({
  glyph,
  title,
  tagline,
  options,
  active,
  selectedId,
  onSelect,
  headerless = false,
}: {
  glyph: string;
  title: string;
  tagline?: string;
  options: readonly PreambleOption[];
  active: PreambleOption | undefined;
  selectedId: string;
  onSelect: (id: string) => void;
  /** Omit the built-in header (when wrapped in a CollapsibleSection that already
      supplies title + active-selection summary). */
  headerless?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      {!headerless && (
        // Prominent section header. The current selection is a small badge on
        // the right, not a giant card: the header is the focus.
        <div className="mb-3 border-b border-border-subtle pb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-lg text-accent">{glyph}</span>
            <h3 className="font-display text-2xl font-bold tracking-tight">{title}</h3>
            <span className="font-mono text-xs text-text-muted">{options.length}</span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent-border bg-accent-soft px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Active · {active?.label ?? "Off"}
            </span>
          </div>
          {tagline && <p className="mt-1.5 text-sm text-text-secondary">{tagline}</p>}
        </div>
      )}

      {/* Option list */}
      <div className="flex flex-col gap-2">
        {options.map((o) => (
          <PreambleCard
            key={o.id}
            option={o}
            on={selectedId === o.id}
            onSelect={() => onSelect(o.id)}
          />
        ))}
      </div>
    </div>
  );
}

// Browser automation moved to the agentic Apps lane (connectors browser-learn /
// browser-replay in the engine, surfaced by ConnectorRunPanel). The old per-
// portal manual runner (desktop-side Playwright, tier_c) has been retired in
// favor of one engine-owned browser path. This stub keeps the Settings tab a
// pointer rather than a dead end.
export function IngestionBrowserRunner() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-sm text-text-secondary">
      <div className="mb-1 font-medium text-text-primary">Browser sync moved to Apps</div>
      <p className="text-[13px] text-text-muted">
        Per-portal browser automation now lives under <span className="font-medium text-text-secondary">Apps</span>. Connect an
        app on the browser lane, then use <span className="font-medium text-text-secondary">Connect &amp; learn</span> to log in
        once and let the agent record the steps; later syncs replay automatically with no AI.
      </p>
    </div>
  );
}
