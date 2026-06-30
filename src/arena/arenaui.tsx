// Arena-specific presentational helpers extracted for the #57 redesign. These
// are pure layout/visual bits (no engine calls): the per-view page header, the
// right-rail stat card, a tiny score-distribution bar chart, an insight row and
// the heatmap tint used by the Model x domain matrix. The data wiring stays in
// benchpanel.tsx; this file only owns how that data looks.
import type { LucideIcon } from "lucide-react";
import { scoreColor } from "../format";
import { Sparkline } from "../ui";

// Heatmap tint for a 0-10 judge score. Hue comes from the shared scoreColor
// (green high, amber mid, red low) and the tint gets stronger toward both
// extremes so a strong win reads green and a clear miss reads red, with the
// middle of the pack staying pale. Uses theme tokens via color-mix so it tracks
// light/dark themes. Returns "transparent" for missing cells.
export function heatBg(v: number | null | undefined): string {
  if (v == null) return "transparent";
  const hue = scoreColor(v * 10); // a var(--color-...) token
  const strength = Math.round((0.12 + (Math.abs(v - 5) / 5) * 0.26) * 100);
  return `color-mix(in srgb, ${hue} ${strength}%, transparent)`;
}

// Normalize an arbitrary series to the 1..9 band so the shared Sparkline (which
// expects 0-10) shows the SHAPE of a trend regardless of magnitude (cost in
// fractions of a cent, latency in ms, scores out of 10). Flat series sit mid.
export function normalizeSeries(values: number[]): number[] {
  if (values.length < 2) return values;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 5);
  return values.map((v) => 1 + ((v - min) / (max - min)) * 8);
}

// One Arena page header: big title + one-line description, with optional actions
// pinned to the right. Mirrors the mockups' consistent header band.
export function ArenaHeader({
  title, subtitle, actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "ok" | "warn" | "err" | "accent" | "muted";
const toneText: Record<Tone, string> = {
  ok: "text-ok", warn: "text-warn", err: "text-err", accent: "text-accent", muted: "text-text-muted",
};
const toneSoft: Record<Tone, string> = {
  ok: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn", err: "bg-err/15 text-err",
  accent: "bg-accent/15 text-accent", muted: "bg-surface-warm text-text-muted",
};

// Right-rail stat card: a label, a big value, an optional small badge, a sub
// line (which model / context) and an optional sparkline drawn from a real
// series. Used for the Leaderboard side rail (avg score, fastest, cheapest...).
export function ArenaStatCard({
  label, value, unit, badge, badgeTone = "ok", sub, series, icon: Icon,
}: {
  label: string;
  value: string;
  unit?: string;
  badge?: string;
  badgeTone?: Tone;
  sub?: string;
  series?: number[];
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1">
          <span className="font-display text-2xl font-bold tracking-tight text-text-primary">{value}</span>
          {unit && <span className="text-xs text-text-muted">{unit}</span>}
          {badge && <span className={`ml-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${toneSoft[badgeTone]}`}>{badge}</span>}
        </div>
        {series && series.length >= 2 && <Sparkline values={normalizeSeries(series)} width={64} height={22} />}
      </div>
      {sub && <div className="mt-1 truncate text-[11px] text-text-muted">{sub}</div>}
    </div>
  );
}

// Score-distribution mini bar chart: counts per 0-2 / 2-4 / 4-6 / 6-8 / 8-10
// bucket. Bars are accent; the tallest is labeled with its count.
export function ArenaBars({ buckets, labels }: { buckets: number[]; labels: string[] }) {
  const max = Math.max(1, ...buckets);
  return (
    <div className="flex items-end gap-2" style={{ height: 96 }}>
      {buckets.map((n, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
          <span className="font-mono text-[9px] text-text-muted">{n > 0 ? n : ""}</span>
          <div
            className="w-full rounded-t bg-accent/70"
            style={{ height: `${Math.max(n > 0 ? 6 : 0, (n / max) * 72)}px` }}
            title={`${labels[i]}: ${n} model${n === 1 ? "" : "s"}`}
          />
          <span className="font-mono text-[8px] text-text-muted">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

// An insight row: a small tinted icon chip plus a line of explanatory text.
export function ArenaInsight({ icon: Icon, tone = "accent", children }: {
  icon: LucideIcon;
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${toneSoft[tone]}`}>
        <Icon className="h-3 w-3" />
      </span>
      <span className="text-[12px] leading-relaxed text-text-secondary">{children}</span>
    </div>
  );
}

// A small labeled metric used inside hero cards (best score / avg speed / ...).
export function ArenaMetric({ icon: Icon, label, value, hint, tone = "muted" }: {
  icon?: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
        {Icon && <Icon className={`h-3 w-3 ${toneText[tone]}`} />}
        {label}
      </div>
      <div className="mt-1 font-display text-lg font-bold tracking-tight text-text-primary">{value}</div>
      {hint && <div className="font-mono text-[9px] text-text-muted">{hint}</div>}
    </div>
  );
}
